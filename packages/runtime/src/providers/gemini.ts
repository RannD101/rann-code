import { RannError } from "@rann/shared";
import { readSse, providerError } from "./sse.js";
import type { ChatMessage, ChatRequest, Provider, ProviderChunk, ToolSpec } from "./types.js";

export interface GeminiOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: unknown } };

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

function toContents(messages: ChatMessage[]): { systemInstruction?: string; contents: GeminiContent[] } {
  const system: string[] = [];
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      const part: GeminiPart = {
        functionResponse: {
          name: message.toolName ?? "unknown",
          response: { content: message.content }
        }
      };
      const last = contents[contents.length - 1];
      if (last?.role === "user") last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
      continue;
    }
    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (message.content.length > 0) parts.push({ text: message.content });
      for (const call of message.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.args ?? {} } });
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }
    contents.push({ role: "user", parts: [{ text: message.content }] });
  }
  return { ...(system.length > 0 ? { systemInstruction: system.join("\n\n") } : {}), contents };
}

function toTools(tools: ToolSpec[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }))
    }
  ];
}

export class GeminiProvider implements Provider {
  readonly name: string;
  readonly kind = "gemini";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: GeminiOptions) {
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
      const { systemInstruction, contents } = toContents(request.messages);
      const model = request.model.replace(/^gemini\//, "").replace(/^models\//, "");
      const body: Record<string, unknown> = { contents };
      if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
      const tools = toTools(request.tools);
      if (tools) body.tools = tools;
      if (request.maxTokens) body.generationConfig = { maxOutputTokens: request.maxTokens };
      if (request.temperature !== undefined) {
        body.generationConfig = { ...(body.generationConfig as object), temperature: request.temperature };
      }

      const base = this.baseUrl.endsWith("/v1beta") ? this.baseUrl : `${this.baseUrl}/v1beta`;
      let response: Response;
      try {
        response = await fetch(`${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
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
      let finishReason = "stop";
      let sawFinish = false;
      let textChars = 0;

      for await (const event of readSse(response.body)) {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const usage = payload.usageMetadata as
          | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
          | undefined;
        if (usage) {
          inputTokens = usage.promptTokenCount ?? inputTokens;
          outputTokens = usage.candidatesTokenCount ?? outputTokens;
        }
        const candidates = payload.candidates as
          | Array<{
              content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> };
              finishReason?: string;
            }>
          | undefined;
        for (const candidate of candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            if (part.text) {
              textChars += part.text.length;
              yield { type: "text", text: part.text };
            }
            if (part.functionCall) {
              yield {
                type: "tool_call",
                id: `call_${Math.random().toString(36).slice(2, 10)}`,
                name: part.functionCall.name ?? "unknown",
                args: part.functionCall.args ?? {}
              };
            }
          }
          if (candidate.finishReason) {
            const reason = candidate.finishReason;
            finishReason = reason === "STOP" ? "stop" : reason.toLowerCase();
            sawFinish = reason !== "FINISH_REASON_UNSPECIFIED";
          }
        }
        const error = payload.error as { message?: string; status?: string } | undefined;
        if (error) throw new RannError("E_PROVIDER_UNAVAILABLE", error.message ?? "Gemini mengirim error");
      }

      if (!sawFinish) throw new RannError("E_STREAM_TRUNCATED", `Stream dari ${this.name} berakhir tanpa finishReason`);
      if (outputTokens === 0) outputTokens = Math.ceil(textChars / 4);
      yield { type: "usage", inputTokens, outputTokens };
      yield { type: "done", finishReason };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}
