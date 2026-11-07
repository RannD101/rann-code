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
  error?: StreamError;
}

export interface ApprovalRequest {
  requestId: string;
  tool: string;
  args: unknown;
}

export interface ApprovalDecision {
  approved: boolean;
  remember?: boolean;
}

export interface SendOptions {
  model?: string;
  permissionMode?: string;
  output?: OutputFormat;
  planOnly?: boolean;
  forcePlan?: boolean;
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
      ...(options.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {})
    });
  } catch (error) {
    unsubscribe();
    throw error;
  }
  const turnId = sent.turnId;

  return await new Promise<StreamResult>((resolve, reject) => {
    const markdown = format === "text" ? new MarkdownStream() : undefined;
    let pendingApproval = false;
    let pendingError: StreamError | undefined;
    let collected = "";
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
    const unsubscribeClose = client.onClose(() => {
      if (!handler) return;
      toolSpinner.stop();
      breakLine();
      if (format === "text") printErr(ui.yellow("[stream terputus] jawaban mungkin tidak lengkap, jalankan /resume atau ulangi prompt"));
      cleanup();
      resolve({
        ok: false,
        turnId,
        text: collected,
        steps: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        error: { code: "E_STREAM_TRUNCATED", message: "Koneksi ke daemon terputus sebelum turn selesai" }
      });
    });

    const askApproval = async (event: EventEnvelope): Promise<void> => {
      const requestId = String(event.data.request_id ?? "");
      const tool = String(event.data.tool ?? "tool");
      const args = event.data.args;
      emit({ type: "approval.request", turn_id: turnId, request_id: requestId, tool, args });
      if (!requestId || !options.onApproval) {
        if (requestId) {
          await client.request("permission.respond", { requestId, approved: false }).catch(() => undefined);
        }
        printErr(ui.yellow(`[izin] ${tool} butuh persetujuan, tapi sesi ini non-interaktif. Ditolak.`));
        return;
      }
      pendingApproval = true;
      try {
        const decision = await options.onApproval({ requestId, tool, args });
        await client.request("permission.respond", {
          requestId,
          approved: decision.approved,
          remember: decision.remember === true
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
      if (event.type === "usage.update") {
        if (typeof event.data.cost_usd === "number") costUsd = event.data.cost_usd;
        else if (event.data.cost_usd === null) costUsd = null;
        return;
      }
      if (event.type === "reasoning.delta") {
        const chunk = String(event.data.text ?? "");
        if (format === "text" && chunk.length > 0) {
          phaseSpinner.stop();
          if (!reasoningOpen) {
            process.stdout.write(ui.dim("\n[reasoning]\n"));
            reasoningOpen = true;
          }
          process.stdout.write(ui.dim(chunk));
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
          const summary = typeof event.data.summary === "string" && event.data.summary.length > 0 ? `  ${brief(event.data.summary, 160)}` : "";
          if (process.stderr.isTTY) {
            toolSpinner.stop(ui.dim(`[tool] ${tool} ${label}${timing}${exit}${summary}`));
          } else {
            printErr(ui.dim(`[tool] ${tool} ${label}${timing}${exit}${summary}`));
          }
          toolStartedAt = 0;
        }
        emit({ type: "tool.end", turn_id: turnId, tool, status, duration_ms: event.data.duration_ms });
        return;
      }
      if (event.type === "plan.update") {
        if (typeof event.data.tasks === "number") planTotal = event.data.tasks;
        if (format === "text" && typeof event.data.status === "string") {
          const total = planTotal > 0 ? ` ${planTotal} langkah` : "";
          printErr(ui.dim(`[plan] ${event.data.status}${total}${event.data.reason ? `: ${event.data.reason}` : ""}`));
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
          const current = status === "running" ? Math.min(done + 1, planTotal || done + 1) : done;
          const counter = planTotal > 0 ? ` ${current}/${planTotal}` : "";
          const elapsed = status === "running" && taskStartedAt > 0 ? ` ${((Date.now() - taskStartedAt) / 1000).toFixed(1)}s` : "";
          printErr(ui.dim(`[task]${counter} ${status} ${String(event.data.title ?? "")}${elapsed}`));
        }
        emit({ type: "task.update", turn_id: turnId, ...event.data });
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
        resolve({ ok: true, turnId, text: finalText, steps, usage, costUsd });
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
          error: { code, message, ...(typeof analysis.category === "string" ? { category: analysis.category } : {}), ...(action ? { action } : {}) }
        });
      }
    };
    handler = onEvent;

    for (const event of buffered.splice(0)) onEvent(event);
  });
}
