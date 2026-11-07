import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { McpManager } from "./mcp.js";

const servers: Array<ReturnType<typeof createServer>> = [];

function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      data += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(data) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function startMock(): Promise<{ url: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const message = await body(request);
      const method = String(message.method ?? "");
      calls.push(method);
      if (method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.setHeader("mcp-session-id", "sesi-http-1");
      if (method === "initialize") {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "mock", version: "1" } } }));
        return;
      }
      if (method === "tools/list") {
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] }
        }));
        return;
      }
      if (method === "tools/call") {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "halo http" }] } }));
        return;
      }
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "tidak ada" } }));
    })();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("alamat server tidak terbaca");
  return { url: `http://127.0.0.1:${address.port}/mcp`, calls };
}

describe("McpManager HTTP", () => {
  it("menghubungi Streamable HTTP, memakai session id, dan memanggil tool", async () => {
    const mock = await startMock();
    const manager = new McpManager({
      remote: {
        transport: "http",
        url: mock.url,
        headers: {},
        enabled: true,
        timeout_ms: 5_000
      }
    });
    try {
      const specs = await manager.listTools();
      expect(specs.map((spec) => spec.name)).toContain("mcp__remote__echo");
      const result = await manager.callTool("mcp__remote__echo", { text: "hai" });
      expect(result).toMatchObject({ server: "remote", tool: "echo", content: "halo http" });
      expect(mock.calls).toContain("tools/call");
    } finally {
      await manager.close();
    }
  });
});
