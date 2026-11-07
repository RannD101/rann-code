import type { Db } from "./db.js";

export const DEFAULT_MAX_RUNTIME_MS = 2 * 60 * 60 * 1_000;
export const DEFAULT_STALL_THRESHOLD_MS = 60_000;

export interface TurnRuntimeView {
  turn_id: string;
  status: "running" | "stalled" | "done" | "failed" | "cancelled";
  max_runtime_ms: number;
  started_at: number;
  last_heartbeat_at: number;
  stalled_at?: number;
  stall_reason?: "heartbeat_lost" | "max_runtime";
  ended_at?: number;
}

export interface StalledTurn {
  turn_id: string;
  reason: "heartbeat_lost" | "max_runtime";
  silence_ms: number;
}

export function startTurnRuntime(
  db: Db,
  input: { turnId: string; maxRuntimeMs?: number; now?: number }
): TurnRuntimeView {
  const now = input.now ?? Date.now();
  const maxRuntimeMs = input.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  db.prepare(
    `INSERT INTO turn_runtime (turn_id, status, max_runtime_ms, started_at, last_heartbeat_at)
     VALUES (?, 'running', ?, ?, ?)
     ON CONFLICT(turn_id) DO UPDATE SET
       status = 'running', max_runtime_ms = excluded.max_runtime_ms,
       started_at = excluded.started_at, last_heartbeat_at = excluded.last_heartbeat_at,
       stalled_at = NULL, stall_reason = NULL, ended_at = NULL`
  ).run(input.turnId, maxRuntimeMs, now, now);
  return getTurnRuntime(db, input.turnId)!;
}

export function heartbeatTurnRuntime(db: Db, turnId: string, now = Date.now()): boolean {
  const result = db
    .prepare("UPDATE turn_runtime SET last_heartbeat_at = ? WHERE turn_id = ? AND status = 'running'")
    .run(now, turnId);
  return result.changes > 0;
}

export function finishTurnRuntime(
  db: Db,
  turnId: string,
  status: "done" | "failed" | "cancelled",
  now = Date.now()
): void {
  db.prepare("UPDATE turn_runtime SET status = ?, ended_at = ? WHERE turn_id = ?").run(status, now, turnId);
}

export function getTurnRuntime(db: Db, turnId: string): TurnRuntimeView | undefined {
  return db.prepare("SELECT * FROM turn_runtime WHERE turn_id = ?").get(turnId) as TurnRuntimeView | undefined;
}

export function findStalledTurns(
  db: Db,
  options: { now?: number; thresholdMs?: number } = {}
): StalledTurn[] {
  const now = options.now ?? Date.now();
  const thresholdMs = options.thresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
  const rows = db
    .prepare("SELECT * FROM turn_runtime WHERE status = 'running' ORDER BY started_at")
    .all() as TurnRuntimeView[];
  const stalled: StalledTurn[] = [];
  for (const row of rows) {
    const silenceMs = now - row.last_heartbeat_at;
    if (now - row.started_at > row.max_runtime_ms) {
      stalled.push({ turn_id: row.turn_id, reason: "max_runtime", silence_ms: silenceMs });
    } else if (silenceMs > thresholdMs) {
      stalled.push({ turn_id: row.turn_id, reason: "heartbeat_lost", silence_ms: silenceMs });
    }
  }
  return stalled;
}

export function markStalledTurns(
  db: Db,
  options: { now?: number; thresholdMs?: number } = {}
): StalledTurn[] {
  const now = options.now ?? Date.now();
  const stalled = findStalledTurns(db, options);
  const update = db.prepare(
    "UPDATE turn_runtime SET status = 'stalled', stalled_at = ?, stall_reason = ? WHERE turn_id = ? AND status = 'running'"
  );
  const apply = db.transaction((items: StalledTurn[]) => {
    for (const item of items) update.run(now, item.reason, item.turn_id);
  });
  apply(stalled);
  return stalled;
}
