import type { Db } from "@rann/storage";
import {
  addMessage,
  addToolCall,
  appendEvent,
  completeToolCall,
  finishTurn,
  listMessages,
  markTurnRunning,
  recordUsage,
  touchSession,
  type MessageRow,
  type SessionRow
} from "@rann/storage";
import { RannError, toRannError, type EventEnvelope, type EventType, type PermissionMode } from "@rann/shared";
import type { Provider, ChatMessage, ToolCallPart } from "./providers/types.js";
import { executeTool, toolSpecs } from "./tools/index.js";
import { loadInstructions } from "./instructions.js";

export interface ApprovalDecision {
  approved: boolean;
  remember?: boolean;
}

export interface AgentConfig {
  permissionMode: PermissionMode;
  workspaceOnly: boolean;
  allow: string[];
  deny: string[];
  maxSteps: number;
  systemExtra: string;
  shellTimeoutMs?: number;
  preApprovedTools?: Set<string>;
  requestApproval?: (request: { tool: string; args: unknown }) => Promise<ApprovalDecision>;
}

export interface RunTurnOptions {
  db: Db;
  session: SessionRow;
  turnId: string;
  userText: string;
  provider: Provider;
  model: string;
  workspaceRoot: string;
  config: AgentConfig;
  signal?: AbortSignal;
  approved?: boolean;
  emit?: (event: EventEnvelope) => void;
}

export interface RunTurnResult {
  text: string;
  steps: number;
  usage: { inputTokens: number; outputTokens: number };
}

function systemPrompt(root: string, config: AgentConfig, instructions: string): string {
  const lines = [
    "Kamu Rann Code, agent coding yang bekerja lewat tool di terminal.",
    `Workspace: ${root}`,
    `Mode izin: ${config.permissionMode}${config.workspaceOnly ? ", hanya dalam workspace" : ""}`,
    "Aturan:",
    "- Baca berkas sebelum mengubahnya. Jangan mengarang isi berkas atau hasil perintah.",
    "- Pakai path relatif terhadap workspace pada argumen tool.",
    "- Setelah mengubah kode, jalankan tes atau perintah verifikasi yang relevan.",
    "- Jawab ringkas dalam bahasa yang dipakai user. Sebut berkas dan baris kalau relevan.",
    "- Kalau butuh izin dan tool ditolak, jelaskan apa yang perlu diubah, jangan mengulang tool yang sama."
  ];
  if (instructions.length > 0) lines.push("", "Instruksi proyek:", instructions);
  if (config.systemExtra.length > 0) lines.push("", "Instruksi tambahan:", config.systemExtra);
  return lines.join("\n");
}

function toChatMessages(rows: MessageRow[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const row of rows) {
    if (row.role === "tool") {
      let meta: { toolCallId?: string; toolName?: string } = {};
      if (row.content_json) {
        try {
          meta = JSON.parse(row.content_json) as { toolCallId?: string; toolName?: string };
        } catch {
          meta = {};
        }
      }
      messages.push({ role: "tool", content: row.content, toolCallId: meta.toolCallId, toolName: meta.toolName });
      continue;
    }
    if (row.role === "assistant" && row.content_json) {
      try {
        const parsed = JSON.parse(row.content_json) as { toolCalls?: ToolCallPart[] };
        if (parsed.toolCalls && parsed.toolCalls.length > 0) {
          messages.push({ role: "assistant", content: row.content, toolCalls: parsed.toolCalls });
          continue;
        }
      } catch {
        // jatuh ke pesan biasa
      }
    }
    messages.push({ role: row.role, content: row.content });
  }
  return messages;
}

export async function runTurn(options: RunTurnOptions): Promise<RunTurnResult> {
  const { db, session, turnId, provider, model, workspaceRoot, config, signal, emit } = options;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let finalText = "";
  let steps = 0;
  let finished = false;

  const finalize = (status: "done" | "failed" | "cancelled", error?: { code: RannError["code"]; message: string }): void => {
    if (finished) return;
    finished = true;
    const input: Parameters<typeof finishTurn>[1] = { id: turnId, status, usage: { ...usage } };
    if (error) input.error = error;
    finishTurn(db, input);
  };

  const publish = (type: EventType, data: Record<string, unknown>): void => {
    const event = appendEvent(db, { type, sessionId: session.id, turnId, data });
    emit?.(event);
  };

  addMessage(db, { sessionId: session.id, turnId, role: "user", content: options.userText });
  if (session.title === "Sesi baru") {
    const title = options.userText.replace(/\s+/g, " ").trim().slice(0, 70) || "Sesi baru";
    touchSession(db, session.id, { title });
  }
  markTurnRunning(db, turnId);
  publish("turn.started", { model, provider: provider.name, prompt_chars: options.userText.length });

  const instructions = loadInstructions(workspaceRoot);
  const baseSystem = systemPrompt(workspaceRoot, config, instructions.text);

  try {
    for (steps = 1; steps <= config.maxSteps; steps += 1) {
      if (signal?.aborted) throw new RannError("E_CANCELLED", "Turn dibatalkan");
      const history = listMessages(db, session.id, 400);
      const messages: ChatMessage[] = [{ role: "system", content: baseSystem }, ...toChatMessages(history)];

      let text = "";
      const calls: ToolCallPart[] = [];
      let finishReason = "stop";

      for await (const chunk of provider.chat({
        model,
        messages,
        tools: toolSpecs(),
        signal
      })) {
        if (chunk.type === "text") {
          text += chunk.text;
          publish("message.delta", { text: chunk.text });
        } else if (chunk.type === "tool_call") {
          calls.push({ id: chunk.id, name: chunk.name, args: chunk.args });
        } else if (chunk.type === "usage") {
          usage.inputTokens += chunk.inputTokens;
          usage.outputTokens += chunk.outputTokens;
        } else if (chunk.type === "done") {
          finishReason = chunk.finishReason;
        }
      }

      if (text.length > 0) {
        addMessage(db, {
          sessionId: session.id,
          turnId,
          role: "assistant",
          content: text,
          contentJson: calls.length > 0 ? { toolCalls: calls } : undefined
        });
        publish("message.completed", { chars: text.length, finish_reason: finishReason });
      }

      if (calls.length === 0) {
        finalText = text;
        recordUsage(db, {
          provider: provider.name,
          model,
          sessionId: session.id,
          turnId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens
        });
        publish("turn.completed", { steps, usage });
        finalize("done");
        return { text: finalText, steps, usage };
      }

      for (const call of calls) {
        if (signal?.aborted) throw new RannError("E_CANCELLED", "Turn dibatalkan");
        const toolRow = addToolCall(db, { sessionId: session.id, turnId, toolName: call.name, args: call.args });
        publish("tool.started", { tool: call.name, args: call.args, call_id: call.id, tool_call_id: toolRow.id });

        const finishOk = (result: Awaited<ReturnType<typeof executeTool>>): void => {
          completeToolCall(db, toolRow.id, {
            status: result.ok ? "ok" : "error",
            result: result.output,
            exitCode: result.exitCode,
            durationMs: result.durationMs
          });
          const content = JSON.stringify(result.output).slice(0, 20_000);
          addMessage(db, {
            sessionId: session.id,
            turnId,
            role: "tool",
            content,
            contentJson: { toolCallId: call.id, toolName: call.name }
          });
          publish("tool.finished", {
            tool: call.name,
            status: result.ok ? "ok" : "error",
            exit_code: result.exitCode,
            duration_ms: result.durationMs
          });
        };

        const finishError = (code: string, message: string): void => {
          completeToolCall(db, toolRow.id, { status: "error", result: { code, message } });
          addMessage(db, {
            sessionId: session.id,
            turnId,
            role: "tool",
            content: JSON.stringify({ error: code, message }),
            contentJson: { toolCallId: call.id, toolName: call.name }
          });
          publish("tool.finished", { tool: call.name, status: "error", error_code: code });
        };

        try {
          let result: Awaited<ReturnType<typeof executeTool>>;
          const preApproved = options.approved === true || config.preApprovedTools?.has(call.name) === true;
          try {
            result = await executeTool(call.name, call.args, {
              workspaceRoot,
              workspaceOnly: config.workspaceOnly,
              permissionMode: config.permissionMode,
              approved: preApproved,
              allow: config.allow,
              deny: config.deny,
              signal,
              shellTimeoutMs: config.shellTimeoutMs
            });
          } catch (error) {
            const err = toRannError(error);
            if (err.code !== "E_APPROVAL_REQUIRED" || !config.requestApproval) throw err;
            const decision = await config.requestApproval({ tool: call.name, args: call.args });
            if (!decision.approved) {
              finishError("E_APPROVAL_REQUIRED", `Izin ditolak user untuk ${call.name}`);
              continue;
            }
            if (decision.remember) config.preApprovedTools?.add(call.name);
            result = await executeTool(call.name, call.args, {
              workspaceRoot,
              workspaceOnly: config.workspaceOnly,
              permissionMode: config.permissionMode,
              approved: true,
              allow: config.allow,
              deny: config.deny,
              signal,
              shellTimeoutMs: config.shellTimeoutMs
            });
          }
          finishOk(result);
        } catch (error) {
          const err = toRannError(error);
          finishError(err.code, err.message);
          if (err.code === "E_APPROVAL_REQUIRED" || err.code === "E_PERMISSION") {
            publish("turn.failed", { error_code: err.code, message: err.message });
            finalize("failed", { code: err.code, message: err.message });
            throw err;
          }
        }
      }
    }

    const message = `Batas ${config.maxSteps} langkah agent tercapai tanpa jawaban akhir`;
    publish("turn.failed", { error_code: "E_BUDGET_EXHAUSTED", message });
    finalize("failed", { code: "E_BUDGET_EXHAUSTED", message });
    throw new RannError("E_BUDGET_EXHAUSTED", message);
  } catch (error) {
    const err = toRannError(error);
    if (err.code === "E_CANCELLED") {
      publish("turn.failed", { error_code: err.code, message: err.message });
      finalize("cancelled", { code: err.code, message: err.message });
    } else {
      finalize("failed", { code: err.code, message: err.message });
    }
    throw err;
  }
}
