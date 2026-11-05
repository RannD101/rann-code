import type { RpcClient } from "@rann/runtime";
import type { EventEnvelope } from "@rann/shared";
import { RannError } from "@rann/shared";
import { printErr, ui } from "./ui.js";

export interface StreamResult {
  ok: boolean;
  turnId: string;
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
  onApproval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
}

export async function runStreaming(client: RpcClient, sessionId: string, text: string, options: SendOptions = {}): Promise<StreamResult> {
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
      ...(options.permissionMode ? { permissionMode: options.permissionMode } : {})
    });
  } catch (error) {
    unsubscribe();
    throw error;
  }
  const turnId = sent.turnId;

  return await new Promise<StreamResult>((resolve, reject) => {
    let wroteText = false;
    let pendingApproval = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new RannError("E_TIMEOUT", "Turn melewati 10 menit"));
    }, 600_000);

    const cleanup = (): void => {
      clearTimeout(timer);
      handler = undefined;
      unsubscribe();
    };

    const breakLine = (): void => {
      if (wroteText) process.stdout.write("\n");
      wroteText = false;
    };

    const askApproval = async (event: EventEnvelope): Promise<void> => {
      const requestId = String(event.data.request_id ?? "");
      const tool = String(event.data.tool ?? "tool");
      const args = event.data.args;
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
        if (!pendingApproval) {
          wroteText = true;
          process.stdout.write(chunk);
        }
        return;
      }
      if (event.type === "tool.started") {
        breakLine();
        process.stdout.write(ui.dim(`[tool] ${String(event.data.tool)}\n`));
        return;
      }
      if (event.type === "tool.finished") {
        const status = String(event.data.status ?? "ok");
        const label = status === "ok" ? ui.green("ok") : ui.red(status);
        process.stdout.write(ui.dim(`[tool] ${String(event.data.tool)} ${label}\n`));
        return;
      }
      if (event.type === "approval.requested") {
        void askApproval(event);
        return;
      }
      if (event.type === "turn.completed") {
        breakLine();
        cleanup();
        resolve({ ok: true, turnId });
        return;
      }
      if (event.type === "turn.failed") {
        breakLine();
        const code = String(event.data.error_code ?? "E_INTERNAL");
        const message = String(event.data.message ?? "turn gagal");
        printErr(`${ui.red("rann")}: ${code}: ${message}`);
        cleanup();
        resolve({ ok: false, turnId });
      }
    };
    handler = onEvent;

    for (const event of buffered.splice(0)) onEvent(event);
  });
}
