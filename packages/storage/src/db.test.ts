import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addMessage,
  addToolCall,
  appendEvent,
  completeToolCall,
  createSession,
  createTurn,
  eventsForSession,
  finishTurn,
  getSession,
  getTurn,
  inspectDatabase,
  LATEST_VERSION,
  listMessages,
  listSessions,
  markTurnRunning,
  openDatabase,
  recordUsage,
  schemaVersion,
  summarizeUsage,
  type Db
} from "./index.js";

const open: Db[] = [];

function freshDb(): { db: Db; path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "rann-db-"));
  const path = join(dir, "rann.db");
  const { db } = openDatabase({ path });
  open.push(db);
  return { db, path, dir };
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe("database", () => {
  it("menjalankan migrasi sampai versi terbaru dan idempoten", () => {
    const { db, path } = freshDb();
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
    db.close();
    open.pop();
    const second = openDatabase({ path });
    open.push(second.db);
    expect(second.applied).toEqual([]);
    expect(schemaVersion(second.db)).toBe(LATEST_VERSION);
    expect(inspectDatabase(path)).toMatchObject({ ok: true, schemaVersion: LATEST_VERSION });
  });

  it("menyimpan sesi, turn, pesan, dan event", () => {
    const { db, dir } = freshDb();
    const session = createSession(db, {
      projectPath: join(dir, "proyek"),
      title: "Uji sesi",
      model: "mock-1",
      permissionMode: "ask"
    });
    expect(getSession(db, session.id)?.title).toBe("Uji sesi");
    expect(listSessions(db, { limit: 10 })).toHaveLength(1);
    expect(listSessions(db, { limit: 10, projectPath: join(dir, "proyek") })).toHaveLength(1);
    expect(listSessions(db, { limit: 10, projectPath: join(dir, "lain") })).toHaveLength(0);

    const turn = createTurn(db, { sessionId: session.id });
    markTurnRunning(db, turn.id);
    expect(getTurn(db, turn.id)?.status).toBe("running");

    addMessage(db, { sessionId: session.id, turnId: turn.id, role: "user", content: "halo" });
    addMessage(db, { sessionId: session.id, turnId: turn.id, role: "assistant", content: "hai" });
    const messages = listMessages(db, session.id, 10);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);

    const toolCall = addToolCall(db, { sessionId: session.id, turnId: turn.id, toolName: "fs_read", args: { path: "a.txt" } });
    completeToolCall(db, toolCall.id, { status: "ok", result: { content: "x" }, durationMs: 3 });
    const events = appendEvent(db, { type: "turn.started", sessionId: session.id, turnId: turn.id, data: { model: "mock-1" } });
    expect(events.seq).toBeGreaterThan(0);
    expect(eventsForSession(db, session.id).length).toBeGreaterThan(0);

    finishTurn(db, { id: turn.id, status: "done", usage: { inputTokens: 3, outputTokens: 2 } });
    expect(getTurn(db, turn.id)?.status).toBe("done");

    recordUsage(db, { provider: "mock", model: "mock-1", sessionId: session.id, turnId: turn.id, inputTokens: 3, outputTokens: 2 });
    const summary = summarizeUsage(db);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ provider: "mock", model: "mock-1", turns: 1, input_tokens: 3, output_tokens: 2 });
    expect(summarizeUsage(db, session.id)).toHaveLength(1);
    expect(summarizeUsage(db, "sesi-lain")).toHaveLength(0);
  });
});
