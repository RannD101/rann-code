import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@rann/shared";
import { RpcClient } from "./client.js";
import { startDaemon } from "./daemon.js";

describe("daemon dan RPC", () => {
  it("menjalankan turn mock dari klien sampai selesai", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-daemon-"));
    const project = mkdtempSync(join(tmpdir(), "rann-project-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);

    try {
      const health = await client.request<{ status: string; database: { schema_version: number } }>("health");
      expect(health.status).toBe("ok");
      expect(health.database.schema_version).toBeGreaterThan(0);

      const events: EventEnvelope[] = [];
      const completed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("turn tidak selesai dalam 10 detik")), 10_000);
        client.onEvent((event) => {
          events.push(event);
          if (event.type === "turn.completed") {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      const session = await client.request<{ id: string }>("session.create", {
        projectPath: project,
        title: "Uji integrasi",
        permissionMode: "trusted"
      });
      const { turnId } = await client.request<{ turnId: string }>("session.send", {
        sessionId: session.id,
        text: "halo dunia"
      });
      await completed;

      const text = events
        .filter((event) => event.type === "message.delta" && event.turnId === turnId)
        .map((event) => String(event.data.text ?? ""))
        .join("");
      expect(text).toBe("Balasan mock: halo dunia");

      const detail = await client.request<{ messages: Array<{ role: string; content: string }> }>("session.get", {
        sessionId: session.id
      });
      expect(detail.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(detail.messages[1]?.content).toBe("Balasan mock: halo dunia");

      const turn = await client.request<{ status: string; usage_json: string; messages: Array<{ role: string; content: string }> }>("turn.get", { turnId });
      expect(turn.status).toBe("done");
      expect(JSON.parse(turn.usage_json)).toMatchObject({ outputTokens: expect.any(Number) });
      expect(turn.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 20_000);

  it("meminta izin lewat event dan mengingat pilihan selalu", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-approval-"));
    const project = mkdtempSync(join(tmpdir(), "rann-approval-proj-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    let approvals = 0;

    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: project,
        permissionMode: "ask"
      });
      const waitTurn = (): Promise<void> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("turn tidak selesai")), 10_000);
          const off = client.onEvent((event) => {
            if (event.type === "approval.requested") {
              approvals += 1;
              const requestId = String(event.data.request_id ?? "");
              void client
                .request("permission.respond", { requestId, approved: true, remember: true })
                .catch(() => undefined);
            }
            if (event.type === "turn.completed" || event.type === "turn.failed") {
              clearTimeout(timer);
              off();
              resolve();
            }
          });
        });

      const first = waitTurn();
      await client.request("session.send", {
        sessionId: session.id,
        text: 'tool:fs_write {"path":"satu.txt","content":"satu\\n"}'
      });
      await first;
      expect(readFileSync(join(project, "satu.txt"), "utf8")).toBe("satu\n");

      const second = waitTurn();
      await client.request("session.send", {
        sessionId: session.id,
        text: 'tool:fs_write {"path":"dua.txt","content":"dua\\n"}'
      });
      await second;
      expect(readFileSync(join(project, "dua.txt"), "utf8")).toBe("dua\n");
      expect(approvals).toBe(1);
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 30_000);

  it("menolak izin tidak menulis berkas dan bertanya lagi di turn berikutnya", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-deny-"));
    const project = mkdtempSync(join(tmpdir(), "rann-deny-proj-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    let approvals = 0;

    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: project,
        permissionMode: "ask"
      });
      const runDenied = (path: string): Promise<void> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("turn tidak selesai")), 10_000);
          const off = client.onEvent((event) => {
            if (event.type === "approval.requested") {
              approvals += 1;
              const requestId = String(event.data.request_id ?? "");
              void client.request("permission.respond", { requestId, approved: false }).catch(() => undefined);
            }
            if (event.type === "turn.completed" || event.type === "turn.failed") {
              clearTimeout(timer);
              off();
              resolve();
            }
          });
          void client
            .request("session.send", { sessionId: session.id, text: `tool:fs_write {"path":"${path}","content":"x\\n"}` })
            .catch((error: unknown) => {
              clearTimeout(timer);
              off();
              reject(error as Error);
            });
        });

      await runDenied("tolak-satu.txt");
      expect(existsSync(join(project, "tolak-satu.txt"))).toBe(false);
      expect(approvals).toBe(1);

      await runDenied("tolak-dua.txt");
      expect(existsSync(join(project, "tolak-dua.txt"))).toBe(false);
      expect(approvals).toBe(2);
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 30_000);

  it("mengetes provider lewat RPC", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-provider-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const result = await client.request<Record<string, unknown>>("provider.test", {});
      expect(result.ok).toBe(true);
      expect(result.provider).toBe("mock");
      expect(result.model).toBe("mock-1");
      expect(String(result.reply)).toContain("Balasan mock");
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 20_000);

  it("menyimpan memori lewat tool agent dan membacanya lewat RPC", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-memory-"));
    const project = mkdtempSync(join(tmpdir(), "rann-memory-proj-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: project,
        permissionMode: "trusted"
      });
      const waitTurn = (): Promise<void> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("turn tidak selesai")), 10_000);
          const off = client.onEvent((event) => {
            if (event.type === "turn.completed" || event.type === "turn.failed") {
              clearTimeout(timer);
              off();
              resolve();
            }
          });
        });
      const done = waitTurn();
      await client.request("session.send", {
        sessionId: session.id,
        text: 'tool:memory {"action":"add","text":"User meminta bukti tes nyata","scope":"global","kind":"preference","tags":["tes"]}'
      });
      await done;

      const entries = await client.request<Array<{ id: string; text: string; tags: string[] }>>("memory.list", {
        projectPath: project,
        scope: "global",
        limit: 20
      });
      const saved = entries.find((entry) => entry.text === "User meminta bukti tes nyata");
      expect(saved).toBeDefined();
      expect(saved?.tags).toEqual(["tes"]);

      const found = await client.request<Array<{ id: string }>>("memory.search", {
        projectPath: project,
        query: "bukti tes",
        limit: 10
      });
      expect(found.map((entry) => entry.id)).toContain(saved?.id);

      const removed = await client.request<{ removed: number }>("memory.remove", { projectPath: project, id: saved!.id });
      expect(removed.removed).toBe(1);
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 30_000);

  it("membuat skill lokal lewat RPC dan memakainya di katalog", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-skill-"));
    const project = mkdtempSync(join(tmpdir(), "rann-skill-proj-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const created = await client.request<{ name: string; scope: string }>("skill.create", {
        projectPath: project,
        name: "uji-lokal",
        description: "Gunakan saat menguji penyimpanan skill lokal",
        body: "1. Tulis berkas.\n2. Baca kembali.\n3. Hapus setelah tes.",
        scope: "project"
      });
      expect(created).toMatchObject({ name: "uji-lokal", scope: "project" });
      expect(readFileSync(join(project, ".rann", "skills", "uji-lokal", "SKILL.md"), "utf8")).toContain("uji-lokal");

      const list = await client.request<Array<{ name: string; scope: string }>>("skill.list", { projectPath: project });
      expect(list.some((skill) => skill.name === "uji-lokal" && skill.scope === "project")).toBe(true);
      const view = await client.request<{ body: string }>("skill.view", { projectPath: project, name: "uji-lokal" });
      expect(view.body).toContain("Tulis berkas");

      const removed = await client.request<{ removed: boolean }>("skill.remove", {
        projectPath: project,
        name: "uji-lokal",
        scope: "project"
      });
      expect(removed.removed).toBe(true);
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 20_000);

  it("menjalankan subagent dengan sesi anak dan konteks terpisah", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-subagent-"));
    const project = mkdtempSync(join(tmpdir(), "rann-subagent-proj-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    const events: EventEnvelope[] = [];
    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: project,
        permissionMode: "trusted"
      });
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("subagent tidak selesai")), 15_000);
        client.onEvent((event) => {
          events.push(event);
          if (event.sessionId === session.id && (event.type === "turn.completed" || event.type === "turn.failed")) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      await client.request("session.send", {
        sessionId: session.id,
        text: 'tool:task {"goal":"ringkas satu baris","label":"riset"}'
      });
      await done;

      expect(events.some((event) => event.type === "subagent.started")).toBe(true);
      expect(events.some((event) => event.type === "subagent.finished" && event.data.status === "ok")).toBe(true);
      const sessions = await client.request<Array<{ id: string; title: string; parent_id: string | null }>>("session.list", {
        limit: 20
      });
      const child = sessions.find((entry) => entry.id !== session.id && entry.title.includes("riset"));
      expect(child).toBeDefined();
      expect(child?.parent_id).toBe(session.id);
      const detail = await client.request<{ messages: Array<{ role: string; content: string }> }>("session.get", {
        sessionId: child!.id
      });
      expect(detail.messages[0]?.content).toBe("ringkas satu baris");
      expect(detail.messages.at(-1)?.content).toContain("Balasan mock");
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 30_000);

  it("memuat server MCP dari config dan memanggil tool-nya lewat agent", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-mcp-daemon-"));
    const project = mkdtempSync(join(tmpdir(), "rann-mcp-daemon-proj-"));
    const serverDir = mkdtempSync(join(tmpdir(), "rann-mcp-fixture-"));
    const serverPath = join(serverDir, "server.cjs");
    writeFileSync(
      serverPath,
      `const rl = require("node:readline").createInterface({ input: process.stdin });
       const tools = [{ name: "echo", description: "Balas teks", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }];
       rl.on("line", (line) => {
         let message; try { message = JSON.parse(line); } catch { return; }
         if (message.id === undefined) return;
         let result;
         if (message.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1" } };
         else if (message.method === "tools/list") result = { tools };
         else if (message.method === "tools/call") result = { content: [{ type: "text", text: "echo:" + String(message.params.arguments.text) }] };
         process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
       });`,
      "utf8"
    );
    mkdirSync(join(home, "config"), { recursive: true });
    writeFileSync(
      join(home, "config", "config.toml"),
      `profile = "default"
provider = "mock"

[model]
default = "mock-1"

[permissions]
mode = "ask"
workspace_only = true

[mcp.servers.echo]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(serverPath)}]
`,
      { mode: 0o600 }
    );
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: project,
        permissionMode: "trusted"
      });
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("turn MCP tidak selesai")), 15_000);
        client.onEvent((event) => {
          if (event.sessionId === session.id && (event.type === "turn.completed" || event.type === "turn.failed")) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      await client.request("session.send", {
        sessionId: session.id,
        text: 'tool:mcp__echo__echo {"text":"halo mcp"}'
      });
      await done;
      const detail = await client.request<{ messages: Array<{ role: string; content: string }> }>("session.get", {
        sessionId: session.id
      });
      expect(detail.messages.some((message) => message.role === "tool" && message.content.includes("echo:halo mcp"))).toBe(true);
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 30_000);
});
