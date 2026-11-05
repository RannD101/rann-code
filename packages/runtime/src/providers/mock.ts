import { estimateTokens, type ChatRequest, type Provider, type ProviderChunk } from "./types.js";

const TOOL_PATTERN = /^tool:([a-z_][a-z0-9_]*)\s+(\{[\s\S]*\})$/i;

/**
 * Provider deterministik untuk tes dan demo tanpa jaringan.
 * Perintah `tool:<nama> {json}` di pesan terakhir memicu satu tool call.
 */
export class MockProvider implements Provider {
  readonly name = "mock";
  readonly kind = "mock";

  constructor(private readonly responsePrefix = "Balasan mock") {}

  async *chat(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    const lastUserIndex = request.messages.findLastIndex((message) => message.role === "user");
    const lastUser = lastUserIndex >= 0 ? request.messages[lastUserIndex] : undefined;
    const text = lastUser?.content ?? "";
    const hadToolResult = request.messages.slice(lastUserIndex + 1).some((message) => message.role === "tool");
    const match = hadToolResult ? null : TOOL_PATTERN.exec(text.trim());

    if (match) {
      const name = match[1]!;
      const rawArgs = match[2]!;
      let args: unknown;
      try {
        args = JSON.parse(rawArgs);
      } catch {
        yield { type: "text", text: "Argumen tool bukan JSON yang valid." };
        yield { type: "usage", inputTokens: estimateTokens(text), outputTokens: 8 };
        yield { type: "done", finishReason: "stop" };
        return;
      }
      yield { type: "tool_call", id: `call_${Date.now()}`, name, args };
      yield { type: "usage", inputTokens: estimateTokens(text), outputTokens: 12 };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    const reply = `${this.responsePrefix}: ${text.slice(0, 200)}`;
    for (const piece of reply.match(/.{1,24}/gs) ?? []) {
      yield { type: "text", text: piece };
    }
    yield { type: "usage", inputTokens: estimateTokens(text), outputTokens: estimateTokens(reply) };
    yield { type: "done", finishReason: "stop" };
  }
}
