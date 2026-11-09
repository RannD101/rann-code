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
  ensureDefaultProfile,
  eventsForSession,
  finishTurn,
  getSession,
  getTurn,
  inspectDatabase,
  LATEST_VERSION,
  MIGRATIONS,
  listMemories,
  listMessages,
  listSessions,
  markTurnRunning,
  openDatabase,
  recordUsage,
  removeMemory,
  recoverInterruptedTurns,
  schemaVersion,
  searchMemories,
  summarizeUsage,
  sumCostSince,
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

  it("memulihkan backup kalau migrasi gagal", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-migrate-"));
    const path = join(dir, "rann.db");
    const first = openDatabase({ path, migrations: MIGRATIONS.slice(0, 2) });
    first.db.prepare("INSERT INTO config_kv (key, value_json, scope, scope_id, updated_at) VALUES ('uji', '\"aman\"', 'global', '', 1)").run();
    first.db.close();

    const broken = [
      ...MIGRATIONS.slice(0, 2),
      { version: 3, name: "broken", sql: "CREATE TABLE sementara (id TEXT); INSERT INTO tabel_tidak_ada VALUES (1);" }
    ];
    expect(() => openDatabase({ path, migrations: broken })).toThrow(/dipulihkan/);

    const restored = openDatabase({ path, migrations: MIGRATIONS.slice(0, 2) });
    open.push(restored.db);
    expect(schemaVersion(restored.db)).toBe(2);
    const row = restored.db.prepare("SELECT value_json FROM config_kv WHERE key = 'uji'").get() as { value_json: string };
    expect(row.value_json).toBe('"aman"');
  });

  it("menyediakan seluruh tabel skema V1", () => {
    const { db } = freshDb();
    const names = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
    );
    for (const table of [
      "profiles",
      "projects",
      "sessions",
      "turns",
      "messages",
      "tool_calls",
      "tasks",
      "task_steps",
      "plans",
      "plan_nodes",
      "agents",
      "agent_runs",
      "agent_messages",
      "memory_entries",
      "memory_links",
      "memory_events",
      "skills",
      "skill_versions",
      "tools",
      "mcp_servers",
      "plugins",
      "hooks",
      "providers",
      "models",
      "model_capabilities",
      "routing_logs",
      "scheduler_jobs",
      "job_runs",
      "jobs",
      "job_events",
      "checkpoints",
      "artifacts",
      "path_leases",
      "approvals",
      "audit_log",
      "usage_events",
      "config_kv",
      "events"
    ]) {
      expect(names.has(table), `tabel ${table} tidak ada`).toBe(true);
    }
    expect(names.has("memories")).toBe(false);
  });

  it("mengisolasi memori per profil", () => {
    const { db } = freshDb();
    const defaultProfile = ensureDefaultProfile(db);
    const at = Date.now();
    db.prepare("INSERT INTO profiles (id, name, locale, settings_json, created_at, updated_at) VALUES ('profil-b', 'profil-b', 'id', '{}', ?, ?)").run(at, at);
    addMemory(db, { text: "preferensi profil default", scope: "global" });
    addMemory(db, { text: "preferensi profil b", scope: "global", profileId: "profil-b" });
    expect(listMemories(db, { scope: "global", profileId: "profil-b" }).map((entry) => entry.text)).toEqual(["preferensi profil b"]);
    expect(listMemories(db, { scope: "global", profileId: defaultProfile }).map((entry) => entry.text)).toEqual(["preferensi profil default"]);
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
    recordUsage(db, { provider: "mock", model: "mock-1", sessionId: session.id, turnId: turn.id, inputTokens: 4, outputTokens: 6, costUsd: 0.25 });
    expect(sumTokensSince(db, old + 60_000)).toBe(20);
    expect(sumTokensSince(db, 0)).toBe(170);
    const cost = sumCostSince(db, 0);
    expect(cost.knownUsd).toBeCloseTo(0.25, 6);
    expect(cost.unknownCount).toBe(2);
  });

  it("memulihkan turn yang terputus setelah proses mati", () => {
    const { db, dir } = freshDb();
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
    const running = createTurn(db, { sessionId: session.id });
    markTurnRunning(db, running.id);
    addMessage(db, { sessionId: session.id, turnId: running.id, role: "user", content: "kerjakan" });
    const queued = createTurn(db, { sessionId: session.id });
    const done = createTurn(db, { sessionId: session.id });
    finishTurn(db, { id: done.id, status: "done" });

    const recovered = recoverInterruptedTurns(db);
    expect(recovered.map((turn) => turn.id).sort()).toEqual([running.id, queued.id].sort());
    expect(getTurn(db, running.id)?.status).toBe("failed");
    expect(getTurn(db, running.id)?.error_code).toBe("E_RECOVERY_FAILED");
    expect(getTurn(db, queued.id)?.status).toBe("failed");
    expect(getTurn(db, done.id)?.status).toBe("done");

    const messages = listMessages(db, session.id, 10);
    const recovery = messages.filter((message) => message.content.startsWith("[pemulihan]"));
    expect(recovery).toHaveLength(2);
    expect(recoverInterruptedTurns(db)).toHaveLength(0);
  });
});

describe("integritas database", () => {
  it("PRAGMA integrity_check dan foreign_key_check lulus tanpa baris yatim", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-integrity-"));
    const { db } = openDatabase({ path: join(dir, "rann.db") });
    const integrity = db.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
    expect(integrity[0]?.integrity_check).toBe("ok");
    const orphans = db.prepare("PRAGMA foreign_key_check").all();
    expect(orphans).toEqual([]);
    db.close();
  });
});

