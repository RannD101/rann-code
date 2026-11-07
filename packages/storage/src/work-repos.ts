import { newId } from "@rann/shared";
import type { Db } from "./db.js";
import { ensureDefaultProfile } from "./repos.js";

export type TaskStatus = "queued" | "running" | "blocked" | "done" | "failed" | "cancelled" | "paused";
export type PlanStatus = "draft" | "active" | "blocked" | "done" | "failed" | "cancelled";
export type CheckpointKind = "turn" | "manual" | "pre_tool" | "post_tool" | "pre_restore";

export interface PlanRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  goal: string;
  status: PlanStatus;
  version: number;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

export interface TaskRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  plan_id: string | null;
  assignee_agent_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  metadata_json: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export interface TaskStepRow {
  id: string;
  task_id: string;
  idx: number;
  title: string;
  description: string;
  status: "queued" | "running" | "done" | "failed" | "skipped" | "cancelled";
  input_json: string | null;
  output_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export interface PlanNodeRow {
  id: string;
  plan_id: string;
  parent_id: string | null;
  task_id: string | null;
  kind: string;
  title: string;
  status: "pending" | "ready" | "running" | "done" | "failed" | "skipped" | "blocked";
  depends_on_json: string;
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

export interface CheckpointRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  label: string;
  kind: CheckpointKind;
  state_json: string;
  git_ref: string | null;
  files_json: string;
  created_at: number;
}

export interface ApprovalRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  tool_call_id: string | null;
  tool_name: string;
  args_hash: string;
  decision: "allow" | "deny" | "always";
  scope: "once" | "session" | "always";
  reason: string | null;
  decided_by: string | null;
  created_at: number;
  expires_at: number | null;
}

export interface ArtifactRow {
  id: string;
  session_id: string | null;
  turn_id: string | null;
  tool_call_id: string | null;
  name: string;
  mime: string | null;
  size: number | null;
  path: string;
  hash: string | null;
  created_at: number;
}

export interface PathLeaseRow {
  id: string;
  path: string;
  owner_agent_id: string | null;
  session_id: string | null;
  acquired_at: number;
  expires_at: number;
  heartbeat_at: number;
}

export type TransactionStatus = "open" | "committed" | "rolled_back" | "failed";
export type FileChangeStatus = "pending" | "applied" | "reverted" | "failed";

export interface TransactionRow {
  id: string;
  session_id: string;
  turn_id: string | null;
  status: TransactionStatus;
  summary_json: string;
  created_at: number;
  updated_at: number;
}

export interface FileChangeRow {
  id: string;
  transaction_id: string | null;
  session_id: string;
  turn_id: string | null;
  path: string;
  before_hash: string | null;
  after_hash: string | null;
  before_text: string | null;
  after_text: string | null;
  diff_text: string | null;
  status: FileChangeStatus;
  created_at: number;
}

export interface AgentRow {
  id: string;
  profile_id: string;
  name: string;
  role: string;
  parent_id: string | null;
  status: "idle" | "running" | "blocked" | "waiting" | "done" | "failed" | "cancelled";
  model: string | null;
  permission_mode: "read-only" | "ask" | "accept-edits" | "trusted" | "custom";
  metadata_json: string;
  created_at: number;
  updated_at: number;
}

const now = (): number => Date.now();

export function createAgent(
  db: Db,
  input: { name: string; profileId?: string; role?: string; parentId?: string; model?: string; permissionMode?: AgentRow["permission_mode"] }
): AgentRow {
  const id = newId("ag");
  const at = now();
  db.prepare(
    "INSERT INTO agents (id, profile_id, name, role, parent_id, status, model, permission_mode, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'idle', ?, ?, '{}', ?, ?)"
  ).run(
    id,
    input.profileId ?? ensureDefaultProfile(db),
    input.name,
    input.role ?? "worker",
    input.parentId ?? null,
    input.model ?? null,
    input.permissionMode ?? "read-only",
    at,
    at
  );
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
}

export function createPlan(
  db: Db,
  input: { sessionId: string; turnId?: string; goal: string; metadata?: Record<string, unknown> }
): PlanRow {
  const id = newId("plan");
  const at = now();
  db.prepare(
    "INSERT INTO plans (id, session_id, turn_id, goal, status, version, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?)"
  ).run(id, input.sessionId, input.turnId ?? null, input.goal, JSON.stringify(input.metadata ?? {}), at, at);
  return getPlan(db, id) as PlanRow;
}

export function getPlan(db: Db, id: string): PlanRow | undefined {
  return db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
}

export function listPlans(db: Db, sessionId: string, limit = 20): PlanRow[] {
  return db
    .prepare("SELECT * FROM plans WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(sessionId, limit) as PlanRow[];
}

export function updatePlanStatus(db: Db, id: string, status: PlanStatus): PlanRow | undefined {
  db.prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  return getPlan(db, id);
}

export function updatePlan(
  db: Db,
  id: string,
  input: { goal?: string; version?: number; metadata?: Record<string, unknown> }
): PlanRow | undefined {
  const current = getPlan(db, id);
  if (!current) return undefined;
  db.prepare("UPDATE plans SET goal = ?, version = ?, metadata_json = ?, updated_at = ? WHERE id = ?").run(
    input.goal ?? current.goal,
    input.version ?? current.version,
    JSON.stringify(input.metadata ?? JSON.parse(current.metadata_json) as Record<string, unknown>),
    now(),
    id
  );
  return getPlan(db, id);
}

export function cancelOpenTasks(db: Db, planId: string, keepStatuses: string[] = ["done"]): number {
  const placeholders = keepStatuses.map(() => "?").join(", ");
  const at = now();
  const result = db
    .prepare(
      `UPDATE tasks SET status = 'cancelled', ended_at = ?, updated_at = ? WHERE plan_id = ? AND status NOT IN (${placeholders})`
    )
    .run(at, at, planId, ...keepStatuses);
  db.prepare(
    "UPDATE plan_nodes SET status = 'skipped', updated_at = ? WHERE plan_id = ? AND task_id IN (SELECT id FROM tasks WHERE plan_id = ? AND status = 'cancelled')"
  ).run(at, planId, planId);
  return Number(result.changes);
}

export function addPlanNode(
  db: Db,
  input: {
    planId: string;
    title: string;
    parentId?: string;
    taskId?: string;
    kind?: string;
    dependsOn?: string[];
    metadata?: Record<string, unknown>;
  }
): PlanNodeRow {
  const id = newId("node");
  const at = now();
  db.prepare(
    "INSERT INTO plan_nodes (id, plan_id, parent_id, task_id, kind, title, status, depends_on_json, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)"
  ).run(
    id,
    input.planId,
    input.parentId ?? null,
    input.taskId ?? null,
    input.kind ?? "step",
    input.title,
    JSON.stringify(input.dependsOn ?? []),
    JSON.stringify(input.metadata ?? {}),
    at,
    at
  );
  return db.prepare("SELECT * FROM plan_nodes WHERE id = ?").get(id) as PlanNodeRow;
}

export function listPlanNodes(db: Db, planId: string): PlanNodeRow[] {
  return db.prepare("SELECT * FROM plan_nodes WHERE plan_id = ? ORDER BY created_at, rowid").all(planId) as PlanNodeRow[];
}

export function createTask(
  db: Db,
  input: {
    sessionId: string;
    title: string;
    description?: string;
    planId?: string;
    parentId?: string;
    assigneeAgentId?: string;
    priority?: number;
    metadata?: Record<string, unknown>;
  }
): TaskRow {
  const id = newId("task");
  const at = now();
  db.prepare(
    "INSERT INTO tasks (id, session_id, parent_id, plan_id, assignee_agent_id, title, description, status, priority, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)"
  ).run(
    id,
    input.sessionId,
    input.parentId ?? null,
    input.planId ?? null,
    input.assigneeAgentId ?? null,
    input.title,
    input.description ?? "",
    input.priority ?? 0,
    JSON.stringify(input.metadata ?? {}),
    at,
    at
  );
  return getTask(db, id) as TaskRow;
}

export function getTask(db: Db, id: string): TaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
}

export function listTasks(db: Db, sessionId: string): TaskRow[] {
  return db.prepare("SELECT * FROM tasks WHERE session_id = ? ORDER BY priority DESC, created_at").all(sessionId) as TaskRow[];
}

export function updateTaskStatus(db: Db, id: string, status: TaskStatus): TaskRow | undefined {
  const at = now();
  const startedAt = status === "running" ? at : null;
  const endedAt = status === "done" || status === "failed" || status === "cancelled" ? at : null;
  db.prepare(
    "UPDATE tasks SET status = ?, updated_at = ?, started_at = COALESCE(started_at, ?), ended_at = COALESCE(?, ended_at) WHERE id = ?"
  ).run(status, at, startedAt, endedAt, id);
  return getTask(db, id);
}

export function addTaskStep(
  db: Db,
  input: { taskId: string; title: string; description?: string; input?: Record<string, unknown> }
): TaskStepRow {
  const id = newId("step");
  const at = now();
  const next = db.prepare("SELECT COALESCE(MAX(idx), -1) + 1 AS idx FROM task_steps WHERE task_id = ?").get(input.taskId) as {
    idx: number;
  };
  db.prepare(
    "INSERT INTO task_steps (id, task_id, idx, title, description, status, input_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)"
  ).run(id, input.taskId, next.idx, input.title, input.description ?? "", JSON.stringify(input.input ?? {}), at, at);
  return db.prepare("SELECT * FROM task_steps WHERE id = ?").get(id) as TaskStepRow;
}

export function listTaskSteps(db: Db, taskId: string): TaskStepRow[] {
  return db.prepare("SELECT * FROM task_steps WHERE task_id = ? ORDER BY idx").all(taskId) as TaskStepRow[];
}

export function createCheckpoint(
  db: Db,
  input: {
    sessionId: string;
    label: string;
    turnId?: string;
    kind?: CheckpointKind;
    state: Record<string, unknown>;
    files?: string[];
    gitRef?: string;
  }
): CheckpointRow {
  const id = newId("chk");
  db.prepare(
    "INSERT INTO checkpoints (id, session_id, turn_id, label, kind, state_json, git_ref, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.sessionId,
    input.turnId ?? null,
    input.label,
    input.kind ?? "turn",
    JSON.stringify(input.state),
    input.gitRef ?? null,
    JSON.stringify(input.files ?? []),
    now()
  );
  return db.prepare("SELECT * FROM checkpoints WHERE id = ?").get(id) as CheckpointRow;
}

export function listCheckpoints(db: Db, sessionId: string, limit = 20): CheckpointRow[] {
  return db.prepare("SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT ?").all(sessionId, limit) as CheckpointRow[];
}

export function latestCheckpoint(db: Db, sessionId: string): CheckpointRow | undefined {
  return db
    .prepare("SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(sessionId) as CheckpointRow | undefined;
}

export function recordApproval(
  db: Db,
  input: {
    sessionId: string;
    toolName: string;
    argsHash: string;
    decision: "allow" | "deny" | "always";
    scope?: "once" | "session" | "always";
    turnId?: string;
    toolCallId?: string;
    reason?: string;
    decidedBy?: string;
    expiresAt?: number;
  }
): ApprovalRow {
  const id = newId("apr");
  db.prepare(
    "INSERT INTO approvals (id, session_id, turn_id, tool_call_id, tool_name, args_hash, decision, scope, reason, decided_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.sessionId,
    input.turnId ?? null,
    input.toolCallId ?? null,
    input.toolName,
    input.argsHash,
    input.decision,
    input.scope ?? "once",
    input.reason ?? null,
    input.decidedBy ?? "user",
    now(),
    input.expiresAt ?? null
  );
  return db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRow;
}

export function findApproval(
  db: Db,
  input: { sessionId: string; toolName: string; argsHash: string; at?: number }
): ApprovalRow | undefined {
  const at = input.at ?? now();
  return db
    .prepare(
      `SELECT * FROM approvals
       WHERE session_id = ? AND tool_name = ? AND args_hash = ? AND decision IN ('allow','always')
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY CASE decision WHEN 'always' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`
    )
    .get(input.sessionId, input.toolName, input.argsHash, at) as ApprovalRow | undefined;
}

export function acquirePathLease(
  db: Db,
  input: { path: string; ownerAgentId?: string; sessionId?: string; ttlMs?: number }
): { ok: true; lease: PathLeaseRow } | { ok: false; lease: PathLeaseRow } {
  const at = now();
  const ttl = input.ttlMs ?? 60_000;
  const existing = db.prepare("SELECT * FROM path_leases WHERE path = ?").get(input.path) as PathLeaseRow | undefined;
  if (existing && existing.expires_at > at) {
    if (input.sessionId !== undefined && existing.session_id === input.sessionId) {
      return { ok: true, lease: existing };
    }
    return { ok: false, lease: existing };
  }
  const id = existing?.id ?? newId("lease");
  if (existing) {
    db.prepare(
      "UPDATE path_leases SET owner_agent_id = ?, session_id = ?, acquired_at = ?, expires_at = ?, heartbeat_at = ? WHERE id = ?"
    ).run(input.ownerAgentId ?? null, input.sessionId ?? null, at, at + ttl, at, id);
  } else {
    db.prepare(
      "INSERT INTO path_leases (id, path, owner_agent_id, session_id, acquired_at, expires_at, heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, input.path, input.ownerAgentId ?? null, input.sessionId ?? null, at, at + ttl, at);
  }
  return { ok: true, lease: db.prepare("SELECT * FROM path_leases WHERE id = ?").get(id) as PathLeaseRow };
}

export function heartbeatPathLease(db: Db, path: string, sessionId: string, ttlMs = 60_000): boolean {
  const at = now();
  const result = db.prepare("UPDATE path_leases SET heartbeat_at = ?, expires_at = ? WHERE path = ? AND session_id = ?").run(at, at + ttlMs, path, sessionId);
  return result.changes > 0;
}

export function releasePathLease(db: Db, path: string, sessionId?: string, ownerAgentId?: string): boolean {
  const result = sessionId
    ? ownerAgentId
      ? db.prepare("DELETE FROM path_leases WHERE path = ? AND session_id = ? AND owner_agent_id = ?").run(path, sessionId, ownerAgentId)
      : db.prepare("DELETE FROM path_leases WHERE path = ? AND session_id = ?").run(path, sessionId)
    : ownerAgentId
      ? db.prepare("DELETE FROM path_leases WHERE path = ? AND owner_agent_id = ?").run(path, ownerAgentId)
      : db.prepare("DELETE FROM path_leases WHERE path = ?").run(path);
  return result.changes > 0;
}

export function createTransaction(
  db: Db,
  input: { sessionId: string; turnId?: string; summary?: unknown }
): TransactionRow {
  const id = newId("txn");
  const at = now();
  db.prepare(
    "INSERT INTO transactions (id, session_id, turn_id, status, summary_json, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?, ?)"
  ).run(id, input.sessionId, input.turnId ?? null, JSON.stringify(input.summary ?? {}), at, at);
  return db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as TransactionRow;
}

export function finishTransaction(
  db: Db,
  id: string,
  status: Exclude<TransactionStatus, "open">,
  summary?: unknown
): void {
  db.prepare("UPDATE transactions SET status = ?, summary_json = ?, updated_at = ? WHERE id = ?").run(
    status,
    JSON.stringify(summary ?? {}),
    now(),
    id
  );
}

export function recordFileChange(
  db: Db,
  input: {
    transactionId?: string;
    sessionId: string;
    turnId?: string;
    path: string;
    beforeHash?: string | null;
    afterHash?: string | null;
    beforeText?: string | null;
    afterText?: string | null;
    diffText?: string | null;
    status?: FileChangeStatus;
  }
): FileChangeRow {
  const id = newId("fc");
  db.prepare(
    `INSERT INTO file_changes
      (id, transaction_id, session_id, turn_id, path, before_hash, after_hash, before_text, after_text, diff_text, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.transactionId ?? null,
    input.sessionId,
    input.turnId ?? null,
    input.path,
    input.beforeHash ?? null,
    input.afterHash ?? null,
    input.beforeText ?? null,
    input.afterText ?? null,
    input.diffText ?? null,
    input.status ?? "pending",
    now()
  );
  return db.prepare("SELECT * FROM file_changes WHERE id = ?").get(id) as FileChangeRow;
}

export function listFileChanges(db: Db, transactionId: string): FileChangeRow[] {
  return db
    .prepare("SELECT * FROM file_changes WHERE transaction_id = ? ORDER BY created_at ASC, id ASC")
    .all(transactionId) as FileChangeRow[];
}

export function addArtifact(
  db: Db,
  input: {
    name: string;
    path: string;
    sessionId?: string;
    turnId?: string;
    toolCallId?: string;
    mime?: string;
    size?: number;
    hash?: string;
  }
): ArtifactRow {
  const id = newId("art");
  db.prepare(
    "INSERT INTO artifacts (id, session_id, turn_id, tool_call_id, name, mime, size, path, hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.sessionId ?? null,
    input.turnId ?? null,
    input.toolCallId ?? null,
    input.name,
    input.mime ?? null,
    input.size ?? null,
    input.path,
    input.hash ?? null,
    now()
  );
  return db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow;
}

export function listArtifacts(db: Db, sessionId: string): ArtifactRow[] {
  return db.prepare("SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at DESC").all(sessionId) as ArtifactRow[];
}

export interface SchedulerJobRow {
  id: string;
  name: string;
  schedule: string;
  command: string;
  payload_json: string;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}

export function createSchedulerJob(
  db: Db,
  input: { name: string; schedule: string; command: string; payload?: Record<string, unknown>; nextRunAt?: number; enabled?: boolean }
): SchedulerJobRow {
  const id = newId("job");
  const at = now();
  db.prepare(
    "INSERT INTO scheduler_jobs (id, name, schedule, command, payload_json, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    input.name,
    input.schedule,
    input.command,
    JSON.stringify(input.payload ?? {}),
    input.enabled === false ? 0 : 1,
    input.nextRunAt ?? null,
    at,
    at
  );
  return db.prepare("SELECT * FROM scheduler_jobs WHERE id = ?").get(id) as SchedulerJobRow;
}

export function listSchedulerJobs(db: Db, enabledOnly = false): SchedulerJobRow[] {
  return db
    .prepare(`SELECT * FROM scheduler_jobs ${enabledOnly ? "WHERE enabled = 1" : ""} ORDER BY created_at`)
    .all() as SchedulerJobRow[];
}

export function dueSchedulerJobs(db: Db, at = now(), limit = 5): SchedulerJobRow[] {
  return db
    .prepare("SELECT * FROM scheduler_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?")
    .all(at, limit) as SchedulerJobRow[];
}

export function updateTaskPriority(db: Db, id: string, priority: number): TaskRow | undefined {
  if (!Number.isInteger(priority)) throw new Error("prioritas task harus bilangan bulat");
  const at = now();
  db.prepare("UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?").run(priority, at, id);
  return getTask(db, id);
}
