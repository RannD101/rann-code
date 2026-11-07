import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventEnvelope, RannConfig } from "@rann/shared";
import { createSession, getChannelCursor, getMappedSession, openDatabase, setChannelCursor, type Db } from "@rann/storage";
import { SlackAdapter } from "./messaging-slack.js";

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

function setup(options: { messages?: unknown[]; attachment?: Buffer; allowedUsers?: string[] } = {}): {
  adapter: SlackAdapter;
  db: Db;
  home: string;
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  requests: RecordedRequest[];
} {
  const home = mkdtempSync(join(tmpdir(), "rann-slack-"));
  const opened = openDatabase({ path: join(home, "rann.db") });
  const db = opened.db;
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const requests: RecordedRequest[] = [];
  process.env.RANN_TEST_SLACK_TOKEN = "test-token";
  const config = {
    messaging: {
      slack: {
        enabled: true,
        token_env: "RANN_TEST_SLACK_TOKEN",
        signing_secret_env: "RANN_TEST_SLACK_SECRET",
        allowed_channels: ["C1"],
        allowed_users: options.allowedUsers ?? [],
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
    const record: RecordedRequest = {
      method,
      url,
      ...(body ? { body } : {}),
      ...(headers.get("authorization") ? { authorization: headers.get("authorization") ?? "" } : {})
    };
    requests.push(record);
    if (url.host === "files.slack.test") {
      return new Response(options.attachment ?? Buffer.from("isi berkas"), { status: 200 });
    }
    if (url.pathname === "/auth.test") return json({ ok: true, user_id: "UBOT", user: "rann" });
    if (url.pathname === "/conversations.history") {
      if (url.searchParams.get("limit") === "1") return json({ ok: true, messages: [] });
      return json({ ok: true, messages: options.messages ?? [] });
    }
    if (url.pathname === "/chat.postMessage") return json({ ok: true, ts: "1750000000.000900" });
    return json({ ok: false, error: "unknown_method" }, 404);
  }) as typeof fetch;
  const adapter = new SlackAdapter({
    db,
    config,
    invoke: async (method, params) => {
      calls.push({ method, params });
      if (method === "session.create") {
        const session = createSession(db, {
          title: String(params.title ?? "Slack"),
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
    slackApiBase: "https://slack.test",
    autoPoll: false
  });
  cleanups.push(() => {
    db.close();
    rmSync(home, { recursive: true, force: true });
    delete process.env.RANN_TEST_SLACK_TOKEN;
  });
  return {
    adapter,
    db,
    home,
    calls,
    requests
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const sampleMessage = {
  type: "message",
  user: "U1",
  text: "halo slack",
  ts: "1750000000.000200",
  thread_ts: "1750000000.000100"
};

describe("messaging slack", () => {
  it("membalas di thread dan tidak memproses ulang cursor yang sama", async () => {
    const { adapter, db, calls, requests } = setup({ messages: [sampleMessage] });
    setChannelCursor(db, "slack:C1", "1750000000.000100");
    await adapter.start();
    await adapter.pollOnce();
    const send = calls.find((call) => call.method === "session.send");
    expect(send?.params.text).toBe("halo slack");
    const posts = (): RecordedRequest[] => requests.filter((request) => request.url.pathname === "/chat.postMessage");
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toMatchObject({
      channel: "C1",
      thread_ts: "1750000000.000100",
      text: "Sedang dikerjakan..."
    });
    expect(getChannelCursor(db, "slack:C1")).toBe("1750000000.000200");
    expect(getMappedSession(db, "slack", "slack", "C1")).toBeDefined();
    await adapter.pollOnce();
    expect(calls.filter((call) => call.method === "session.send")).toHaveLength(1);
    expect(posts()).toHaveLength(1);
    await adapter.stop();
  });

  it("mengirim approval Block Kit dengan fallback teks lalu menerima balasan ya", async () => {
    const { adapter, db, calls, requests } = setup({ messages: [sampleMessage] });
    setChannelCursor(db, "slack:C1", "1750000000.000100");
    await adapter.start();
    await adapter.pollOnce();
    const sessionId = getMappedSession(db, "slack", "slack", "C1") ?? "";
    adapter.onEvent({
      id: "ev-approval",
      sessionId,
      turnId: "turn-1",
      type: "approval.request",
      at: Date.now(),
      data: { request_id: "req-2", tool: "write", args: { path: "src/a.ts" } }
    } as EventEnvelope);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const approval = requests.find((request) => {
      if (request.url.pathname !== "/chat.postMessage") return false;
      const blocks = request.body?.blocks;
      if (!Array.isArray(blocks)) return false;
      const section = blocks[0] as { text?: { text?: string } } | undefined;
      return String(section?.text?.text ?? "").includes("1. Izinkan");
    });
    expect(approval?.body?.text).toContain("Balas 1 atau ya");
    await adapter.handleMessage("C1", {
      type: "message",
      user: "U1",
      text: "ya",
      ts: "1750000000.000500",
      thread_ts: "1750000000.000100"
    });
    const respond = calls.find((call) => call.method === "permission.respond");
    expect(respond?.params).toMatchObject({ requestId: "req-2", approved: true });
    await adapter.stop();
  });

  it("menolak pengguna di luar allowlist", async () => {
    const { adapter, calls } = setup({ allowedUsers: ["U2"] });
    await adapter.start();
    await adapter.handleMessage("C1", {
      type: "message",
      user: "U1",
      text: "halo",
      ts: "1750000000.000300"
    });
    expect(calls).toHaveLength(0);
    await adapter.stop();
  });

  it("mengunduh lampiran ke .rann/slack dengan mode 0600", async () => {
    const attachment = Buffer.from("isi berkas");
    const { adapter, db, home, calls, requests } = setup({
      attachment,
      messages: [
        {
          type: "message",
          subtype: "file_share",
          user: "U1",
          text: "lihat berkas",
          ts: "1750000000.000400",
          files: [{ id: "F1", name: "laporan.txt", size: attachment.length, url_private: "https://files.slack.test/f1" }]
        }
      ]
    });
    setChannelCursor(db, "slack:C1", "1750000000.000100");
    await adapter.start();
    await adapter.pollOnce();
    const dir = join(home, ".rann", "slack");
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const stored = join(dir, files[0] ?? "");
    expect(readFileSync(stored, "utf8")).toBe("isi berkas");
    expect(statSync(stored).mode & 0o777).toBe(0o600);
    const send = calls.find((call) => call.method === "session.send");
    const attachments = send?.params.attachments as Array<{ path: string; name: string }>;
    expect(attachments[0]?.path).toBe(`.rann/slack/${files[0] ?? ""}`);
    expect(attachments[0]?.name).toBe("laporan.txt");
    const download = requests.find((request) => request.url.host === "files.slack.test");
    expect(download?.authorization).toBe("Bearer test-token");
    await adapter.stop();
  });
});
