import { newId } from "@rann/shared";
import type { Db } from "./db.js";
import { ensureDefaultProfile } from "./repos.js";

export interface ProcedureRow {
  id: string;
  profile_id: string;
  project_path: string | null;
  agent: string | null;
  name: string;
  trigger: string;
  prerequisites: string[];
  steps: string;
  verification: string;
  status: "candidate" | "active" | "stale" | "rejected";
  successes: number;
  failures: number;
  approved_by: string | null;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

type DbRow = Omit<ProcedureRow, "prerequisites"> & { prerequisites: string };

function toRow(row: DbRow): ProcedureRow {
  return { ...row, prerequisites: JSON.parse(row.prerequisites) as string[] };
}

export function upsertProcedure(db: Db, input: {
  profileId?: string;
  projectPath?: string;
  agent?: string;
  name: string;
  trigger: string;
  prerequisites?: string[];
  steps: string;
  verification: string;
  approvedBy?: string;
}): ProcedureRow {
  const profileId = input.profileId ?? ensureDefaultProfile(db);
  const projectPath = input.projectPath ?? "";
  const at = Date.now();
  const existing = db.prepare("SELECT * FROM procedures WHERE profile_id = ? AND COALESCE(project_path, '') = ? AND name = ?").get(profileId, projectPath, input.name) as DbRow | undefined;
  if (existing) {
    db.prepare("UPDATE procedures SET trigger = ?, prerequisites = ?, steps = ?, verification = ?, updated_at = ? WHERE id = ?").run(
      input.trigger, JSON.stringify(input.prerequisites ?? []), input.steps, input.verification, at, existing.id
    );
    return toRow(db.prepare("SELECT * FROM procedures WHERE id = ?").get(existing.id) as DbRow);
  }
  const id = newId("prc");
  db.prepare(`INSERT INTO procedures (id, profile_id, project_path, agent, name, trigger, prerequisites, steps, verification, status, approved_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, profileId, projectPath, input.agent ?? null, input.name, input.trigger, JSON.stringify(input.prerequisites ?? []),
    input.steps, input.verification, input.approvedBy ? "active" : "candidate", input.approvedBy ?? null, at, at
  );
  return toRow(db.prepare("SELECT * FROM procedures WHERE id = ?").get(id) as DbRow);
}

export function recordProcedureResult(db: Db, id: string, ok: boolean): ProcedureRow | undefined {
  const at = Date.now();
  db.prepare("UPDATE procedures SET successes = successes + ?, failures = failures + ?, last_used_at = ?, updated_at = ? WHERE id = ?").run(
    ok ? 1 : 0, ok ? 0 : 1, at, at, id
  );
  const row = db.prepare("SELECT * FROM procedures WHERE id = ?").get(id) as DbRow | undefined;
  if (!row) return undefined;
  if (!ok && row.failures >= 3) {
    db.prepare("UPDATE procedures SET status = 'stale', updated_at = ? WHERE id = ?").run(at, id);
  } else if (ok && row.status === "candidate" && row.successes >= 3 && row.failures === 0) {
    db.prepare("UPDATE procedures SET status = 'active', updated_at = ? WHERE id = ?").run(at, id);
  }
  return toRow(db.prepare("SELECT * FROM procedures WHERE id = ?").get(id) as DbRow);
}

export function listProcedures(db: Db, options: { projectPath?: string; status?: string; limit?: number } = {}): ProcedureRow[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.projectPath !== undefined) {
    clauses.push("(project_path = ? OR project_path IS NULL)");
    values.push(options.projectPath);
  }
  if (options.status) {
    clauses.push("status = ?");
    values.push(options.status);
  }
  values.push(options.limit ?? 50);
  return (db.prepare(`SELECT * FROM procedures ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`).all(...values) as DbRow[]).map(toRow);
}

export function recordMemoryEvent(db: Db, memoryId: string, event: "created" | "updated" | "deleted" | "retrieved" | "expired" | "merged" | "restored", detail?: string): void {
  db.prepare("INSERT INTO memory_events (id, memory_id, action, actor, after_json, created_at) VALUES (?, ?, ?, 'agent', ?, ?)").run(
    newId("mev"), memoryId, event, detail ?? null, Date.now()
  );
}
