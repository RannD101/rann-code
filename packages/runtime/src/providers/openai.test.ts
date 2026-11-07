import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RannError } from "@rann/shared";
import { OpenAiCompatibleProvider } from "./openai.js";
import type { ChatRequest, ProviderChunk } from "./types.js";

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function startServer(handler: (body: string, res: import("node:http").ServerResponse) => void): Promise<string> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => handler(body, res));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("alamat server tidak terbaca");
  return `http://127.0.0.1:${address.port}/v1`;
}

async function collect(provider: OpenAiCompatibleProvider, request: ChatRequest): Promise<ProviderChunk[]> {
  const chunks: ProviderChunk[] = [];
  for await (const chunk of provider.chat(request)) chunks.push(chunk);
  return chunks;
}

describe("provider openai-compatible", () => {
  it("membaca stream teks, tool call, dan usage", async () => {
    let captured: Record<string, unknown> = {};
    const baseUrl = await startServer((body, res) => {
      captured = JSON.parse(body) as Record<string, unknown>;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"Halo"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":" dunia"}}]}\n\n');
      res.write(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_x","function":{"name":"fs_read","arguments":"{\\"path\\":"}}]}}]}\n\n'
      );
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]}}]}\n\n');
      res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":4}}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });

    const provider = new OpenAiCompatibleProvider({ name: "uji", baseUrl, apiKey: "rahasia" });
    const chunks = await collect(provider, { model: "uji-1", messages: [{ role: "user", content: "halo" }] });

    expect(chunks.filter((chunk) => chunk.type === "text").map((chunk) => (chunk as { text: string }).text).join("")).toBe("Halo dunia");
    const call = chunks.find((chunk) => chunk.type === "tool_call") as { name: string; args: unknown } | undefined;
    expect(call?.name).toBe("fs_read");
    expect(call?.args).toEqual({ path: "a.txt" });
    expect(chunks.find((chunk) => chunk.type === "usage")).toMatchObject({ inputTokens: 11, outputTokens: 4 });
    expect(chunks.at(-1)).toMatchObject({ type: "done", finishReason: "tool_calls" });
    expect(captured.model).toBe("uji-1");
    expect(captured.stream).toBe(true);
  });

  it("memetakan 401 ke E_PROVIDER_AUTH", async () => {
    const baseUrl = await startServer((_body, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "kunci salah" } }));
    });
    const provider = new OpenAiCompatibleProvider({ name: "uji", baseUrl, apiKey: "salah" });
    try {
      await collect(provider, { model: "uji-1", messages: [{ role: "user", content: "halo" }] });
      throw new Error("seharusnya gagal");
    } catch (error) {
      expect(error).toBeInstanceOf(RannError);
      expect((error as RannError).code).toBe("E_PROVIDER_AUTH");
      expect((error as RannError).message).toContain("kunci salah");
    }
  });

  it("mendukung mode non-stream", async () => {
    const baseUrl = await startServer((_body, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "jawaban" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 1 }
        })
      );
    });
    const provider = new OpenAiCompatibleProvider({ name: "uji", baseUrl, apiKey: "k", stream: false });
    const chunks = await collect(provider, { model: "uji-1", messages: [{ role: "user", content: "hai" }] });
    expect(chunks).toEqual([
      { type: "text", text: "jawaban" },
      { type: "usage", inputTokens: 2, outputTokens: 1 },
      { type: "done", finishReason: "stop" }
    ]);
  });
  it("mengirim gambar sebagai data URL, bukan base64 di content teks", async () => {
    let captured: Record<string, unknown> = {};
    const baseUrl = await startServer((body, res) => {
      captured = JSON.parse(body) as Record<string, unknown>;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });
    const provider = new OpenAiCompatibleProvider({ name: "uji", baseUrl, apiKey: "k" });
    await collect(provider, {
      model: "uji-1",
      messages: [{
        role: "user",
        content: "lihat gambar",
        attachments: [{ name: "a.png", mime: "image/png", dataBase64: "AAAA" }]
      }]
    });
    const messages = captured.messages as Array<{ content: Array<Record<string, unknown>> }>;
    expect(messages[0]?.content[0]).toEqual({ type: "text", text: "lihat gambar" });
    expect(messages[0]?.content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  });
});
