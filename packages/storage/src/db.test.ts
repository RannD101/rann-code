import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addMemory,
  addMessage,
  addToolCall,
  appendEvent,
  completeToolCall,
  countMemories,
  createSession,
  createTurn,
  eventsForSession,
  finishTurn,
  getSession,
  getTurn,
  inspectDatabase,
  LATEST_VERSION,
  listMemories,
  listMessages,
  listSessions,
  markTurnRunning,
  openDatabase,
  recordUsage,
  removeMemory,
  schemaVersion,
  searchMemories,
  summarizeUsage,
  sumTokensSince,
  updateMemory,
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

  it("menyimpan memori global dan proyek dengan pencarian FTS", () => {
    const { db, dir } = freshDb();
    const projectA = join(dir, "proyek-a");
    const projectB = join(dir, "proyek-b");

    const globalEntry = addMemory(db, {
      text: "User memakai bahasa Indonesia dalam semua jawaban",
      scope: "global",
      kind: "preference",
      tags: ["bahasa", "gaya"]
    });
    const projectEntry = addMemory(db, {
      text: "Proyek A memakai pnpm dan TypeScript strict",
      projectPath: projectA,
      kind: "convention",
      tags: ["tooling"]
    });
    addMemory(db, { text: "Proyek B memakai PHP 8", projectPath: projectB });

    expect(globalEntry.scope).toBe("global");
    expect(globalEntry.tags).toEqual(["bahasa", "gaya"]);
    expect(projectEntry.project_path).toBe(projectA);
    expect(countMemories(db, { scope: "all", projectPath: projectA })).toBe(2);
    expect(countMemories(db, { scope: "all", projectPath: projectB })).toBe(2);
    expect(listMemories(db, { scope: "project", projectPath: projectB })).toHaveLength(1);

    const found = searchMemories(db, "pnpm TypeScript", { scope: "all", projectPath: projectA });
    expect(found.map((entry) => entry.id)).toContain(projectEntry.id);
    const globalFound = searchMemories(db, "bahasa Indonesia", { scope: "all", projectPath: projectB });
    expect(globalFound.map((entry) => entry.id)).toContain(globalEntry.id);

    const duplicate = addMemory(db, {
      text: "Proyek A memakai pnpm dan TypeScript strict",
      projectPath: projectA,
      tags: ["baru"]
    });
    expect(duplicate.id).toBe(projectEntry.id);
    expect(duplicate.tags).toEqual(["tooling", "baru"]);

    const updated = updateMemory(db, projectEntry.id, { text: "Proyek A memakai pnpm", kind: "fact" });
    expect(updated?.text).toBe("Proyek A memakai pnpm");
    expect(updated?.kind).toBe("fact");

    expect(removeMemory(db, projectEntry.id)).toBe(1);
    expect(removeMemory(db, projectEntry.id)).toBe(0);
    expect(listMemories(db, { scope: "all", projectPath: projectA })).toHaveLength(1);
  });

  it("menghitung token sejak waktu tertentu", () => {
    const { db, dir } = freshDb();
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
    const turn = createTurn(db, { sessionId: session.id });
    const old = Date.now() - 48 * 60 * 60 * 1000;
    db.prepare(
      "INSERT INTO usage_events (id, provider, model, session_id, turn_id, input_tokens, output_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("use_lama", "mock", "mock-1", session.id, turn.id, 100, 50, 0, old);
    recordUsage(db, { provider: "mock", model: "mock-1", sessionId: session.id, turnId: turn.id, inputTokens: 7, outputTokens: 3 });
    expect(sumTokensSince(db, old + 60_000)).toBe(10);
    expect(sumTokensSince(db, 0)).toBe(160);
  });
});
