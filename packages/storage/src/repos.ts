import { createHash } from "node:crypto";
import { basename } from "node:path";
import { newId, type ErrorCode, type EventEnvelope, type EventType, type PermissionMode } from "@rann/shared";
import type { Db } from "./db.js";

export interface SessionRow {
  id: string;
  profile_id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  status: "active" | "closed" | "error";
  model: string;
  permission_mode: PermissionMode;
  metadata_json: string;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

export interface TurnRow {
  id: string;
  session_id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  idempotency_key: string | null;
  usage_json: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: number | null;
  ended_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  content_json: string | null;
  token_count: number | null;
  created_at: number;
}

export interface ToolCallRow {
  id: string;
  session_id: string;
  turn_id: string;
  tool_name: string;
  args_json: string;
  result_json: string | null;
  status: "running" | "ok" | "error" | "denied";
  exit_code: number | null;
  duration_ms: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectRow {
  id: string;
  path: string;
  name: string;
  git_remote: string | null;
  default_branch: string | null;
  created_at: number;
  updated_at: number;
}

const now = (): number => Date.now();

export function ensureDefaultProfile(db: Db): string {
  const existing = db.prepare("SELECT id FROM profiles WHERE name = 'default'").get() as { id: string } | undefined;
  if (existing) return existing.id;
  const id = newId("prof");
  const at = now();
  db.prepare("INSERT INTO profiles (id, name, locale, settings_json, created_at, updated_at) VALUES (?, 'default', 'id', '{}', ?, ?)").run(id, at, at);
  return id;
}

export function upsertProject(db: Db, path: string): ProjectRow {
  const existing = db.prepare("SELECT * FROM projects WHERE path = ?").get(path) as ProjectRow | undefined;
  if (existing) return existing;
  const id = newId("prj");
  const at = now();
  db.prepare("INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, path, basename(path) || path, at, at);
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
}

export interface CreateSessionInput {
  projectPath?: string;
  title?: string;
  model: string;
  permissionMode: PermissionMode;
}

export function createSession(db: Db, input: CreateSessionInput): SessionRow {
  const profileId = ensureDefaultProfile(db);
  const project = input.projectPath ? upsertProject(db, input.projectPath) : undefined;
  const id = newId("ses");
  const at = now();
  db.prepare(
    `INSERT INTO sessions (id, profile_id, project_id, title, status, model, permission_mode, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, '{}', ?, ?)`
  ).run(id, profileId, project?.id ?? null, input.title ?? "Sesi baru", input.model, input.permissionMode, at, at);
  return getSession(db, id)!;
}

export function getSession(db: Db, id: string): SessionRow | undefined {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
}

export function listSessions(db: Db, options: { status?: string; projectPath?: string; limit: number }): SessionRow[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.status) {
    clauses.push("s.status = ?");
    values.push(options.status);
  }
  if (options.projectPath) {
    clauses.push("p.path = ?");
    values.push(options.projectPath);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(options.limit);
  return db
    .prepare(
      `SELECT s.* FROM sessions s LEFT JOIN projects p ON p.id = s.project_id ${where} ORDER BY s.updated_at DESC LIMIT ?`
    )
    .all(...values) as SessionRow[];
}

export function touchSession(db: Db, id: string, patch: Partial<Pick<SessionRow, "title" | "model" | "status">> = {}): void {
  const sets: string[] = ["updated_at = ?"];
  const values: unknown[] = [now()];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    values.push(patch.title);
  }
  if (patch.model !== undefined) {
    sets.push("model = ?");
    values.push(patch.model);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    values.push(patch.status);
    if (patch.status === "closed") {
      sets.push("closed_at = ?");
      values.push(now());
    }
  }
  values.push(id);
  db.prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export interface CreateTurnInput {
  sessionId: string;
  idempotencyKey?: string;
}

export function createTurn(db: Db, input: CreateTurnInput): TurnRow {
  if (input.idempotencyKey) {
    const existing = db
      .prepare("SELECT * FROM turns WHERE session_id = ? AND idempotency_key = ?")
      .get(input.sessionId, input.idempotencyKey) as TurnRow | undefined;
    if (existing) return existing;
  }
  const id = newId("turn");
  const at = now();
  db.prepare(
    "INSERT INTO turns (id, session_id, status, idempotency_key, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)"
  ).run(id, input.sessionId, input.idempotencyKey ?? null, at, at);
  return getTurn(db, id)!;
}

export function getTurn(db: Db, id: string): TurnRow | undefined {
  return db.prepare("SELECT * FROM turns WHERE id = ?").get(id) as TurnRow | undefined;
}

export function markTurnRunning(db: Db, id: string): void {
  const at = now();
  db.prepare("UPDATE turns SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?").run(at, at, id);
}

export interface FinishTurnInput {
  id: string;
  status: "done" | "failed" | "cancelled";
  usage?: Record<string, unknown>;
  error?: { code: ErrorCode; message: string };
}

export function finishTurn(db: Db, input: FinishTurnInput): void {
  const at = now();
  db.prepare(
    `UPDATE turns SET status = ?, ended_at = ?, updated_at = ?, usage_json = ?, error_code = ?, error_message = ? WHERE id = ?`
  ).run(
    input.status,
    at,
    at,
    input.usage ? JSON.stringify(input.usage) : null,
    input.error?.code ?? null,
    input.error?.message ?? null,
    input.id
  );
}

export interface AddMessageInput {
  sessionId: string;
  turnId?: string;
  role: MessageRow["role"];
  content: string;
  contentJson?: unknown;
  tokenCount?: number;
}

export function addMessage(db: Db, input: AddMessageInput): MessageRow {
  const id = newId("msg");
  const at = now();
  db.prepare(
    "INSERT INTO messages (id, session_id, turn_id, role, content, content_json, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.sessionId,
    input.turnId ?? null,
    input.role,
    input.content,
    input.contentJson === undefined ? null : JSON.stringify(input.contentJson),
    input.tokenCount ?? null,
    at
  );
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow;
}

export function listMessages(db: Db, sessionId: string, limit = 500): MessageRow[] {
  return db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?").all(sessionId, limit) as MessageRow[];
}

export function searchMessages(db: Db, query: string, limit = 20): MessageRow[] {
  return db
    .prepare(
      `SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?`
    )
    .all(query, limit) as MessageRow[];
}

export interface AddToolCallInput {
  sessionId: string;
  turnId: string;
  toolName: string;
  args: unknown;
}

export function addToolCall(db: Db, input: AddToolCallInput): ToolCallRow {
  const id = newId("tool");
  const at = now();
  db.prepare(
    "INSERT INTO tool_calls (id, session_id, turn_id, tool_name, args_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)"
  ).run(id, input.sessionId, input.turnId, input.toolName, JSON.stringify(input.args ?? {}), at, at);
  return db.prepare("SELECT * FROM tool_calls WHERE id = ?").get(id) as ToolCallRow;
}

export function completeToolCall(
  db: Db,
  id: string,
  result: { status: "ok" | "error" | "denied"; result: unknown; exitCode?: number; durationMs?: number }
): void {
  db.prepare("UPDATE tool_calls SET status = ?, result_json = ?, exit_code = ?, duration_ms = ?, updated_at = ? WHERE id = ?").run(
    result.status,
    JSON.stringify(result.result ?? null),
    result.exitCode ?? null,
    result.durationMs ?? null,
    now(),
    id
  );
}

export interface UsageInput {
  provider: string;
  model: string;
  sessionId?: string;
  turnId?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export function recordUsage(db: Db, input: UsageInput): void {
  db.prepare(
    "INSERT INTO usage_events (id, provider, model, session_id, turn_id, input_tokens, output_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    newId("evt"),
    input.provider,
    input.model,
    input.sessionId ?? null,
    input.turnId ?? null,
    input.inputTokens,
    input.outputTokens,
    input.costUsd ?? 0,
    now()
  );
}

export interface UsageSummaryRow {
  provider: string;
  model: string;
  turns: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  last_at: string;
}

export function summarizeUsage(db: Db, sessionId?: string): UsageSummaryRow[] {
  const where = sessionId ? "WHERE session_id = ?" : "";
  const statement = db.prepare(
    `SELECT provider, model, COUNT(*) AS turns, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
            SUM(cost_usd) AS cost_usd, MAX(created_at) AS last_at
     FROM usage_events ${where}
     GROUP BY provider, model
     ORDER BY output_tokens DESC`
  );
  return (sessionId ? statement.all(sessionId) : statement.all()) as UsageSummaryRow[];
}

export interface AppendEventInput {
  type: EventType;
  sessionId: string;
  turnId?: string;
  data: Record<string, unknown>;
}

export function appendEvent(db: Db, input: AppendEventInput): EventEnvelope {
  const at = now();
  const info = db
    .prepare("INSERT INTO events (id, type, session_id, turn_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(newId("evt"), input.type, input.sessionId, input.turnId ?? null, JSON.stringify(input.data), at);
  const seq = Number(info.lastInsertRowid);
  const event: EventEnvelope = { seq, type: input.type, sessionId: input.sessionId, at, data: input.data };
  if (input.turnId) event.turnId = input.turnId;
  return event;
}

function rowToEvent(row: { seq: number; type: string; session_id: string; turn_id: string | null; payload_json: string; created_at: number }): EventEnvelope {
  const event: EventEnvelope = {
    seq: row.seq,
    type: row.type as EventType,
    sessionId: row.session_id,
    at: row.created_at,
    data: JSON.parse(row.payload_json) as Record<string, unknown>
  };
  if (row.turn_id) event.turnId = row.turn_id;
  return event;
}

export function eventsForTurn(db: Db, turnId: string, afterSeq = 0): EventEnvelope[] {
  const rows = db.prepare("SELECT * FROM events WHERE turn_id = ? AND seq > ? ORDER BY seq ASC").all(turnId, afterSeq) as Array<{
    seq: number;
    type: string;
    session_id: string;
    turn_id: string | null;
    payload_json: string;
    created_at: number;
  }>;
  return rows.map(rowToEvent);
}

export function eventsForSession(db: Db, sessionId: string, afterSeq = 0, limit = 1000): EventEnvelope[] {
  const rows = db.prepare("SELECT * FROM events WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?").all(sessionId, afterSeq, limit) as Array<{
    seq: number;
    type: string;
    session_id: string;
    turn_id: string | null;
    payload_json: string;
    created_at: number;
  }>;
  return rows.map(rowToEvent);
}

export interface AuditInput {
  actor: string;
  action: string;
  resource: string;
  decision: string;
  metadata?: Record<string, unknown>;
}

export function appendAudit(db: Db, input: AuditInput): void {
  const prev = db.prepare("SELECT hash FROM audit_log ORDER BY rowid DESC LIMIT 1").get() as { hash: string } | undefined;
  const prevHash = prev?.hash ?? null;
  const metadata = JSON.stringify(input.metadata ?? {});
  const at = now();
  const payload = JSON.stringify({ actor: input.actor, action: input.action, resource: input.resource, decision: input.decision, metadata, at, prevHash });
  const hash = createHash("sha256").update(payload).digest("hex");
  db.prepare(
    "INSERT INTO audit_log (id, actor, action, resource, decision, metadata_json, prev_hash, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(newId("evt"), input.actor, input.action, input.resource, input.decision, metadata, prevHash, hash, at);
}

export function verifyAuditChain(db: Db): { ok: boolean; brokenAt?: string } {
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY rowid ASC").all() as Array<{
    id: string;
    actor: string;
    action: string;
    resource: string;
    decision: string;
    metadata_json: string;
    prev_hash: string | null;
    hash: string;
    created_at: number;
  }>;
  let prevHash: string | null = null;
  for (const row of rows) {
    const payload = JSON.stringify({
      actor: row.actor,
      action: row.action,
      resource: row.resource,
      decision: row.decision,
      metadata: row.metadata_json,
      at: row.created_at,
      prevHash: row.prev_hash
    });
    const expected = createHash("sha256").update(payload).digest("hex");
    if (row.prev_hash !== prevHash || row.hash !== expected) return { ok: false, brokenAt: row.id };
    prevHash = row.hash;
  }
  return { ok: true };
}

export function countRows(db: Db, table: string): number {
  const allowed = new Set([
    "profiles",
    "projects",
    "sessions",
    "turns",
    "messages",
    "tool_calls",
    "events",
    "usage_events",
    "audit_log"
  ]);
  if (!allowed.has(table)) throw new Error(`Tabel tidak diizinkan: ${table}`);
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}
