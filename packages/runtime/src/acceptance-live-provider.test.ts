import { describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "./providers/openai.js";
import type { ChatRequest, ProviderChunk } from "./providers/types.js";

const key = process.env.RANN_LIVE_API_KEY;
const baseUrl = process.env.RANN_LIVE_BASE_URL ?? "https://api.rannd.web.id/v1";

async function collect(provider: OpenAiCompatibleProvider, request: ChatRequest): Promise<ProviderChunk[]> {
  const chunks: ProviderChunk[] = [];
  for await (const chunk of provider.chat(request)) chunks.push(chunk);
  return chunks;
}

describe.skipIf(!key)("provider nyata", () => {
  it("AC-102 chat dan tool call berhasil, key salah menghasilkan E_PROVIDER_AUTH", async () => {
    const provider = new OpenAiCompatibleProvider({ name: "live", baseUrl, apiKey: key!, stream: false });
    const chunks = await collect(provider, {
      model: "river/GLM-5.3",
      messages: [{ role: "user", content: "Balas satu kata: halo" }],
      maxTokens: 500
    });
    const text = chunks.filter((chunk) => chunk.type === "text").map((chunk) => chunk.text).join("");
    expect(text.length).toBeGreaterThan(0);

    const toolChunks = await collect(provider, {
      model: "river/GLM-5.3",
      messages: [{ role: "user", content: "Gunakan tool get_weather untuk Jakarta." }],
      tools: [
        {
          name: "get_weather",
          description: "Ambil cuaca kota",
          parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] }
        }
      ],
      maxTokens: 500
    });
    expect(toolChunks.some((chunk) => chunk.type === "tool_call" && chunk.name === "get_weather")).toBe(true);

    const bad = new OpenAiCompatibleProvider({ name: "bad", baseUrl, apiKey: "rd-invalid", stream: false });
    await expect(collect(bad, { model: "river/GLM-5.3", messages: [{ role: "user", content: "halo" }], maxTokens: 10 })).rejects.toMatchObject({ code: "E_PROVIDER_AUTH" });
  }, 120_000);
});
