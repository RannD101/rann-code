import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpManager, type McpServerConfig } from "./mcp.js";

const FIXTURE = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const tools = [
  {
    name: "echo",
    description: "Mengembalikan teks yang dikirim",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"]
    }
  }
];
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  let result;
  let error;
  if (message.method === "initialize") {
    result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
  } else if (message.method === "tools/list") {
    result = { tools };
  } else if (message.method === "tools/call") {
    result = { content: [{ type: "text", text: "echo:" + String(message.params.arguments.text) }] };
  } else {
    error = { code: -32601, message: "method tidak dikenal" };
  }
  process.stdout.write(JSON.stringify(error ? { jsonrpc: "2.0", id: message.id, error } : { jsonrpc: "2.0", id: message.id, result }) + "\\n");
});
`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "rann-mcp-"));
  const path = join(dir, "server.cjs");
  writeFileSync(path, FIXTURE, "utf8");
  return path;
}

function server(path: string, timeoutMs = 5_000): McpServerConfig {
  return {
    command: process.execPath,
    args: [path],
    env: {},
    enabled: true,
    timeout_ms: timeoutMs
  };
}

describe("McpManager", () => {
  it("menginisialisasi server, membaca tool, dan memanggil tool", async () => {
    const manager = new McpManager({ echo: server(fixture()) }, "test");
    try {
      const tools = await manager.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["mcp__echo__echo"]);
      expect(tools[0]?.description).toContain("Mengembalikan teks");

      const result = await manager.callTool("mcp__echo__echo", { text: "halo" });
      expect(result).toMatchObject({ server: "echo", tool: "echo", content: "echo:halo" });
    } finally {
      await manager.close();
    }
  });

  it("melaporkan server yang gagal start tanpa menggantung", async () => {
    const manager = new McpManager(
      { rusak: { command: "/tidak/ada/perintah", args: [], env: {}, enabled: true, timeout_ms: 2_000 } },
      "test"
    );
    try {
      await expect(manager.listTools()).rejects.toMatchObject({ code: "E_TOOL_FAILED" });
    } finally {
      await manager.close();
    }
  });

  it("menghormati timeout server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-mcp-slow-"));
    const path = join(dir, "slow.cjs");
    writeFileSync(
      path,
      `const rl = require("node:readline").createInterface({ input: process.stdin });
       rl.on("line", (line) => {
         const message = JSON.parse(line);
         if (message.method === "initialize") {
           process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\\n");
         }
       });`,
      "utf8"
    );
    const manager = new McpManager({ lambat: server(path, 300) }, "test");
    try {
      await expect(manager.listTools()).rejects.toThrow(/timeout/);
    } finally {
      await manager.close();
    }
  });
});
