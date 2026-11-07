import type { RpcClient } from "@rann/runtime";
import type { EventEnvelope } from "@rann/shared";
import { RannError } from "@rann/shared";
import { printErr, Spinner, ui } from "./ui.js";

export type OutputFormat = "text" | "json" | "stream-json";

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

function readUsage(value: unknown): StreamUsage {
  if (value === null || typeof value !== "object") return { inputTokens: 0, outputTokens: 0 };
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: Number(usage.inputTokens ?? 0),
    outputTokens: Number(usage.outputTokens ?? 0)
  };
}

export async function runStreaming(client: RpcClient, sessionId: string, text: string, options: SendOptions = {}): Promise<StreamResult> {
  const format = options.output ?? "text";
  const buffered: EventEnvelope[] = [];
  let handler: ((event: EventEnvelope) => void) | undefined;
  const unsubscribe = client.onEvent((event) => {
    if (handler) handler(event);
    else buffered.push(event);
  });

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
    let wroteText = false;
    let pendingApproval = false;
    let pendingError: StreamError | undefined;
    let collected = "";
    const emit = (payload: Record<string, unknown>): void => {
      if (format === "stream-json") process.stdout.write(`${JSON.stringify(payload)}\n`);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new RannError("E_TIMEOUT", "Turn melewati 10 menit"));
    }, 600_000);

    const cleanup = (): void => {
      clearTimeout(timer);
      handler = undefined;
      unsubscribe();
      unsubscribeClose();
    };

    const breakLine = (): void => {
      if (format === "text" && wroteText) process.stdout.write("\n");
      wroteText = false;
    };

    const toolSpinner = new Spinner();
    let toolStartedAt = 0;
    const unsubscribeClose = client.onClose(() => {
      if (!handler) return;
      toolSpinner.stop();
      breakLine();
      if (format === "text") printErr(ui.yellow("[koneksi terputus, jawaban mungkin tidak lengkap]"));
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
        if (format === "text" && !pendingApproval) {
          wroteText = true;
          process.stdout.write(chunk);
        } else if (format === "stream-json") {
          emit({ type: "message.delta", turn_id: turnId, text: chunk });
        }
        return;
      }
      if (event.type === "tool.start" || event.type === "tool.started") {
        breakLine();
        const tool = String(event.data.tool);
        if (format === "text") {
          if (process.stderr.isTTY) {
            toolStartedAt = Date.now();
            toolSpinner.start(`[tool] ${tool}`);
          } else {
            process.stdout.write(ui.dim(`[tool] ${tool}\n`));
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
          if (process.stderr.isTTY) {
            toolSpinner.stop(ui.dim(`[tool] ${tool} ${label}${timing}`));
          } else {
            process.stdout.write(ui.dim(`[tool] ${tool} ${label}${timing}\n`));
          }
          toolStartedAt = 0;
        }
        emit({ type: "tool.end", turn_id: turnId, tool, status, duration_ms: event.data.duration_ms });
        return;
      }
      if (event.type === "plan.update") {
        if (format === "text" && typeof event.data.status === "string") {
          process.stdout.write(ui.dim(`[plan] ${event.data.status}${event.data.reason ? `: ${event.data.reason}` : ""}\n`));
        }
        emit({ type: "plan.update", turn_id: turnId, ...event.data });
        return;
      }
      if (event.type === "task.update") {
        if (format === "text" && typeof event.data.status === "string") {
          process.stdout.write(ui.dim(`[task] ${event.data.status} ${String(event.data.title ?? "")}\n`));
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
          error: ok ? undefined : pendingError
        });
        return;
      }
      if (event.type === "turn.completed") {
        toolSpinner.stop();
        breakLine();
        const usage = readUsage(event.data.usage);
        const steps = Number(event.data.steps ?? 0);
        const finalText = typeof event.data.text === "string" ? event.data.text : collected;
        emit({ type: "turn.end", turn_id: turnId, ok: true, steps, usage, text: finalText });
        cleanup();
        resolve({ ok: true, turnId, text: finalText, steps, usage });
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
