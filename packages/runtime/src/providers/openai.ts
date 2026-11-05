import { RannError } from "@rann/shared";
import { estimateTokens, type ChatMessage, type ChatRequest, type Provider, type ProviderChunk } from "./types.js";

export interface OpenAiCompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  stream?: boolean;
}

interface OpenAiToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: OpenAiToolCallDelta[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

function mapMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: message.content.length > 0 ? message.content : null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) }
        }))
      };
    }
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}

function statusToCode(status: number): "E_PROVIDER_AUTH" | "E_PROVIDER_RATE_LIMIT" | "E_PROVIDER_UNAVAILABLE" {
  if (status === 401 || status === 403) return "E_PROVIDER_AUTH";
  if (status === 429) return "E_PROVIDER_RATE_LIMIT";
  return "E_PROVIDER_UNAVAILABLE";
}

export class OpenAiCompatibleProvider implements Provider {
  readonly name: string;
  readonly kind = "openai-compatible";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly useStream: boolean;

  constructor(options: OpenAiCompatibleOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.useStream = options.stream ?? true;
  }

  async *chat(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
    const onAbort = (): void => controller.abort(new Error("aborted"));
    request.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: mapMessages(request.messages),
        stream: this.useStream
      };
      if (this.useStream) body.stream_options = { include_usage: true };
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        }));
      }
      if (request.maxTokens) body.max_tokens = request.maxTokens;
      if (request.temperature !== undefined) body.temperature = request.temperature;

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
            accept: this.useStream ? "text/event-stream" : "application/json",
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
        throw new RannError("E_PROVIDER_UNAVAILABLE", `Gagal menghubungi ${this.name}: ${(error as Error).message}`, { cause: error });
      }

      if (!response.ok) {
        const raw = (await response.text().catch(() => "")).slice(0, 500);
        let detail = raw;
        try {
          const parsed = JSON.parse(raw) as { error?: { message?: string } };
          detail = parsed.error?.message ?? raw;
        } catch {
          // biarkan teks mentah
        }
        throw new RannError(statusToCode(response.status), `Provider ${this.name} membalas ${response.status}: ${detail}`, {
          data: { status: response.status }
        });
      }

      if (!this.useStream) {
        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const choice = json.choices?.[0];
        if (choice?.message?.content) yield { type: "text", text: choice.message.content };
        for (const [index, call] of (choice?.message?.tool_calls ?? []).entries()) {
          yield {
            type: "tool_call",
            id: call.id ?? `call_${index}`,
            name: call.function?.name ?? "unknown",
            args: safeJson(call.function?.arguments)
          };
        }
        if (json.usage) {
          yield { type: "usage", inputTokens: json.usage.prompt_tokens ?? 0, outputTokens: json.usage.completion_tokens ?? 0 };
        }
        yield { type: "done", finishReason: choice?.finish_reason ?? "stop" };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new RannError("E_PROVIDER_UNAVAILABLE", "Respons provider tanpa body");

      const decoder = new TextDecoder();
      let buffer = "";
      let finishReason = "stop";
      let usage: { inputTokens: number; outputTokens: number } | undefined;
      const pending = new Map<number, { id: string; name: string; args: string }>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let chunk: OpenAiStreamChunk;
          try {
            chunk = JSON.parse(payload) as OpenAiStreamChunk;
          } catch {
            continue;
          }
          if (chunk.error) {
            throw new RannError("E_PROVIDER_UNAVAILABLE", chunk.error.message ?? "Provider membalas error di tengah stream");
          }
          const choice = chunk.choices?.[0];
          const content = choice?.delta?.content;
          if (content) yield { type: "text", text: content };
          for (const delta of choice?.delta?.tool_calls ?? []) {
            const index = delta.index ?? 0;
            const current = pending.get(index) ?? { id: delta.id ?? `call_${index}`, name: "", args: "" };
            if (delta.id) current.id = delta.id;
            if (delta.function?.name) current.name += delta.function.name;
            if (delta.function?.arguments) current.args += delta.function.arguments;
            pending.set(index, current);
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk.usage) {
            usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
          }
        }
      }

      for (const call of [...pending.values()]) {
        yield { type: "tool_call", id: call.id, name: call.name || "unknown", args: safeJson(call.args) };
      }
      if (usage) {
        yield { type: "usage", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
      } else {
        yield { type: "usage", inputTokens: 0, outputTokens: 0 };
      }
      yield { type: "done", finishReason };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

function safeJson(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __raw: raw };
  }
}

export function estimateRequestTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message.content), 0);
}
