import { RannError } from "@rann/shared";
import { estimateTokens, type ChatRequest, type Provider, type ProviderChunk } from "./types.js";

const TOOL_PATTERN = /^tool:([a-z_][a-z0-9_]*)\s+(\{[\s\S]*\})$/i;
const SCENARIO_PATTERN = /^scenario:(timeout|429|500|invalid-tool|truncated)$/i;

export interface MockOptions {
  prefix?: string;
  scenario?: "timeout" | "429" | "500" | "invalid-tool" | "truncated";
}

/**
 * Provider deterministik untuk tes dan demo tanpa jaringan.
 * Perintah `tool:<nama> {json}` di pesan terakhir memicu satu tool call.
 * Perintah `scenario:<nama>` memicu kegagalan terkontrol.
 */
export class MockProvider implements Provider {
  readonly name = "mock";
  readonly kind = "mock";
  private readonly responsePrefix: string;
  private readonly scenario?: MockOptions["scenario"];

  constructor(options: string | MockOptions = "Balasan mock") {
    if (typeof options === "string") {
      this.responsePrefix = options;
    } else {
      this.responsePrefix = options.prefix ?? "Balasan mock";
      this.scenario = options.scenario;
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    const lastUserIndex = request.messages.findLastIndex((message) => message.role === "user");
    const lastUser = lastUserIndex >= 0 ? request.messages[lastUserIndex] : undefined;
    const text = lastUser?.content ?? "";
    const prompted = SCENARIO_PATTERN.exec(text.trim())?.[1]?.toLowerCase() as MockOptions["scenario"] | undefined;
    const scenario = prompted ?? this.scenario;
    if (scenario === "timeout") throw new RannError("E_TIMEOUT", "Mock timeout");
    if (scenario === "429") throw new RannError("E_PROVIDER_RATE_LIMIT", "Mock 429", { data: { status: 429 } });
    if (scenario === "500") throw new RannError("E_PROVIDER_UNAVAILABLE", "Mock 500", { data: { status: 500 } });
    if (scenario === "truncated") {
      yield { type: "text", text: "sebagian" };
      throw new RannError("E_STREAM_TRUNCATED", "Mock stream terpotong");
    }
    if (scenario === "invalid-tool") {
      yield { type: "tool_call", id: `call_${Date.now()}`, name: "tool_yang_tidak_ada", args: { apa: "saja" } };
      yield { type: "usage", inputTokens: estimateTokens(text), outputTokens: 9 };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
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
