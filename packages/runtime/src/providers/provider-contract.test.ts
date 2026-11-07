import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAiResponsesProvider } from "./openai-responses.js";
import type { ChatRequest, ProviderChunk } from "./types.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(handler: (request: IncomingMessage, body: string, response: ServerResponse) => void): Promise<string> {
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
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  });
  return `http://127.0.0.1:${address.port}`;
}

function sse(response: ServerResponse, events: Array<{ event?: string; data: unknown }>): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const item of events) {
    const payload = typeof item.data === "string" ? item.data : JSON.stringify(item.data);
    if (item.event) response.write(`event: ${item.event}\n`);
    response.write(`data: ${payload}\n\n`);
  }
  response.end();
}

async function collect(provider: { chat: (request: ChatRequest) => AsyncGenerator<ProviderChunk> }): Promise<ProviderChunk[]> {
  const chunks: ProviderChunk[] = [];
  for await (const chunk of provider.chat({ model: "model-1", messages: [{ role: "user", content: "halo" }] })) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("kontrak adapter provider", () => {
  it("anthropic menormalkan teks, tool use, usage, dan stop", async () => {
    const baseUrl = await serve((request, body, response) => {
      expect(request.headers["x-api-key"]).toBe("kunci");
      expect(request.headers["anthropic-version"]).toBe("2023-06-01");
      expect(JSON.parse(body).stream).toBe(true);
      sse(response, [
        { event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 12 } } } },
        {
          event: "content_block_start",
          data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }
        },
        { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Halo" } } },
        {
          event: "content_block_start",
          data: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "read_file" } }
        },
        {
          event: "content_block_delta",
          data: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":"a.txt"}' } }
        },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
        {
          event: "message_delta",
          data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } }
        },
        { event: "message_stop", data: { type: "message_stop" } }
      ]);
    });
    const chunks = await collect(new AnthropicProvider({ name: "anthropic", baseUrl, apiKey: "kunci" }));
    expect(chunks).toEqual([
      { type: "text", text: "Halo" },
      { type: "tool_call", id: "toolu_1", name: "read_file", args: { path: "a.txt" } },
      { type: "usage", inputTokens: 12, outputTokens: 7 },
      { type: "done", finishReason: "tool_use" }
    ]);
  });

  it("gemini menormalkan parts dan usageMetadata", async () => {
    const baseUrl = await serve((request, body, response) => {
      expect(request.headers["x-goog-api-key"]).toBe("kunci");
      expect(request.url).toContain(":streamGenerateContent");
      expect(JSON.parse(body).contents[0].parts[0].text).toBe("halo");
      sse(response, [
        {
          data: {
            candidates: [{ content: { parts: [{ text: "Hai" }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 }
          }
        },
        {
          data: {
            candidates: [
              { content: { parts: [{ functionCall: { name: "read_file", args: { path: "b.txt" } } }] }, finishReason: "STOP" }
            ]
          }
        }
      ]);
    });
    const chunks = await collect(new GeminiProvider({ name: "gemini", baseUrl, apiKey: "kunci" }));
    expect(chunks[0]).toEqual({ type: "text", text: "Hai" });
    expect(chunks[1]).toMatchObject({ type: "tool_call", name: "read_file", args: { path: "b.txt" } });
    expect(chunks.find((chunk) => chunk.type === "usage")).toEqual({ type: "usage", inputTokens: 5, outputTokens: 2 });
    expect(chunks.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  it("openai responses menormalkan output_text dan function_call", async () => {
    const baseUrl = await serve((request, body, response) => {
      expect(request.headers.authorization).toBe("Bearer kunci");
      expect(JSON.parse(body).stream).toBe(true);
      sse(response, [
        { data: { type: "response.output_text.delta", delta: "Hai" } },
        {
          data: {
            type: "response.output_item.added",
            item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read_file", arguments: "" }
          }
        },
        { data: { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"path":"c.txt"}' } },
        {
          data: {
            type: "response.output_item.done",
            item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read_file", arguments: '{"path":"c.txt"}' }
          }
        },
        { data: { type: "response.completed", response: { status: "completed", usage: { input_tokens: 9, output_tokens: 4 } } } }
      ]);
    });
    const chunks = await collect(new OpenAiResponsesProvider({ name: "responses", baseUrl, apiKey: "kunci" }));
    expect(chunks).toEqual([
      { type: "text", text: "Hai" },
      { type: "tool_call", id: "call_1", name: "read_file", args: { path: "c.txt" } },
      { type: "usage", inputTokens: 9, outputTokens: 4 },
      { type: "done", finishReason: "stop" }
    ]);
  });

  it("memetakan 401 dan stream tanpa penutup", async () => {
    const baseUrl = await serve((request, body, response) => {
      if (request.url?.includes("/v1/messages")) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "kunci salah" } }));
        return;
      }
      sse(response, [{ data: { candidates: [{ content: { parts: [{ text: "x" }] } }] } }]);
    });
    const auth = new AnthropicProvider({ name: "anthropic", baseUrl, apiKey: "salah" });
    await expect(collect(auth)).rejects.toMatchObject({ code: "E_PROVIDER_AUTH" });
    const truncated = new GeminiProvider({ name: "gemini", baseUrl, apiKey: "kunci" });
    await expect(collect(truncated)).rejects.toMatchObject({ code: "E_STREAM_TRUNCATED" });
  });
});
