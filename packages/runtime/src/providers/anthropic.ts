import { RannError } from "@rann/shared";
import { readSse, providerError, safeArgs } from "./sse.js";
import {
  estimateTokens,
  type ChatMessage,
  type ChatRequest,
  type Provider,
  type ProviderChunk,
  type ProviderHealthProbe,
  type ProviderModelInfo,
  type ToolSpec
} from "./types.js";
import { normalizeModelInfo, probeHealth, requestJson } from "./adapter-helpers.js";

export interface AnthropicOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  version?: string;
}

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContent[];
}

function toMessages(messages: ChatMessage[]): { system: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const output: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      const block: AnthropicContent = {
        type: "tool_result",
        tool_use_id: message.toolCallId ?? "",
        content: message.content
      };
      const last = output[output.length - 1];
      if (last?.role === "user") last.content.push(block);
      else output.push({ role: "user", content: [block] });
      continue;
    }
    if (message.role === "assistant") {
      const content: AnthropicContent[] = [];
      if (message.content.length > 0) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.args ?? {} });
      }
      if (content.length > 0) output.push({ role: "assistant", content });
      continue;
    }
    const content: AnthropicContent[] = [{ type: "text", text: message.content }];
    for (const attachment of message.attachments ?? []) {
      content.push({ type: "image", source: { type: "base64", media_type: attachment.mime, data: attachment.dataBase64 } });
    }
    output.push({ role: "user", content });
  }
  return { system: systemParts.join("\n\n"), messages: output };
}

function toTools(tools: ToolSpec[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
}

export class AnthropicProvider implements Provider {
  readonly name: string;
  readonly kind = "anthropic";
  readonly support = { embed: false, listModels: true, health: true, countTokens: true };
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly version: string;

  constructor(options: AnthropicOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.version = options.version ?? "2023-06-01";
  }

  stream(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    return this.chat(request);
  }

  private authHeaders(): Record<string, string> {
    return { "x-api-key": this.apiKey, "anthropic-version": this.version, ...this.headers };
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const { data } = await requestJson<{
      data?: Array<{ id?: string; display_name?: string; context_window?: number; max_output_tokens?: number }>;
    }>({
      url: `${this.baseUrl}/v1/models?limit=1000`,
      headers: this.authHeaders(),
      label: `Provider ${this.name}`,
      timeoutMs: Math.min(this.timeoutMs, 30_000)
    });
    return (data.data ?? [])
      .map((entry) => normalizeModelInfo(entry))
      .filter((entry): entry is ProviderModelInfo => entry !== undefined);
  }

  async health(): Promise<ProviderHealthProbe> {
    return probeHealth(`${this.baseUrl}/v1/models`, this.authHeaders(), `Provider ${this.name}`, 10_000);
  }

  countTokens(request: ChatRequest): number {
    return request.messages.reduce((total, message) => total + estimateTokens(message.content), 0);
  }

  async *chat(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
    const onAbort = (): void => controller.abort(new Error("aborted"));
    request.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const { system, messages } = toMessages(request.messages);
      const body: Record<string, unknown> = {
        model: request.model.replace(/^anthropic\//, ""),
        max_tokens: request.maxTokens ?? 4096,
        messages,
        stream: true
      };
      if (system) body.system = system;
      const tools = toTools(request.tools);
      if (tools) body.tools = tools;
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.responseFormat) {
        const instruction =
          request.responseFormat.type === "json_schema"
            ? "Balas hanya dengan satu objek JSON yang valid sesuai skema yang diminta, tanpa penjelasan atau pagar kode."
            : "Balas hanya dengan JSON yang valid, tanpa penjelasan atau pagar kode.";
        body.system = body.system ? `${String(body.system)}\n\n${instruction}` : instruction;
      }

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": this.version,
            ...this.headers
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (error) {
        if (controller.signal.aborted) {
          const reason = controller.signal.reason as Error | undefined;
          if (reason?.message === "timeout") throw new RannError("E_TIMEOUT", `Provider ${this.name} melewati ${this.timeoutMs} ms`);
          throw new RannError("E_CANCELLED", "Permintaan provider dibatalkan");
        }
        throw new RannError("E_PROVIDER_UNAVAILABLE", `Gagal menghubungi ${this.name}: ${(error as Error).message}`, {
          cause: error
        });
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw providerError(this.name, response.status, detail, response.headers.get("retry-after"));
      }

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let finishReason = "stop";
      let textChars = 0;
      let toolChars = 0;
      const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
      let sawStop = false;

      const requestId = response.headers.get("request-id") ?? undefined;
      if (requestId) yield { type: "request_id", id: requestId };
      for await (const event of readSse(response.body)) {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = (payload.type as string | undefined) ?? event.event;
        if (type === "message_start") {
          const message = payload.message as
            | { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
            | undefined;
          inputTokens = message?.usage?.input_tokens ?? 0;
          cacheReadTokens = message?.usage?.cache_read_input_tokens ?? 0;
          cacheWriteTokens = message?.usage?.cache_creation_input_tokens ?? 0;
        } else if (type === "content_block_start") {
          const index = Number(payload.index ?? 0);
          const block = payload.content_block as { type?: string; id?: string; name?: string } | undefined;
          if (block?.type === "tool_use") {
            toolBlocks.set(index, { id: block.id ?? `call_${index}`, name: block.name ?? "unknown", json: "" });
          }
        } else if (type === "content_block_delta") {
          const index = Number(payload.index ?? 0);
          const delta = payload.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
          if (delta?.type === "text_delta" && delta.text) {
            textChars += delta.text.length;
            yield { type: "text", text: delta.text };
          } else if (delta?.type === "thinking_delta" && delta.thinking) {
            yield { type: "reasoning", text: delta.thinking };
          } else if (delta?.type === "input_json_delta" && delta.partial_json !== undefined) {
            const current = toolBlocks.get(index);
            if (current) {
              current.json += delta.partial_json;
              toolChars += delta.partial_json.length;
            }
          }
        } else if (type === "content_block_stop") {
          const index = Number(payload.index ?? 0);
          const current = toolBlocks.get(index);
          if (current) {
            yield { type: "tool_call", id: current.id, name: current.name, args: safeArgs(current.json) };
            toolBlocks.delete(index);
          }
        } else if (type === "message_delta") {
          const delta = payload.delta as { stop_reason?: string } | undefined;
          const usage = payload.usage as { output_tokens?: number } | undefined;
          if (delta?.stop_reason) finishReason = delta.stop_reason;
          if (usage?.output_tokens !== undefined) outputTokens = usage.output_tokens;
        } else if (type === "message_stop") {
          sawStop = true;
        } else if (type === "error") {
          const error = payload.error as { message?: string; type?: string } | undefined;
          throw new RannError("E_PROVIDER_UNAVAILABLE", error?.message ?? "Anthropic mengirim error di tengah stream");
        }
      }

      if (!sawStop) throw new RannError("E_STREAM_TRUNCATED", `Stream dari ${this.name} berakhir tanpa message_stop`);
      if (outputTokens === 0) outputTokens = Math.ceil((textChars + toolChars) / 4);
      yield {
        type: "usage",
        inputTokens,
        outputTokens,
        ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
        ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {})
      };
      yield { type: "done", finishReason };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}
