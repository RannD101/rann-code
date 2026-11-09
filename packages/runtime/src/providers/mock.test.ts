import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock.js";
import type { ChatRequest, ProviderChunk } from "./types.js";

async function collect(provider: MockProvider, text: string): Promise<ProviderChunk[]> {
  const request: ChatRequest = {
    model: "mock-1",
    messages: [{ role: "user", content: text }],
    tools: []
  };
  const chunks: ProviderChunk[] = [];
  for await (const chunk of provider.chat(request)) chunks.push(chunk);
  return chunks;
}

describe("MockProvider", () => {
  it("menghasilkan teks dan usage untuk skenario sukses", async () => {
    const chunks = await collect(new MockProvider("halo"), "dunia");
    expect(chunks.some((chunk) => chunk.type === "text")).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });
    expect(chunks.some((chunk) => chunk.type === "usage")).toBe(true);
  });

  it.each(["timeout", "429", "500"] as const)("memetakan skenario %s menjadi error", async (scenario) => {
    await expect(collect(new MockProvider(), `scenario:${scenario}`)).rejects.toMatchObject({
      code: scenario === "timeout" ? "E_TIMEOUT" : scenario === "429" ? "E_PROVIDER_RATE_LIMIT" : "E_PROVIDER_UNAVAILABLE"
    });
  });

  it("menghasilkan tool call tidak valid", async () => {
    const chunks = await collect(new MockProvider(), "scenario:invalid-tool");
    expect(chunks).toContainEqual(expect.objectContaining({ type: "tool_call", name: "tool_yang_tidak_ada" }));
    expect(chunks.at(-1)).toMatchObject({ type: "done", finishReason: "tool_calls" });
  });

  it("memotong stream dengan teks parsial", async () => {
    const chunks: ProviderChunk[] = [];
    await expect(async () => {
      for await (const chunk of new MockProvider().chat({ model: "mock-1", messages: [{ role: "user", content: "scenario:truncated" }], tools: [] })) {
        chunks.push(chunk);
      }
    }).rejects.toMatchObject({ code: "E_STREAM_TRUNCATED" });
    expect(chunks.find((chunk) => chunk.type === "text")).toMatchObject({ type: "text", text: "sebagian" });
  });
});
