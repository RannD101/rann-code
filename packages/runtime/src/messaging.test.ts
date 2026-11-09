import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventEnvelope, RannConfig } from "@rann/shared";
import { createSession, getMappedSession, openDatabase, type Db } from "@rann/storage";
import { TelegramAdapter, splitTelegramMessage } from "./messaging.js";

const cleanups: Array<() => void> = [];

function setup(overrides: { allowed?: string[] } = {}): {
  adapter: TelegramAdapter;
  db: Db;
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  sent: string[];
} {
  const home = mkdtempSync(join(tmpdir(), "rann-msg-"));
  const opened = openDatabase({ path: join(home, "rann.db") });
  const db = opened.db;
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const sent: string[] = [];
  const config = {
    messaging: {
      telegram: {
        enabled: true,
        token_env: "RANN_TEST_TELEGRAM_TOKEN",
        allowed_chats: overrides.allowed ?? ["123"]
      }
    }
  } as unknown as RannConfig;
  process.env.RANN_TEST_TELEGRAM_TOKEN = "test-token";
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (url.includes("/getUpdates")) return new Response(JSON.stringify({ ok: true, result: [] }));
    if (url.includes("/sendMessage")) {
      sent.push(String(body.text ?? ""));
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
    }
    if (url.includes("/answerCallbackQuery")) {
      return new Response(JSON.stringify({ ok: true, result: true }));
    }
    return new Response(JSON.stringify({ ok: false, description: "tidak dikenal" }), { status: 404 });
  }) as typeof fetch;
  const adapter = new TelegramAdapter({
    db,
    config,
    invoke: async (method, params) => {
      calls.push({ method, params });
      if (method === "session.create") {
        const session = createSession(db, {
          title: String(params.title ?? "Telegram"),
          projectPath: home,
          model: "mock",
          permissionMode: "ask"
        });
        return { id: session.id };
      }
      if (method === "session.send") return { turnId: "turn-1", status: "running" };
      if (method === "session.get") {
        return {
          id: "ses-msg-1",
          project_path: home,
          messages: [{ role: "assistant", content: "hasil kerja", turn_id: "turn-1" }]
        };
      }
      if (method === "usage.summary") return { turns: 1, total_tokens: 10, cost_usd: 0.001 };
      if (method === "health") return { status: "ok" };
      if (method === "permission.respond") return { ok: true };
      return {};
    },
    subscribe: () => () => undefined,
    fetchImpl,
    apiBase: "https://telegram.test",
    autoPoll: false
  });
  cleanups.push(() => {
    db.close();
    rmSync(home, { recursive: true, force: true });
    delete process.env.RANN_TEST_TELEGRAM_TOKEN;
  });
  return { adapter, db, calls, sent };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("messaging telegram", () => {
  it("memecah pesan panjang dengan penanda bagian", () => {
    const chunks = splitTelegramMessage("a".repeat(9_000), 3_800);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.endsWith("(1/3)")).toBe(true);
    expect(chunks[2]?.endsWith("(3/3)")).toBe(true);
  });

  it("membuat sesi dari chat yang diizinkan lalu mengirim prompt", async () => {
    const { adapter, db, calls, sent } = setup();
    await adapter.handleUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 123, type: "private", username: "rann" },
        text: "halo rann"
      }
    });
    const create = calls.find((call) => call.method === "session.create");
    const send = calls.find((call) => call.method === "session.send");
    expect(create?.params.permissionMode).toBe("ask");
    expect(send?.params.text).toBe("halo rann");
    expect(getMappedSession(db, "telegram", "telegram", "123:0")).toBeDefined();
    expect(sent[0]).toContain("Sedang dikerjakan");
  });

  it("mengabaikan chat di luar allowlist", async () => {
    const { adapter, calls } = setup({ allowed: ["999"] });
    await adapter.handleUpdate({
      update_id: 2,
      message: { message_id: 11, chat: { id: 123 }, text: "halo" }
    });
    expect(calls).toHaveLength(0);
  });

  it("menjawab /status dari usage.summary", async () => {
    const { adapter, sent } = setup();
    await adapter.handleUpdate({
      update_id: 3,
      message: { message_id: 12, chat: { id: 123 }, text: "/status" }
    });
    expect(sent[0]).toContain("status daemon: ok");
    expect(sent[0]).toContain("biaya: $0.0010");
  });

  it("meneruskan hasil turn ke chat yang terikat", async () => {
    const { adapter, db, sent } = setup();
    await adapter.handleUpdate({
      update_id: 4,
      message: { message_id: 13, chat: { id: 123 }, text: "kerjakan" }
    });
    const sessionId = getMappedSession(db, "telegram", "telegram", "123:0") ?? "";
    const event: EventEnvelope = {
      id: "ev-1",
      sessionId,
      turnId: "turn-1",
      type: "turn.end",
      at: Date.now(),
      data: { status: "completed" }
    } as EventEnvelope;
    adapter.onEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent.some((text) => text.includes("hasil kerja"))).toBe(true);
  });

  it("menyetujui izin lewat callback inline", async () => {
    const { adapter, calls } = setup();
    await adapter.handleUpdate({
      update_id: 5,
      message: { message_id: 14, chat: { id: 123 }, text: "kerjakan" }
    });
    await adapter.handleCallback({
      id: "cb-1",
      data: "ap:req-9",
      message: { message_id: 20, chat: { id: 123 } }
    });
    const respond = calls.find((call) => call.method === "permission.respond");
    expect(respond?.params).toMatchObject({ requestId: "req-9", approved: true });
  });

describe("topik Telegram", () => {
  it("AC-132 pesan di topik berbeda membuat sesi terpisah", async () => {
    const { adapter, calls } = setup();
    const base = {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 123, type: "supergroup", title: "Grup" },
      from: { id: 9, is_bot: false, first_name: "Randi" }
    };
    await adapter.handleUpdate({ update_id: 1, message: { ...base, message_thread_id: 11, text: "topik A" } } as never);
    await adapter.handleUpdate({ update_id: 2, message: { ...base, message_id: 2, message_thread_id: 12, text: "topik B" } } as never);
    const created = calls.filter((call) => call.method === "session.create");
    expect(created).toHaveLength(2);
    expect(created[0]?.params.projectPath).toBe(created[1]?.params.projectPath);
  });
});
});
