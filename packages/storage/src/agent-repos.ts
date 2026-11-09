import { newId } from "@rann/shared";
import type { Db } from "./db.js";
import { ensureDefaultProfile } from "./repos.js";

export type SubagentStatus = "starting" | "idle" | "running" | "blocked" | "waiting" | "done" | "failed" | "cancelled" | "orphaned";

export interface SubagentRow {
  id: string;
  profile_id: string;
  name: string;
  role: string;
  parent_id: string | null;
  status: SubagentStatus;
  model: string | null;
  permission_mode: "read-only" | "ask" | "accept-edits" | "trusted" | "custom";
  metadata_json: string;
  session_id: string | null;
  turn_id: string | null;
  parent_turn_id: string | null;
  profile: string | null;
  goal: string | null;
  depth: number;
  path: string | null;
  steps: number;
  cost_usd: number;
  heartbeat_at: number | null;
  result_json: string | null;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}

export interface SubagentView extends Omit<SubagentRow, "result_json"> {
  result?: unknown;
  children: SubagentView[];
}

export function createSubagent(
  db: Db,
  input: {
    parentId?: string;
    sessionId: string;
    turnId?: string;
    parentTurnId?: string;
    profile: string;
    goal: string;
    depth: number;
    path: string;
    model?: string;
    permissionMode?: SubagentRow["permission_mode"];
    metadata?: Record<string, unknown>;
  }
): SubagentRow {
  const id = newId("ag");
  const at = Date.now();
  db.prepare(
    `INSERT INTO agents (id, profile_id, name, role, parent_id, status, model, permission_mode, metadata_json,
       session_id, turn_id, parent_turn_id, profile, goal, depth, path, steps, cost_usd, heartbeat_at, created_at, updated_at)
     VALUES (?, ?, ?, 'subagent', ?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
  ).run(
    id,
    ensureDefaultProfile(db),
    input.profile,
    input.parentId ?? null,
    input.model ?? null,
    input.permissionMode ?? "read-only",
    JSON.stringify(input.metadata ?? {}),
    input.sessionId,
    input.turnId ?? null,
    input.parentTurnId ?? null,
    input.profile,
    input.goal,
    input.depth,
    input.path,
    at,
    at,
    at
  );
  return getSubagent(db, id)!;
}

export function getSubagent(db: Db, id: string): SubagentRow | undefined {
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as SubagentRow | undefined;
}

export function getSubagentByTurn(db: Db, turnId: string): SubagentRow | undefined {
  return db
    .prepare("SELECT * FROM agents WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(turnId) as SubagentRow | undefined;
}

export function updateSubagent(
  db: Db,
  id: string,
  patch: Partial<Pick<SubagentRow, "status" | "steps" | "cost_usd" | "model" | "turn_id">>
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  values.push(Date.now(), id);
  db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function heartbeatSubagent(db: Db, id: string, patch: { steps?: number; costUsd?: number } = {}): void {
  const at = Date.now();
  db.prepare(
    "UPDATE agents SET heartbeat_at = ?, updated_at = ?, steps = COALESCE(?, steps), cost_usd = COALESCE(?, cost_usd) WHERE id = ?"
  ).run(at, at, patch.steps ?? null, patch.costUsd ?? null, id);
}

export function finishSubagent(
  db: Db,
  id: string,
  status: Extract<SubagentStatus, "done" | "failed" | "cancelled">,
  result?: unknown
): void {
  const at = Date.now();
  db.prepare("UPDATE agents SET status = ?, result_json = ?, updated_at = ?, finished_at = ? WHERE id = ?").run(
    status,
    result === undefined ? null : JSON.stringify(result),
    at,
    at,
    id
  );
}

export function listSubagents(
  db: Db,
  options: { parentId?: string; status?: SubagentStatus; limit?: number } = {}
): SubagentRow[] {
  const clauses: string[] = ["session_id IS NOT NULL"];
  const values: unknown[] = [];
  if (options.parentId !== undefined) {
    clauses.push("parent_id = ?");
    values.push(options.parentId);
  }
  if (options.status !== undefined) {
    clauses.push("status = ?");
    values.push(options.status);
  }
  values.push(Math.min(options.limit ?? 100, 500));
  return db
    .prepare(`SELECT * FROM agents WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .all(...values) as SubagentRow[];
}

export function subagentForest(db: Db, limit = 200): SubagentView[] {
  const rows = db
    .prepare("SELECT * FROM agents WHERE session_id IS NOT NULL ORDER BY created_at ASC LIMIT ?")
    .all(limit) as SubagentRow[];
  const byId = new Map<string, SubagentView>();
  for (const row of rows) {
    const { result_json, ...rest } = row;
    byId.set(row.id, {
      ...rest,
      ...(result_json ? { result: safeParse(result_json) } : {}),
      children: []
    });
  }
  const roots: SubagentView[] = [];
  for (const view of byId.values()) {
    const parent = view.parent_id ? byId.get(view.parent_id) : undefined;
    if (parent) parent.children.push(view);
    else roots.push(view);
  }
  return roots;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function countSubagentChildren(db: Db, parentId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM agents WHERE parent_id = ? AND status IN ('starting','idle','running','waiting')")
    .get(parentId) as { n: number };
  return row.n;
}

export function countSubagentsForTurn(db: Db, turnId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM agents WHERE parent_turn_id = ? AND status IN ('starting','idle','running','waiting','done')"
    )
    .get(turnId) as { n: number };
  return row.n;
}

export function cancelSubagentTree(db: Db, rootId: string): string[] {
  const ids: string[] = [rootId];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const placeholders = frontier.map(() => "?").join(",");
    const children = db
      .prepare(`SELECT id FROM agents WHERE parent_id IN (${placeholders})`)
      .all(...frontier) as Array<{ id: string }>;
    frontier = children.map((row) => row.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  const at = Date.now();
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `UPDATE agents SET status = 'cancelled', updated_at = ?, finished_at = ?
     WHERE id IN (${placeholders}) AND status IN ('starting','idle','running','waiting')`
  ).run(at, at, ...ids);
  return ids;
}

export function markOrphanedSubagents(db: Db, staleMs = 60_000): string[] {
  const cutoff = Date.now() - staleMs;
  const rows = db
    .prepare(
      "SELECT id FROM agents WHERE session_id IS NOT NULL AND status IN ('starting','idle','running','waiting') AND COALESCE(heartbeat_at, updated_at) < ?"
    )
    .all(cutoff) as Array<{ id: string }>;
  const at = Date.now();
  for (const row of rows) {
    db.prepare("UPDATE agents SET status = 'orphaned', result_json = ?, updated_at = ?, finished_at = ? WHERE id = ?").run(
      JSON.stringify({ error: "orphaned", message: "Heartbeat subagent berhenti" }),
      at,
      at,
      row.id
    );
  }
  return rows.map((row) => row.id);
}

export function recordSubagentMessage(
  db: Db,
  input: { from: string; to: string; type: string; subject: string; body: string; refs?: string[]; priority?: "low" | "normal" | "high" }
): string {
  const id = newId("amsg");
  db.prepare(
    `INSERT INTO subagent_messages (id, from_agent, to_agent, type, subject, body, refs_json, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.from,
    input.to,
    input.type,
    input.subject,
    input.body,
    JSON.stringify(input.refs ?? []),
    input.priority ?? "normal",
    Date.now()
  );
  return id;
}

export function listSubagentMessages(db: Db, agentId: string, limit = 50): Array<Record<string, unknown>> {
  const rows = db
    .prepare("SELECT * FROM subagent_messages WHERE to_agent = ? OR from_agent = ? ORDER BY created_at DESC LIMIT ?")
    .all(agentId, agentId, Math.min(limit, 200)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ ...row, refs: safeParse(String(row.refs_json ?? "[]")) }));
}

export function releaseAgentLeases(db: Db, ownerAgentId: string): void {
  db.prepare("DELETE FROM path_leases WHERE owner_agent_id = ?").run(ownerAgentId);
}
