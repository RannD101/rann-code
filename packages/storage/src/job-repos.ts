import { newId } from "@rann/shared";
import type { Db } from "./db.js";
import { appendAudit } from "./repos.js";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "dead";

export interface JobRow {
  id: string;
  queue: string;
  kind: string;
  payload_json: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  idempotency_key: string | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
  heartbeat_at: number | null;
  next_run_at: number;
  last_error: string | null;
  result_json: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface JobEventRow {
  id: string;
  job_id: string;
  type: string;
  data_json: string;
  created_at: number;
}

export interface EnqueueJobInput {
  kind: string;
  payload?: Record<string, unknown>;
  queue?: string;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
  nextRunAt?: number;
}

export interface ClaimJobOptions {
  workerId: string;
  queues?: string[];
  leaseMs?: number;
  now?: number;
}

export interface RecoverJobsResult {
  requeued: number;
  dead: number;
}

const now = (): number => Date.now();

export function enqueueJob(db: Db, input: EnqueueJobInput): JobRow {
  const at = now();
  if (input.idempotencyKey) {
    const existing = db.prepare("SELECT * FROM jobs WHERE idempotency_key = ?").get(input.idempotencyKey) as
      | JobRow
      | undefined;
    if (existing) return existing;
  }
  const id = newId("bg");
  db.prepare(
    `INSERT INTO jobs (id, queue, kind, payload_json, status, priority, attempts, max_attempts,
       idempotency_key, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.queue ?? "default",
    input.kind,
    JSON.stringify(input.payload ?? {}),
    input.priority ?? 100,
    Math.max(1, input.maxAttempts ?? 3),
    input.idempotencyKey ?? null,
    input.nextRunAt ?? at,
    at,
    at
  );
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow;
  appendJobEvent(db, id, "queued", { kind: row.kind, queue: row.queue });
  return row;
}

export function getJob(db: Db, id: string): JobRow | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
}

export function listJobs(
  db: Db,
  filter: { status?: JobStatus | JobStatus[]; queue?: string; kind?: string; limit?: number } = {}
): JobRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    where.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (filter.queue) {
    where.push("queue = ?");
    params.push(filter.queue);
  }
  if (filter.kind) {
    where.push("kind = ?");
    params.push(filter.kind);
  }
  const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY priority DESC, created_at ASC LIMIT ?`;
  params.push(Math.min(Math.max(filter.limit ?? 50, 1), 500));
  return db.prepare(sql).all(...params) as JobRow[];
}

export function claimJob(db: Db, options: ClaimJobOptions): JobRow | undefined {
  const at = options.now ?? now();
  const leaseMs = Math.max(options.leaseMs ?? 60_000, 1_000);
  const queues = options.queues?.length ? options.queues : ["default"];
  const claim = db.transaction((): JobRow | undefined => {
    const placeholders = queues.map(() => "?").join(",");
    const candidate = db
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'queued' AND queue IN (${placeholders}) AND next_run_at <= ?
         ORDER BY priority ASC, next_run_at ASC, created_at ASC LIMIT 1`
      )
      .get(...queues, at) as JobRow | undefined;
    if (!candidate) return undefined;
    const changed = db
      .prepare(
        `UPDATE jobs SET status = 'running', lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?,
           attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'`
      )
      .run(options.workerId, at + leaseMs, at, at, candidate.id);
    if (changed.changes !== 1) return undefined;
    appendJobEvent(db, candidate.id, "started", { worker: options.workerId, attempt: candidate.attempts + 1 });
    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(candidate.id) as JobRow;
  });
  return claim();
}

export function heartbeatJob(db: Db, id: string, workerId: string, leaseMs = 60_000): boolean {
  const at = now();
  const changed = db
    .prepare(
      `UPDATE jobs SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'running' AND lease_owner = ?`
    )
    .run(at, at + leaseMs, at, id, workerId);
  return changed.changes === 1;
}

export function completeJob(db: Db, id: string, result: unknown, workerId?: string): boolean {
  const at = now();
  const changed = workerId
    ? db
        .prepare(
          `UPDATE jobs SET status = 'done', result_json = ?, last_error = NULL, completed_at = ?, updated_at = ?,
             lease_owner = NULL, lease_expires_at = NULL
           WHERE id = ? AND status = 'running' AND lease_owner = ?`
        )
        .run(JSON.stringify(result ?? null), at, at, id, workerId)
    : db
        .prepare(
          `UPDATE jobs SET status = 'done', result_json = ?, last_error = NULL, completed_at = ?, updated_at = ?,
             lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND status = 'running'`
        )
        .run(JSON.stringify(result ?? null), at, at, id);
  if (changed.changes === 1) appendJobEvent(db, id, "done", {});
  return changed.changes === 1;
}

export function failJob(db: Db, id: string, error: unknown, workerId?: string): JobStatus | undefined {
  const at = now();
  const row = getJob(db, id);
  if (!row) return undefined;
  const message = error instanceof Error ? error.message : String(error);
  const canRetry = row.attempts < row.max_attempts;
  const status: JobStatus = canRetry ? "queued" : row.status === "cancelled" ? "cancelled" : "dead";
  const backoffMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, row.attempts - 1));
  const changed = workerId
    ? db
        .prepare(
          `UPDATE jobs SET status = ?, last_error = ?, next_run_at = ?, updated_at = ?,
             lease_owner = NULL, lease_expires_at = NULL
           WHERE id = ? AND status = 'running' AND lease_owner = ?`
        )
        .run(status, message, canRetry ? at + backoffMs : row.next_run_at, at, id, workerId)
    : db
        .prepare(
          `UPDATE jobs SET status = ?, last_error = ?, next_run_at = ?, updated_at = ?,
             lease_owner = NULL, lease_expires_at = NULL WHERE id = ?`
        )
        .run(status, message, canRetry ? at + backoffMs : row.next_run_at, at, id);
  if (changed.changes === 1) appendJobEvent(db, id, canRetry ? "retry" : "failed", { error: message, status });
  return status;
}

export function cancelJob(db: Db, id: string, reason = "cancelled by user"): boolean {
  const at = now();
  const changed = db
    .prepare(
      `UPDATE jobs SET status = 'cancelled', last_error = ?, completed_at = ?, updated_at = ?,
         lease_owner = NULL, lease_expires_at = NULL
       WHERE id = ? AND status IN ('queued','running')`
    )
    .run(reason, at, at, id);
  if (changed.changes === 1) appendJobEvent(db, id, "cancelled", { reason });
  return changed.changes === 1;
}

export function cancelQueuedJobsForRun(db: Db, runId: string, reason: string): number {
  const rows = db
    .prepare("SELECT id FROM jobs WHERE status = 'queued' AND json_extract(payload_json, '$.runId') = ?")
    .all(runId) as Array<{ id: string }>;
  for (const row of rows) cancelJob(db, row.id, reason);
  return rows.length;
}

export function retryJob(db: Db, id: string, delayMs = 0): boolean {
  const at = now();
  const changed = db
    .prepare(
      `UPDATE jobs SET status = 'queued', next_run_at = ?, completed_at = NULL, last_error = NULL,
         lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status IN ('failed','dead','cancelled')`
    )
    .run(at + Math.max(0, delayMs), at, id);
  if (changed.changes === 1) appendJobEvent(db, id, "requeued", {});
  return changed.changes === 1;
}

export function recoverStaleJobs(db: Db, options: { leaseGraceMs?: number; now?: number } = {}): RecoverJobsResult {
  const at = options.now ?? now();
  const grace = options.leaseGraceMs ?? 0;
  const stale = db
    .prepare("SELECT * FROM jobs WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?")
    .all(at - grace) as JobRow[];
  let requeued = 0;
  let dead = 0;
  for (const job of stale) {
    if (job.attempts < job.max_attempts) {
      db.prepare(
        `UPDATE jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
           next_run_at = ?, updated_at = ? WHERE id = ? AND status = 'running'`
      ).run(at, at, job.id);
      appendJobEvent(db, job.id, "recovered", { action: "requeued" });
      appendAudit(db, { actor: "system", action: "job.recover", resource: `job:${job.id}`, decision: "allow", metadata: { action: "requeued", attempts: job.attempts } });
      requeued += 1;
    } else {
      db.prepare(
        `UPDATE jobs SET status = 'dead', last_error = ?, completed_at = ?, updated_at = ?,
           lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND status = 'running'`
      ).run("lease expired after maximum attempts", at, at, job.id);
      appendJobEvent(db, job.id, "recovered", { action: "dead" });
      appendAudit(db, { actor: "system", action: "job.recover", resource: `job:${job.id}`, decision: "deny", metadata: { action: "dead", attempts: job.attempts } });
      dead += 1;
    }
  }
  return { requeued, dead };
}

export function appendJobEvent(db: Db, jobId: string, type: string, data: Record<string, unknown>): void {
  db.prepare("INSERT INTO job_events (id, job_id, type, data_json, created_at) VALUES (?, ?, ?, ?, ?)").run(
    newId("evt"),
    jobId,
    type,
    JSON.stringify(data),
    now()
  );
}

export function listJobEvents(db: Db, jobId: string, limit = 200): JobEventRow[] {
  return db
    .prepare("SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at ASC LIMIT ?")
    .all(jobId, Math.min(Math.max(limit, 1), 1000)) as JobEventRow[];
}

export interface SchedulerRow {
  id: string;
  name: string;
  schedule: string;
  command: string;
  payload_json: string;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  timezone: string;
  misfire_policy: "run_once" | "skip";
  overlap_policy: "skip" | "queue" | "replace";
  catch_up: number;
  max_attempts: number;
  created_at: number;
  updated_at: number;
}

export interface SchedulerRunRow {
  id: string;
  job_id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  started_at: number | null;
  ended_at: number | null;
  output: string | null;
  error_message: string | null;
  attempt: number;
  scheduled_for: number | null;
  duration_ms: number | null;
  created_at: number;
}

export function createScheduler(db: Db, input: {
  name: string;
  schedule: string;
  command: string;
  payload?: Record<string, unknown>;
  timezone?: string;
  misfirePolicy?: "run_once" | "skip";
  overlapPolicy?: "skip" | "queue" | "replace";
  catchUp?: boolean;
  maxAttempts?: number;
  nextRunAt?: number | null;
  enabled?: boolean;
}): SchedulerRow {
  const id = newId("sch");
  const at = now();
  db.prepare(
    `INSERT INTO scheduler_jobs (id, name, schedule, command, payload_json, enabled, next_run_at, last_run_at,
       created_at, updated_at, timezone, misfire_policy, overlap_policy, catch_up, max_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.schedule,
    input.command,
    JSON.stringify(input.payload ?? {}),
    input.enabled === false ? 0 : 1,
    input.nextRunAt ?? null,
    at,
    at,
    input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    input.misfirePolicy ?? "run_once",
    input.overlapPolicy ?? "skip",
    input.catchUp === false ? 0 : 1,
    Math.max(1, input.maxAttempts ?? 3)
  );
  return getScheduler(db, id) as SchedulerRow;
}

export function getScheduler(db: Db, idOrName: string): SchedulerRow | undefined {
  return db.prepare("SELECT * FROM scheduler_jobs WHERE id = ? OR name = ?").get(idOrName, idOrName) as
    | SchedulerRow
    | undefined;
}

export function listSchedulers(db: Db): SchedulerRow[] {
  return db.prepare("SELECT * FROM scheduler_jobs ORDER BY created_at").all() as SchedulerRow[];
}

export function dueSchedulers(db: Db, at = now(), limit = 10): SchedulerRow[] {
  return db
    .prepare("SELECT * FROM scheduler_jobs WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?")
    .all(at, Math.min(Math.max(limit, 1), 100)) as SchedulerRow[];
}

export function updateScheduler(
  db: Db,
  id: string,
  patch: Partial<Pick<SchedulerRow, "schedule" | "command" | "enabled" | "next_run_at" | "timezone" | "misfire_policy" | "overlap_policy" | "catch_up" | "max_attempts">> & {
    payload?: Record<string, unknown>;
  }
): SchedulerRow | undefined {
  const existing = getScheduler(db, id);
  if (!existing) return undefined;
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of ["schedule", "command", "enabled", "next_run_at", "timezone", "misfire_policy", "overlap_policy", "catch_up", "max_attempts"] as const) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      values.push(patch[key]);
    }
  }
  if (patch.payload !== undefined) {
    fields.push("payload_json = ?");
    values.push(JSON.stringify(patch.payload));
  }
  if (!fields.length) return existing;
  fields.push("updated_at = ?");
  values.push(now(), existing.id);
  db.prepare(`UPDATE scheduler_jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getScheduler(db, existing.id);
}

export function removeScheduler(db: Db, idOrName: string): boolean {
  const row = getScheduler(db, idOrName);
  if (!row) return false;
  db.prepare("DELETE FROM scheduler_jobs WHERE id = ?").run(row.id);
  return true;
}

export function startSchedulerRun(
  db: Db,
  scheduler: SchedulerRow,
  scheduledFor: number | null
): SchedulerRunRow {
  const id = newId("run");
  const at = now();
  db.prepare(
    `INSERT INTO job_runs (id, job_id, status, started_at, attempt, scheduled_for, created_at)
     VALUES (?, ?, 'running', ?, 1, ?, ?)`
  ).run(id, scheduler.id, at, scheduledFor, at);
  db.prepare("UPDATE scheduler_jobs SET last_run_at = ?, updated_at = ? WHERE id = ?").run(at, at, scheduler.id);
  return db.prepare("SELECT * FROM job_runs WHERE id = ?").get(id) as SchedulerRunRow;
}

export function finishSchedulerRun(
  db: Db,
  runId: string,
  status: "done" | "failed" | "cancelled",
  output?: string,
  error?: string
): void {
  const at = now();
  const run = db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId) as SchedulerRunRow | undefined;
  if (!run) return;
  db.prepare(
    `UPDATE job_runs SET status = ?, ended_at = ?, duration_ms = ?, output = ?, error_message = ? WHERE id = ?`
  ).run(status, at, at - (run.started_at ?? at), output?.slice(0, 20_000) ?? null, error?.slice(0, 4_000) ?? null, runId);
}

export function listSchedulerRuns(db: Db, schedulerId: string, limit = 50): SchedulerRunRow[] {
  return db
    .prepare("SELECT * FROM job_runs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(schedulerId, Math.min(Math.max(limit, 1), 500)) as SchedulerRunRow[];
}

export function runningSchedulerRuns(db: Db, schedulerId: string): SchedulerRunRow[] {
  return db
    .prepare("SELECT * FROM job_runs WHERE job_id = ? AND status = 'running' ORDER BY created_at DESC")
    .all(schedulerId) as SchedulerRunRow[];
}
