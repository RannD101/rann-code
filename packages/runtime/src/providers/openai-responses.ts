import { RannError } from "@rann/shared";
import { readSse, providerError, safeArgs } from "./sse.js";
import type { ChatMessage, ChatRequest, Provider, ProviderChunk, ToolSpec } from "./types.js";

export interface ResponsesOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

type InputItem = Record<string, unknown>;

function toInput(messages: ChatMessage[]): { instructions?: string; input: InputItem[] } {
  const system: string[] = [];
  const input: InputItem[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.toolCallId ?? "", output: message.content });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content.length > 0) {
        input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: message.content }] });
      }
      for (const call of message.toolCalls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args ?? {})
        });
      }
      continue;
    }
    const content: InputItem[] = [{ type: "input_text", text: message.content }];
    for (const attachment of message.attachments ?? []) {
      content.push({
        type: "input_image",
        image_url: `data:${attachment.mime};base64,${attachment.dataBase64}`
      });
    }
    input.push({ type: "message", role: "user", content });
  }
  return { ...(system.length > 0 ? { instructions: system.join("\n\n") } : {}), input };
}

function toTools(tools: ToolSpec[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

export class OpenAiResponsesProvider implements Provider {
  readonly name: string;
  readonly kind = "openai-responses";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: ResponsesOptions) {
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async *chat(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
    const onAbort = (): void => controller.abort(new Error("aborted"));
    request.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const { instructions, input } = toInput(request.messages);
      const body: Record<string, unknown> = { model: request.model.replace(/^openai\//, ""), input, stream: true };
      if (instructions) body.instructions = instructions;
      const tools = toTools(request.tools);
      if (tools) body.tools = tools;
      if (request.maxTokens) body.max_output_tokens = request.maxTokens;
      if (request.temperature !== undefined) body.temperature = request.temperature;

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/responses`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
            accept: "text/event-stream",
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
      let finishReason = "stop";
      let textChars = 0;
      let completed = false;
      const calls = new Map<string, { id: string; name: string; args: string }>();

      for await (const event of readSse(response.body)) {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = (payload.type as string | undefined) ?? event.event;
        if (type === "response.output_text.delta") {
          const delta = payload.delta as string | undefined;
          if (delta) {
            textChars += delta.length;
            yield { type: "text", text: delta };
          }
        } else if (type === "response.output_item.added") {
          const item = payload.item as
            | { type?: string; id?: string; call_id?: string; name?: string; arguments?: string }
            | undefined;
          if (item?.type === "function_call") {
            const key = item.id ?? item.call_id ?? `call_${calls.size}`;
            calls.set(key, {
              id: item.call_id ?? key,
              name: item.name ?? "unknown",
              args: item.arguments ?? ""
            });
          }
        } else if (type === "response.function_call_arguments.delta") {
          const key = (payload.item_id as string | undefined) ?? "";
          const delta = payload.delta as string | undefined;
          const current = calls.get(key);
          if (current && delta) current.args += delta;
        } else if (type === "response.output_item.done") {
          const item = payload.item as
            | { type?: string; id?: string; call_id?: string; name?: string; arguments?: string }
            | undefined;
          if (item?.type === "function_call") {
            const key = item.id ?? item.call_id ?? "";
            const current = calls.get(key);
            if (current) {
              yield { type: "tool_call", id: current.id, name: current.name, args: safeArgs(current.args) };
              calls.delete(key);
            }
          }
        } else if (type === "response.completed") {
          completed = true;
          const result = payload.response as
            | {
                status?: string;
                usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
              }
            | undefined;
          inputTokens = result?.usage?.input_tokens ?? inputTokens;
          outputTokens = result?.usage?.output_tokens ?? outputTokens;
          cacheReadTokens = result?.usage?.input_tokens_details?.cached_tokens ?? cacheReadTokens;
          if (result?.status && result.status !== "completed") finishReason = result.status;
        } else if (type === "response.failed" || type === "error") {
          const responseError = (payload.response as { error?: { message?: string } } | undefined)?.error;
          throw new RannError(
            "E_PROVIDER_UNAVAILABLE",
            responseError?.message ?? (payload.message as string | undefined) ?? "Respons OpenAI gagal"
          );
        }
      }

      if (!completed) throw new RannError("E_STREAM_TRUNCATED", `Stream dari ${this.name} berakhir tanpa response.completed`);
      for (const call of calls.values()) {
        yield { type: "tool_call", id: call.id, name: call.name, args: safeArgs(call.args) };
      }
      if (outputTokens === 0) outputTokens = Math.ceil(textChars / 4);
      yield {
        type: "usage",
        inputTokens,
        outputTokens,
        ...(cacheReadTokens > 0 ? { cacheReadTokens } : {})
      };
      yield { type: "done", finishReason };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}
