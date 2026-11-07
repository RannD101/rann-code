import { newId, RannError } from "@rann/shared";
import type { Db } from "./db.js";

export interface GoalCriterion {
  id: string;
  text: string;
  done: boolean;
  evidence?: string;
  completed_at?: number;
}

export interface GoalProgress {
  step: number;
  last_action?: string;
  last_tool?: string;
  note?: string;
  updated_at: number;
}

export interface GoalView {
  id: string;
  session_id: string;
  goal: string;
  criteria: GoalCriterion[];
  assumptions: string[];
  progress: GoalProgress;
  status: "active" | "done" | "failed" | "cancelled" | "superseded";
  version: number;
  created_by: "user" | "replan" | "agent";
  created_at: number;
  updated_at: number;
}

interface GoalRow {
  id: string;
  session_id: string;
  goal: string;
  criteria_json: string;
  assumptions_json: string;
  progress_json: string;
  status: GoalView["status"];
  version: number;
  created_by: GoalView["created_by"];
  created_at: number;
  updated_at: number;
}

export interface GoalInput {
  sessionId: string;
  goal: string;
  criteria?: Array<string | { id?: string; text: string }>;
  assumptions?: string[];
  createdBy: "user" | "replan" | "agent";
}

function normalizeCriteria(input: GoalInput["criteria"]): GoalCriterion[] {
  return (input ?? []).map((item, index) => {
    const text = typeof item === "string" ? item : item.text;
    const id = typeof item === "string" ? `c${index + 1}` : item.id ?? `c${index + 1}`;
    return { id, text, done: false };
  });
}

function parseRow(row: GoalRow): GoalView {
  const criteria = JSON.parse(row.criteria_json) as GoalCriterion[];
  const assumptions = JSON.parse(row.assumptions_json) as string[];
  const progress = JSON.parse(row.progress_json) as Partial<GoalProgress>;
  return {
    ...row,
    criteria,
    assumptions,
    progress: { step: progress.step ?? 0, updated_at: progress.updated_at ?? row.updated_at, ...progress }
  };
}

export function getActiveGoal(db: Db, sessionId: string): GoalView | undefined {
  const row = db
    .prepare("SELECT * FROM goals WHERE session_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1")
    .get(sessionId) as GoalRow | undefined;
  return row ? parseRow(row) : undefined;
}

export function listGoals(db: Db, sessionId: string, limit = 20): GoalView[] {
  const rows = db
    .prepare("SELECT * FROM goals WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(sessionId, limit) as GoalRow[];
  return rows.map(parseRow);
}

export function setGoal(db: Db, input: GoalInput): GoalView {
  if (input.goal.trim().length === 0) throw new Error("Goal tidak boleh kosong");
  if (input.createdBy === "agent") throw new Error("Agent tidak boleh mengubah goal");
  const at = Date.now();
  const apply = db.transaction((): GoalView => {
    const previous = getActiveGoal(db, input.sessionId);
    const version = previous ? previous.version + 1 : 1;
    if (previous) {
      db.prepare("UPDATE goals SET status = 'superseded', updated_at = ? WHERE id = ?").run(at, previous.id);
    }
    const id = newId("goal");
    const criteria = normalizeCriteria(input.criteria);
    const progress: GoalProgress = { step: 0, updated_at: at };
    db.prepare(
      `INSERT INTO goals (id, session_id, goal, criteria_json, assumptions_json, progress_json, status, version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
    ).run(
      id,
      input.sessionId,
      input.goal.trim(),
      JSON.stringify(criteria),
      JSON.stringify(input.assumptions ?? []),
      JSON.stringify(progress),
      version,
      input.createdBy,
      at,
      at
    );
    return getActiveGoal(db, input.sessionId)!;
  });
  return apply();
}

export interface GoalProgressPatch {
  action?: string;
  tool?: string;
  note?: string;
  incrementStep?: boolean;
  complete?: Array<{ id: string; evidence: string }>;
}

export function updateGoalProgress(db: Db, sessionId: string, patch: GoalProgressPatch): GoalView | undefined {
  const goal = getActiveGoal(db, sessionId);
  if (!goal) return undefined;
  const at = Date.now();
  const criteria = goal.criteria.map((criterion) => ({ ...criterion }));
  for (const completion of patch.complete ?? []) {
    if (completion.evidence.trim().length === 0) throw new Error("Kriteria selesai butuh bukti");
    const target = criteria.find((criterion) => criterion.id === completion.id);
    if (!target) throw new Error(`Kriteria tidak ditemukan: ${completion.id}`);
    target.done = true;
    target.evidence = completion.evidence;
    target.completed_at = at;
  }
  const progress: GoalProgress = {
    step: goal.progress.step + (patch.incrementStep === false ? 0 : 1),
    updated_at: at,
    ...(patch.action ? { last_action: patch.action } : {}),
    ...(patch.tool ? { last_tool: patch.tool } : {}),
    ...(patch.note ? { note: patch.note } : {})
  };
  db.prepare("UPDATE goals SET criteria_json = ?, progress_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(criteria),
    JSON.stringify(progress),
    at,
    goal.id
  );
  return getActiveGoal(db, sessionId);
}

export function finishGoal(
  db: Db,
  sessionId: string,
  status: "done" | "failed" | "cancelled",
  note?: string
): GoalView | undefined {
  const goal = getActiveGoal(db, sessionId);
  if (!goal) return undefined;
  if (status === "done") {
    const pending = goal.criteria.filter((criterion) => !criterion.done);
    if (pending.length > 0) {
      throw new RannError(
        "E_GOAL_INCOMPLETE",
        `Goal belum selesai, kriteria belum terpenuhi: ${pending.map((criterion) => criterion.id).join(", ")}`
      );
    }
  }
  const at = Date.now();
  const progress: GoalProgress = {
    ...goal.progress,
    updated_at: at,
    ...(note ? { note } : {})
  };
  db.prepare("UPDATE goals SET status = ?, progress_json = ?, updated_at = ? WHERE id = ?").run(
    status,
    JSON.stringify(progress),
    at,
    goal.id
  );
  const row = db.prepare("SELECT * FROM goals WHERE id = ?").get(goal.id) as GoalRow | undefined;
  return row ? parseRow(row) : undefined;
}

export function renderGoal(goal: GoalView): string {
  const lines = [`goal: ${goal.goal}`, `status: ${goal.status}  langkah: ${goal.progress.step}`];
  if (goal.assumptions.length > 0) lines.push(`asumsi: ${goal.assumptions.join("; ")}`);
  for (const criterion of goal.criteria) {
    lines.push(`  [${criterion.done ? "x" : " "}] ${criterion.id} ${criterion.text}${criterion.evidence ? ` (bukti: ${criterion.evidence})` : ""}`);
  }
  return lines.join("\n");
}
