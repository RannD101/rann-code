import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { MockProvider } from "./mock.js";
import { OpenAiCompatibleProvider } from "./openai.js";
import { OpenAiResponsesProvider } from "./openai-responses.js";
import type { ChatRequest, Provider } from "./types.js";
import { probeHealth, requestJson } from "./adapter-helpers.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(
  handler: (request: IncomingMessage, body: string, response: ServerResponse) => void
): Promise<string> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => handler(request, body, response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("alamat server tidak valid");
  servers.push({
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  });
  return `http://127.0.0.1:${address.port}`;
}

function json(response: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

async function collect(provider: Provider, request: ChatRequest) {
  const chunks = [];
  for await (const chunk of provider.chat(request)) chunks.push(chunk);
  return chunks;
}

describe("dukungan adapter di luar chat", () => {
  it("mendaftar model, embed, dan health lewat endpoint provider", async () => {
    const seen: string[] = [];
    const baseUrl = await serve((request, body, response) => {
      seen.push(`${request.method} ${request.url}`);
      if (request.url?.endsWith("/models")) {
        json(response, {
          data: [
            { id: "gpt-x", name: "gpt-x", context_window: 200_000 },
            { id: "gpt-y" },
            { nama: "tanpa-id" }
          ]
        });
        return;
      }
      if (request.url?.endsWith("/embeddings")) {
        json(response, { data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 3 } });
        return;
      }
      json(response, { error: { message: "tidak dikenal" } }, 404);
    });
    const provider = new OpenAiCompatibleProvider({ name: "uji", baseUrl, apiKey: "kunci" });
    expect(provider.support).toEqual({ embed: true, listModels: true, health: true, countTokens: true });

    const models = await provider.listModels?.();
    expect(models?.map((entry) => entry.id)).toEqual(["gpt-x", "gpt-y"]);
    expect(models?.[0]?.contextWindow).toBe(200_000);

    const embedded = await provider.embed?.({ model: "gpt-x", input: ["a", "b"] });
    expect(embedded?.vectors).toEqual([[0.1, 0.2]]);
    expect(embedded?.inputTokens).toBe(3);

    const health = await provider.health?.();
    expect(health?.ok).toBe(true);
    expect(health?.status).toBe("healthy");
    expect(seen).toContain("GET /models");
    expect(seen).toContain("POST /embeddings");
  });

  it("mengirim response_format dan memancarkan request id provider", async () => {
    let received: Record<string, unknown> = {};
    const baseUrl = await serve((request, body, response) => {
      received = JSON.parse(body) as Record<string, unknown>;
      json(
        response,
        {
          choices: [{ message: { content: "jawaban" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 4, completion_tokens: 2 }
        },
        200,
        { "x-request-id": "req_abc" }
      );
    });
    const provider = new OpenAiCompatibleProvider({ name: "uji", baseUrl, apiKey: "kunci", stream: false });
    const chunks = await collect(provider, {
      model: "gpt-x",
      messages: [{ role: "user", content: "halo" }],
      responseFormat: { type: "json_schema", name: "hasil", schema: { type: "object" } }
    });
    expect(received.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "hasil", schema: { type: "object" }, strict: true }
    });
    expect(chunks[0]).toEqual({ type: "request_id", id: "req_abc" });
    expect(chunks).toContainEqual({ type: "text", text: "jawaban" });
  });

  it("menandai dukungan yang tidak ada dan tetap menolak dengan kode jelas", async () => {
    const anthropic = new AnthropicProvider({ name: "a", baseUrl: "http://127.0.0.1:9", apiKey: "k" });
    expect(anthropic.support.embed).toBe(false);
    expect((anthropic as { embed?: unknown }).embed).toBeUndefined();
    const gemini = new GeminiProvider({ name: "g", baseUrl: "http://127.0.0.1:9", apiKey: "k" });
    expect(gemini.support.listModels).toBe(true);
    const responses = new OpenAiResponsesProvider({ name: "r", baseUrl: "http://127.0.0.1:9", apiKey: "k" });
    expect(responses.support).toBeDefined();
  });

  it("mock memenuhi seluruh permukaan provider", async () => {
    const mock = new MockProvider();
    expect(mock.support).toEqual({ embed: true, listModels: true, health: true, countTokens: true });
    expect((await mock.listModels()).map((entry) => entry.id)).toEqual(["mock-1"]);
    expect((await mock.health()).ok).toBe(true);
    const embedded = await mock.embed({ model: "mock-1", input: ["halo"] });
    expect(embedded.vectors[0]?.length).toBe(8);
    expect(mock.countTokens({ model: "mock-1", messages: [{ role: "user", content: "halo" }] })).toBeGreaterThan(0);
    expect(mock.stream).toBeTypeOf("function");
  });

  it("requestJson memetakan timeout dan status error", async () => {
    const baseUrl = await serve((request, body, response) => {
      if (request.url?.includes("/lambat")) {
        setTimeout(() => json(response, { ok: true }), 400);
        return;
      }
      json(response, { error: { message: "kunci salah" } }, 401);
    });
    await expect(requestJson({ url: `${baseUrl}/lambat`, headers: {}, label: "Uji", timeoutMs: 50 })).rejects.toMatchObject({
      code: "E_TIMEOUT"
    });
    await expect(requestJson({ url: `${baseUrl}/auth`, headers: {}, label: "Uji" })).rejects.toMatchObject({
      code: "E_PROVIDER_AUTH"
    });
    const health = await probeHealth(`${baseUrl}/auth`, {}, "Uji", 2_000);
    expect(health.ok).toBe(false);
    expect(health.status).toBe("down");
  });
});
