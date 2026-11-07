import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventEnvelope, RannConfig } from "@rann/shared";
import { createSession, getChannelCursor, getMappedSession, openDatabase, setChannelCursor, type Db } from "@rann/storage";
import { DiscordAdapter } from "./messaging-discord.js";

interface RecordedRequest {
  method: string;
  url: URL;
  body?: Record<string, unknown>;
  authorization?: string;
}

const cleanups: Array<() => void> = [];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function setup(options: { messages?: unknown[]; attachment?: Buffer; allowedRoles?: string[] } = {}): {
  adapter: DiscordAdapter;
  db: Db;
  home: string;
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  requests: RecordedRequest[];
} {
  const home = mkdtempSync(join(tmpdir(), "rann-discord-"));
  const opened = openDatabase({ path: join(home, "rann.db") });
  const db = opened.db;
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const requests: RecordedRequest[] = [];
  process.env.RANN_TEST_DISCORD_TOKEN = "test-token";
  const config = {
    messaging: {
      discord: {
        enabled: true,
        token_env: "RANN_TEST_DISCORD_TOKEN",
        allowed_channels: ["111"],
        allowed_roles: options.allowedRoles ?? [],
        poll_ms: 250
      }
    },
    gateway: { profile: "default" }
  } as unknown as RannConfig;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    requests.push({
      method,
      url,
      ...(body ? { body } : {}),
      ...(headers.get("authorization") ? { authorization: headers.get("authorization") ?? "" } : {})
    });
    if (url.host === "cdn.discord.test") {
      return new Response(options.attachment ?? Buffer.from("isi lampiran"), { status: 200 });
    }
    if (url.pathname === "/api/v10/users/@me") return json({ id: "bot-1", username: "rann", bot: true });
    if (url.pathname === "/api/v10/channels/111") {
      return json({ id: "111", type: 0, guild_id: "g1", name: "umum" });
    }
    if (url.pathname === "/api/v10/channels/999") {
      return json({ message: "Unknown Channel", code: 10003 }, 404);
    }
    if (url.pathname === "/api/v10/channels/111/messages" && method === "GET") {
      if (url.searchParams.has("after")) return json(options.messages ?? []);
      return json([]);
    }
    if (url.pathname === "/api/v10/channels/111/messages/101/threads" && method === "POST") {
      return json({ id: "thread-1", type: 11, parent_id: "111" });
    }
    if (url.pathname === "/api/v10/channels/thread-1/messages" && method === "POST") {
      return json({ id: "out-1" });
    }
    if (url.pathname === "/api/v10/channels/111/messages" && method === "POST") {
      return json({ id: "out-2" });
    }
    return json({ message: "tidak dikenal" }, 404);
  }) as typeof fetch;
  const adapter = new DiscordAdapter({
    db,
    config,
    invoke: async (method, params) => {
      calls.push({ method, params });
      if (method === "session.create") {
        const session = createSession(db, {
          title: String(params.title ?? "Discord"),
          projectPath: home,
          model: "mock",
          permissionMode: "ask"
        });
        return { id: session.id };
      }
      if (method === "session.send") return { turnId: "turn-1", status: "running" };
      if (method === "session.get") return { id: "ses-1", project_path: home, messages: [] };
      if (method === "permission.respond") return { ok: true };
      if (method === "health") return { status: "ok" };
      if (method === "usage.summary") return { turns: 1, total_tokens: 10, cost_usd: 0.001 };
      return {};
    },
    subscribe: () => () => undefined,
    fetchImpl,
    discordApiBase: "https://discord.test/api/v10",
    autoPoll: false
  });
  cleanups.push(() => {
    db.close();
    rmSync(home, { recursive: true, force: true });
    delete process.env.RANN_TEST_DISCORD_TOKEN;
  });
  return { adapter, db, home, calls, requests };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const sampleMessage = {
  id: "101",
  channel_id: "111",
  guild_id: "g1",
  content: "halo rann",
  author: { id: "u1", username: "budi", bot: false },
  member: { roles: ["role-1"] },
  attachments: []
};

describe("messaging discord", () => {
  it("poll memetakan satu pesan ke sesi dan membalas di thread", async () => {
    const { adapter, db, calls, requests } = setup({ messages: [sampleMessage] });
    setChannelCursor(db, "discord:111", "100");
    await adapter.start();
    await adapter.pollOnce();
    const send = calls.find((call) => call.method === "session.send");
    expect(send?.params.text).toBe("halo rann");
    expect(getMappedSession(db, "discord", "discord", "111")).toBeDefined();
    expect(getChannelCursor(db, "discord:111")).toBe("101");
    const thread = requests.find(
      (request) => request.method === "POST" && request.url.pathname === "/api/v10/channels/111/messages/101/threads"
    );
    expect(thread?.body).toMatchObject({ name: "halo rann" });
    const reply = requests.find((request) => request.method === "POST" && request.url.pathname === "/api/v10/channels/thread-1/messages");
    expect(reply?.body).toMatchObject({ content: "Sedang dikerjakan..." });
    await adapter.stop();
  });

  it("menolak pesan dari kanal di luar allowlist", async () => {
    const { adapter, calls, requests } = setup();
    await adapter.start();
    await adapter.handleMessage({
      id: "201",
      channel_id: "999",
      content: "halo",
      author: { id: "u1" },
      member: { roles: ["role-1"] }
    });
    expect(calls).toHaveLength(0);
    expect(requests.some((request) => request.method === "POST" && request.url.pathname.includes("/messages/201/threads"))).toBe(false);
    await adapter.stop();
  });

  it("menolak pengirim tanpa role yang diizinkan", async () => {
    const { adapter, calls } = setup({ allowedRoles: ["role-9"] });
    await adapter.start();
    await adapter.handleMessage({
      id: "202",
      channel_id: "111",
      content: "halo",
      author: { id: "u1" },
      member: { roles: ["role-1"] }
    });
    expect(calls).toHaveLength(0);
    await adapter.stop();
  });

  it("mengirim approval sebagai pesan bernomor lalu menerima balasan 1", async () => {
    const { adapter, db, calls, requests } = setup({ messages: [sampleMessage] });
    setChannelCursor(db, "discord:111", "100");
    await adapter.start();
    await adapter.pollOnce();
    const sessionId = getMappedSession(db, "discord", "discord", "111") ?? "";
    adapter.onEvent({
      id: "ev-approval",
      sessionId,
      turnId: "turn-1",
      type: "approval.request",
      at: Date.now(),
      data: { request_id: "req-1", tool: "shell", args: { command: "ls" } }
    } as EventEnvelope);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const approval = requests.find(
      (request) =>
        request.method === "POST" &&
        request.url.pathname === "/api/v10/channels/thread-1/messages" &&
        String(request.body?.content ?? "").includes("1. Izinkan")
    );
    expect(approval).toBeDefined();
    await adapter.handleMessage({
      id: "301",
      channel_id: "thread-1",
      content: "1",
      author: { id: "u1" },
      member: { roles: ["role-1"] }
    });
    const respond = calls.find((call) => call.method === "permission.respond");
    expect(respond?.params).toMatchObject({ requestId: "req-1", approved: true });
    await adapter.stop();
  });

  it("mengunduh lampiran ke .rann/discord dengan mode 0600", async () => {
    const attachment = Buffer.from("isi lampiran");
    const { adapter, db, home, calls, requests } = setup({
      attachment,
      messages: [
        {
          ...sampleMessage,
          attachments: [
            { id: "att-1", filename: "catatan.txt", size: attachment.length, url: "https://cdn.discord.test/files/catatan.txt" }
          ]
        }
      ]
    });
    setChannelCursor(db, "discord:111", "100");
    await adapter.start();
    await adapter.pollOnce();
    const dir = join(home, ".rann", "discord");
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const stored = join(dir, files[0] ?? "");
    expect(readFileSync(stored, "utf8")).toBe("isi lampiran");
    expect(statSync(stored).mode & 0o777).toBe(0o600);
    const send = calls.find((call) => call.method === "session.send");
    const attachments = send?.params.attachments as Array<{ path: string; name: string }>;
    expect(attachments[0]?.path).toBe(`.rann/discord/${files[0] ?? ""}`);
    expect(attachments[0]?.name).toBe("catatan.txt");
    const download = requests.find((request) => request.url.host === "cdn.discord.test");
    expect(download?.authorization).toBe("Bot test-token");
    await adapter.stop();
  });
});
