import type { RpcClient } from "@rann/runtime";
import type { EventEnvelope } from "@rann/shared";
import { RannError } from "@rann/shared";
import { printErr, Spinner, ui } from "./ui.js";
import { previewEdit } from "./edit-preview.js";
import { MarkdownStream } from "./markdown.js";

export type OutputFormat = "text" | "json" | "stream-json" | "ndjson";

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StreamError {
  code: string;
  message: string;
  category?: string;
  action?: string;
}

export interface StreamResult {
  ok: boolean;
  turnId: string;
  text: string;
  steps: number;
  usage: StreamUsage;
  costUsd?: number | null;
  durationMs: number;
  plan?: Record<string, unknown>;
  error?: StreamError;
}

export interface ApprovalRequest {
  requestId: string;
  tool: string;
  args: unknown;
  reason?: string;
  risk?: "low" | "medium" | "high";
}

export interface ApprovalDecision {
  approved: boolean;
  remember?: boolean;
  taskIds?: string[];
  note?: string;
}

export interface SendOptions {
  model?: string;
  permissionMode?: string;
  output?: OutputFormat;
  planOnly?: boolean;
  forcePlan?: boolean;
  taskClass?: string;
  attachments?: Array<{ path: string; name?: string }>;
  onApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
}

function brief(value: unknown, limit = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function readUsage(value: unknown): StreamUsage {
  if (value === null || typeof value !== "object") return { inputTokens: 0, outputTokens: 0 };
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: Number(usage.inputTokens ?? 0),
    outputTokens: Number(usage.outputTokens ?? 0)
  };
}


/** Format indikator task: 2/5, status, judul, dan waktu berjalan (AC-009). */
export function renderTaskProgress(input: {
  done: number;
  total: number;
  status: string;
  title: string;
  elapsedMs?: number;
}): string {
  const current = input.status === "running" ? Math.min(input.done + 1, input.total || input.done + 1) : input.done;
  const pendingVerify = input.total > 0 && current >= input.total && input.status !== "running" ? " menunggu verifikasi" : "";
  const counter = input.total > 0 ? ` ${current}/${input.total}${pendingVerify}` : "";
  const elapsed = input.status === "running" && input.elapsedMs !== undefined ? ` ${(input.elapsedMs / 1000).toFixed(1)}s` : "";
  return `[task]${counter} ${input.status} ${input.title}${elapsed}`;
}

export async function runStreaming(client: RpcClient, sessionId: string, text: string, options: SendOptions = {}): Promise<StreamResult> {
  const format = options.output === "ndjson" ? "stream-json" : options.output ?? "text";
  const phaseSpinner = new Spinner();
  const phaseEnabled = format === "text" && process.stderr.isTTY === true;
  if (phaseEnabled) phaseSpinner.start("mengirim");
  const buffered: EventEnvelope[] = [];
  let handler: ((event: EventEnvelope) => void) | undefined;
  const unsubscribe = client.onEvent((event) => {
    if (handler) handler(event);
    else buffered.push(event);
  });

  if (phaseEnabled) {
    phaseSpinner.stop();
    phaseSpinner.start("menunggu model");
  }
  let sent: { turnId: string };
  try {
    sent = await client.request<{ turnId: string }>("session.send", {
      sessionId,
      text,
      ...(options.model ? { model: options.model } : {}),
      ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
      ...(options.planOnly ? { planOnly: true } : {}),
      ...(options.forcePlan ? { forcePlan: true } : {}),
      ...(options.taskClass ? { taskClass: options.taskClass } : {}),
      ...(options.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {})
    });
  } catch (error) {
    unsubscribe();
    throw error;
  }
  const turnId = sent.turnId;

  return await new Promise<StreamResult>((resolve, reject) => {
    const startedAt = Date.now();
    const markdown = format === "text" ? new MarkdownStream() : undefined;
    let pendingApproval = false;
    let pendingError: StreamError | undefined;
    let collected = "";
    let planDraft: Record<string, unknown> | undefined;
    let costUsd: number | null | undefined;
    let pendingText = "";
    let flushTimer: NodeJS.Timeout | undefined;
    let reasoningOpen = false;
    const flushText = (): void => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (pendingText.length === 0) return;
      if (format === "text" && !pendingApproval) {
        const rendered = markdown ? markdown.push(pendingText) : pendingText;
        if (rendered.length > 0) process.stdout.write(rendered);
      }
      pendingText = "";
    };
    const queueText = (chunk: string): void => {
      pendingText += chunk;
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        flushText();
      }, 33);
      flushTimer.unref();
    };
    const emit = (payload: Record<string, unknown>): void => {
      if (format === "stream-json") process.stdout.write(`${JSON.stringify(payload)}\n`);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new RannError("E_TIMEOUT", "Turn melewati 10 menit"));
    }, 600_000);

    const cleanup = (): void => {
      clearTimeout(timer);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = undefined;
      phaseSpinner.stop();
      handler = undefined;
      unsubscribe();
      unsubscribeClose();
    };

    const breakLine = (): void => {
      if (format === "text") {
        const rendered = markdown?.flush() ?? "";
        if (rendered.length > 0) process.stdout.write(rendered);
      }
    };

    const toolSpinner = new Spinner();
    let toolStartedAt = 0;
    let planTotal = 0;
    let taskStartedAt = 0;
    const taskStatuses = new Map<string, string>();
    let reconnecting = false;
    const unsubscribeClose = client.onClose(() => {
      if (!handler || reconnecting) return;
      reconnecting = true;
      void (async () => {
        toolSpinner.stop();
        breakLine();
        if (format === "text") printErr(ui.yellow("[stream terputus] mencoba menyambung ulang otomatis..."));
        try {
          await client.reconnect();
          reconnecting = false;
          if (format === "text") printErr(ui.green("[tersambung lagi] melanjutkan menerima event turn"));
          handler = onEvent;
          return;
        } catch {
          cleanup();
          resolve({
            ok: false,
            turnId,
            text: collected,
            steps: 0,
            usage: { inputTokens: 0, outputTokens: 0 },
            durationMs: Date.now() - startedAt,
            error: { code: "E_STREAM_TRUNCATED", message: "Koneksi ke daemon terputus; jalankan /resume untuk melanjutkan" }
          });
        }
      })();
    });

    const askApproval = async (event: EventEnvelope): Promise<void> => {
      const requestId = String(event.data.request_id ?? "");
      const tool = String(event.data.tool ?? "tool");
      const args = event.data.args;
      const reason = typeof event.data.reason === "string" ? event.data.reason : undefined;
      const risk = event.data.risk === "low" || event.data.risk === "medium" || event.data.risk === "high" ? event.data.risk : undefined;
      emit({ type: "approval.request", turn_id: turnId, request_id: requestId, tool, args, ...(reason ? { reason } : {}), ...(risk ? { risk } : {}) });
      if (!requestId || !options.onApproval) {
        if (requestId) {
          await client.request("permission.respond", { requestId, approved: false }).catch(() => undefined);
        }
        printErr(ui.yellow(`[izin] ${tool} butuh persetujuan, tapi sesi ini non-interaktif. Ditolak.`));
        return;
      }
      pendingApproval = true;
      try {
        const decision = await options.onApproval({ requestId, tool, args, ...(reason ? { reason } : {}), ...(risk ? { risk } : {}) });
        await client.request("permission.respond", {
          requestId,
          approved: decision.approved,
          remember: decision.remember === true,
          ...(decision.taskIds ? { taskIds: decision.taskIds } : {}),
          ...(decision.note ? { note: decision.note } : {})
        });
        if (!decision.approved) printErr(ui.dim("[izin] ditolak"));
      } catch (error) {
        printErr(ui.red(`[izin] gagal menjawab: ${(error as Error).message}`));
        await client.request("permission.respond", { requestId, approved: false }).catch(() => undefined);
      } finally {
        pendingApproval = false;
      }
    };

    const onEvent = (event: EventEnvelope): void => {
      if (event.turnId !== turnId) return;
      if (event.type === "message.delta") {
        const chunk = String(event.data.text ?? "");
        collected += chunk;
        phaseSpinner.stop();
        if (format === "stream-json") emit({ type: "message.delta", turn_id: turnId, text: chunk });
        else if (format === "text") {
          if (reasoningOpen) {
            process.stdout.write("\n");
            reasoningOpen = false;
          }
          queueText(chunk);
        }
        return;
      }
      if (event.type === "phase") {
        const labels: Record<string, string> = {
          understand: "memahami goal",
          plan: "menyusun rencana",
          observe: "membaca hasil tool",
          evaluate: "mengevaluasi hasil",
          verify: "memverifikasi",
          done: "selesai"
        };
        const label = labels[String(event.data.phase ?? "")];
        if (label && phaseEnabled) {
          phaseSpinner.stop();
          phaseSpinner.start(label);
        }
        return;
      }
      if (event.type === "usage.update") {
        if (typeof event.data.cost_usd === "number") costUsd = event.data.cost_usd;
        else if (event.data.cost_usd === null) costUsd = null;
        return;
      }
      if (event.type === "reasoning.delta") {
        const chunk = String(event.data.text ?? "");
        if (format === "text" && chunk.length > 0) {
          if (process.env.RANN_SHOW_REASONING === "1") {
            phaseSpinner.stop();
            if (!reasoningOpen) {
              process.stdout.write(ui.dim("\n[reasoning]\n"));
              reasoningOpen = true;
            }
            process.stdout.write(ui.dim(chunk));
          } else if (!reasoningOpen) {
            process.stdout.write(ui.dim("\n[reasoning terlipat, set RANN_SHOW_REASONING=1 untuk membuka]"));
            reasoningOpen = true;
          }
        }
        return;
      }
      if (event.type === "tool.start" || event.type === "tool.started") {
        flushText();
        phaseSpinner.stop();
        if (reasoningOpen) {
          process.stdout.write("\n");
          reasoningOpen = false;
        }
        breakLine();
        const tool = String(event.data.tool);
        const argText = brief(event.data.args);
        const preview = format === "text" ? previewEdit(tool, event.data.args, process.cwd()) : null;
        if (preview) {
          printErr(ui.dim(`[diff] ${preview.path}  +${preview.added} -${preview.removed}`));
          for (const line of preview.lines) printErr(ui.dim(`  ${line}`));
        }
        if (format === "text") {
          if (process.stderr.isTTY) {
            toolStartedAt = Date.now();
            toolSpinner.start(`[tool] ${tool} ${argText}`);
          } else {
            printErr(ui.dim(`[tool] ${tool} ${argText}`));
          }
        }
        emit({ type: "tool.start", turn_id: turnId, tool, args: event.data.args });
        return;
      }
      if (event.type === "tool.end" || event.type === "tool.finished") {
        const status = String(event.data.status ?? "ok");
        const tool = String(event.data.tool);
        if (format === "text") {
          const label = status === "ok" ? ui.green("ok") : ui.red(status);
          const duration = Number(event.data.duration_ms ?? (toolStartedAt > 0 ? Date.now() - toolStartedAt : 0));
          const timing = duration > 0 ? ` ${(duration / 1000).toFixed(1)}s` : "";
          const exit = event.data.exit_code === undefined || event.data.exit_code === null ? "" : ` exit ${String(event.data.exit_code)}`;
          const cwd = tool === "shell_run" && typeof event.data.cwd === "string" ? ` di ${event.data.cwd}` : "";
          const summary = typeof event.data.summary === "string" && event.data.summary.length > 0
            ? `  ${brief(event.data.summary, 160)}`
            : typeof event.data.reason === "string" && event.data.reason.length > 0
              ? `  ${brief(event.data.reason, 160)}`
              : "";
          if (process.stderr.isTTY) {
            toolSpinner.stop(ui.dim(`[tool] ${tool} ${label}${timing}${exit}${cwd}${summary}`));
          } else {
            printErr(ui.dim(`[tool] ${tool} ${label}${timing}${exit}${cwd}${summary}`));
          }
          toolStartedAt = 0;
        }
        emit({ type: "tool.end", turn_id: turnId, tool, status, duration_ms: event.data.duration_ms });
        return;
      }
      if (event.type === "plan.update") {
        if (event.data.draft && typeof event.data.draft === "object") planDraft = event.data.draft as Record<string, unknown>;
        if (typeof event.data.tasks === "number") planTotal = event.data.tasks;
        if (format === "text" && typeof event.data.status === "string") {
          const total = planTotal > 0 ? ` ${planTotal} langkah` : "";
          const version = Number(event.data.version ?? 1);
          const replan = version > 1 ? ` [replan v${version}]` : "";
          printErr(ui.dim(`[plan]${replan} ${event.data.status}${total}${event.data.reason ? `: ${event.data.reason}` : ""}`));
        }
        emit({ type: "plan.update", turn_id: turnId, ...event.data });
        return;
      }
      if (event.type === "task.update") {
        const taskId = String(event.data.task_id ?? event.data.plan_task_id ?? "");
        const status = String(event.data.status ?? "");
        if (taskId && status) taskStatuses.set(taskId, status);
        if (status === "running") taskStartedAt = Date.now();
        if (format === "text" && status) {
          const done = [...taskStatuses.values()].filter((value) => value === "done").length;
          printErr(
            ui.dim(
              renderTaskProgress({
                done,
                total: planTotal,
                status,
                title: String(event.data.title ?? ""),
                ...(status === "running" && taskStartedAt > 0 ? { elapsedMs: Date.now() - taskStartedAt } : {})
              })
            )
          );
        }
        emit({ type: "task.update", turn_id: turnId, ...event.data });
        return;
      }
      if (event.type === "job.update") {
        const status = String(event.data.status ?? event.data.event ?? "");
        if (status === "done" || status === "failed" || status === "dead" || status === "succeeded") {
          const line = `[job ${String(event.data.id ?? "?")}] ${status}${event.data.message ? `: ${String(event.data.message)}` : ""}`;
          if (format === "text") printErr(status === "failed" || status === "dead" ? ui.red(line) : ui.dim(line));
          else emit({ type: "job.update", turn_id: turnId, ...event.data });
        }
        return;
      }
      if (event.type === "approval.request" || event.type === "approval.requested") {
        void askApproval(event);
        return;
      }
      if (event.type === "error") {
        const analysis = (event.data.analysis ?? {}) as Record<string, unknown>;
        pendingError = {
          code: String(event.data.error_code ?? "E_INTERNAL"),
          message: String(event.data.message ?? "turn gagal"),
          ...(typeof analysis.category === "string" ? { category: analysis.category } : {}),
          ...(typeof analysis.action === "string" ? { action: analysis.action } : {})
        };
        return;
      }
      if (event.type === "turn.end") {
        flushText();
        phaseSpinner.stop();
        if (reasoningOpen) {
          process.stdout.write("\n");
          reasoningOpen = false;
        }
        toolSpinner.stop();
        breakLine();
        const usage = readUsage(event.data.usage);
        const steps = Number(event.data.steps ?? 0);
        const finalText = typeof event.data.text === "string" ? event.data.text : collected;
        const ok = String(event.data.status ?? "done") === "done";
        if (!ok && pendingError) printErr(`${ui.red("rann")}: ${pendingError.code}: ${pendingError.message}`);
        if (!ok && pendingError?.action) printErr(ui.dim(`saran: ${pendingError.action}`));
        emit({ type: "turn.end", turn_id: turnId, ok, steps, usage, text: finalText });
        cleanup();
        resolve({
          ok,
          turnId,
          text: finalText,
          steps,
          usage,
          costUsd,
          durationMs: Date.now() - startedAt,
          ...(planDraft ? { plan: planDraft } : {}),
          error: ok ? undefined : pendingError
        });
        return;
      }
      if (event.type === "turn.completed") {
        flushText();
        phaseSpinner.stop();
        toolSpinner.stop();
        breakLine();
        const usage = readUsage(event.data.usage);
        const steps = Number(event.data.steps ?? 0);
        const finalText = typeof event.data.text === "string" ? event.data.text : collected;
        emit({ type: "turn.end", turn_id: turnId, ok: true, steps, usage, text: finalText });
        cleanup();
        resolve({ ok: true, turnId, text: finalText, steps, usage, costUsd, durationMs: Date.now() - startedAt, ...(planDraft ? { plan: planDraft } : {}) });
        return;
      }
      if (event.type === "turn.failed") {
        toolSpinner.stop();
        breakLine();
        const code = String(event.data.error_code ?? "E_INTERNAL");
        const message = String(event.data.message ?? "turn gagal");
        const analysis = (event.data.analysis ?? {}) as Record<string, unknown>;
        const action = typeof analysis.action === "string" ? analysis.action : undefined;
        printErr(`${ui.red("rann")}: ${code}: ${message}`);
        if (action) printErr(ui.dim(`saran: ${action}`));
        emit({ type: "error", turn_id: turnId, code, message });
        emit({ type: "turn.end", turn_id: turnId, ok: false, steps: 0, usage: readUsage(undefined), text: collected });
        cleanup();
        resolve({
          ok: false,
          turnId,
          text: collected,
          steps: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: Date.now() - startedAt,
          ...(planDraft ? { plan: planDraft } : {}),
          error: { code, message, ...(typeof analysis.category === "string" ? { category: analysis.category } : {}), ...(action ? { action } : {}) }
        });
      }
    };
    handler = onEvent;

    for (const event of buffered.splice(0)) onEvent(event);
  });
}
