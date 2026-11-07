import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSession,
  createTurn,
  finishTurnRuntime,
  findStalledTurns,
  getTurnRuntime,
  heartbeatTurnRuntime,
  markStalledTurns,
  openDatabase,
  startTurnRuntime,
  type Db
} from "./index.js";

const opened: Db[] = [];

function setup(): { db: Db; sessionId: string; turnId: string } {
  const dir = mkdtempSync(join(tmpdir(), "rann-runtime-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  opened.push(db);
  const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
  const turn = createTurn(db, { sessionId: session.id });
  return { db, sessionId: session.id, turnId: turn.id };
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe("turn runtime", () => {
  it("mencatat heartbeat dan menyelesaikan runtime", () => {
    const { db, turnId } = setup();
    const started = startTurnRuntime(db, { turnId, maxRuntimeMs: 60_000, now: 1_000 });
    expect(started).toMatchObject({ status: "running", last_heartbeat_at: 1_000, max_runtime_ms: 60_000 });
    expect(heartbeatTurnRuntime(db, turnId, 9_000)).toBe(true);
    expect(getTurnRuntime(db, turnId)?.last_heartbeat_at).toBe(9_000);
    finishTurnRuntime(db, turnId, "done", 10_000);
    expect(getTurnRuntime(db, turnId)).toMatchObject({ status: "done", ended_at: 10_000 });
    expect(heartbeatTurnRuntime(db, turnId, 11_000)).toBe(false);
  });

  it("menandai turn stalled karena heartbeat hilang atau max runtime", () => {
    const { db, turnId } = setup();
    startTurnRuntime(db, { turnId, maxRuntimeMs: 120_000, now: 1_000 });
    expect(findStalledTurns(db, { now: 30_000 })).toEqual([]);
    const [lost] = findStalledTurns(db, { now: 70_000, thresholdMs: 60_000 });
    expect(lost).toMatchObject({ turn_id: turnId, reason: "heartbeat_lost" });
    const marked = markStalledTurns(db, { now: 70_000, thresholdMs: 60_000 });
    expect(marked).toHaveLength(1);
    expect(getTurnRuntime(db, turnId)).toMatchObject({ status: "stalled", stall_reason: "heartbeat_lost" });
    expect(markStalledTurns(db, { now: 80_000, thresholdMs: 60_000 })).toEqual([]);
  });

  it("memakai max runtime walau heartbeat masih segar", () => {
    const { db, turnId } = setup();
    startTurnRuntime(db, { turnId, maxRuntimeMs: 10_000, now: 1_000 });
    heartbeatTurnRuntime(db, turnId, 12_000);
    const stalled = findStalledTurns(db, { now: 12_000, thresholdMs: 60_000 });
    expect(stalled).toEqual([{ turn_id: turnId, reason: "max_runtime", silence_ms: 0 }]);
  });
});
