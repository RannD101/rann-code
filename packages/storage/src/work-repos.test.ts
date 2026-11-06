import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquirePathLease,
  addArtifact,
  addPlanNode,
  addTaskStep,
  createCheckpoint,
  createPlan,
  createAgent,
  createSchedulerJob,
  createSession,
  createTask,
  dueSchedulerJobs,
  findApproval,
  latestCheckpoint,
  listPlanNodes,
  listTaskSteps,
  openDatabase,
  recordApproval,
  releasePathLease,
  updateTaskStatus,
  type Db
} from "./index.js";

const open: Db[] = [];

function freshDb(): { db: Db; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "rann-work-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  open.push(db);
  return { db, dir };
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

describe("work repositories", () => {
  it("membuat plan, task, step, dan menyelesaikannya", () => {
    const { db, dir } = freshDb();
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "ask" });
    const plan = createPlan(db, { sessionId: session.id, goal: "bangun fitur" });
    const node = addPlanNode(db, { planId: plan.id, title: "riset" });
    expect(listPlanNodes(db, plan.id).map((row) => row.id)).toEqual([node.id]);
    expect(node.status).toBe("pending");

    const task = createTask(db, { sessionId: session.id, planId: plan.id, title: "riset provider" });
    expect(task.status).toBe("queued");
    const step = addTaskStep(db, { taskId: task.id, title: "baca dokumen" });
    expect(step.idx).toBe(0);
    expect(listTaskSteps(db, task.id)).toHaveLength(1);

    const done = updateTaskStatus(db, task.id, "done");
    expect(done?.status).toBe("done");
    expect(done?.ended_at).toBeTypeOf("number");
  });

  it("menyimpan checkpoint dan mengambil yang terbaru", () => {
    const { db, dir } = freshDb();
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "ask" });
    const first = createCheckpoint(db, { sessionId: session.id, label: "awal", state: { step: 1 } });
    const second = createCheckpoint(db, { sessionId: session.id, label: "akhir", state: { step: 2 }, files: ["a.txt"] });
    expect(latestCheckpoint(db, session.id)?.id).toBe(second.id);
    expect(first.kind).toBe("turn");
    expect(second.files_json).toBe('["a.txt"]');
  });

  it("mencatat approval dan lease path", () => {
    const { db, dir } = freshDb();
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "ask" });
    recordApproval(db, {
      sessionId: session.id,
      toolName: "fs_write",
      argsHash: "abc",
      decision: "allow",
      scope: "session"
    });
    expect(findApproval(db, { sessionId: session.id, toolName: "fs_write", argsHash: "abc" })?.decision).toBe("allow");
    expect(findApproval(db, { sessionId: session.id, toolName: "fs_write", argsHash: "lain" })).toBeUndefined();

    const agent = createAgent(db, { name: "pekerja-1" });
    const other = createAgent(db, { name: "pekerja-2" });
    const lease = acquirePathLease(db, { path: join(dir, "a.txt"), ownerAgentId: agent.id, ttlMs: 10_000 });
    expect(lease.ok).toBe(true);
    const conflict = acquirePathLease(db, { path: join(dir, "a.txt"), ownerAgentId: other.id });
    expect(conflict.ok).toBe(false);
    expect(releasePathLease(db, join(dir, "a.txt"), agent.id)).toBe(true);
    expect(acquirePathLease(db, { path: join(dir, "a.txt"), ownerAgentId: other.id }).ok).toBe(true);
  });

  it("mencatat artifact dan job scheduler yang jatuh tempo", () => {
    const { db, dir } = freshDb();
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "ask" });
    const artifact = addArtifact(db, { name: "hasil.txt", path: join(dir, "hasil.txt"), sessionId: session.id, size: 12 });
    expect(artifact.name).toBe("hasil.txt");

    createSchedulerJob(db, { name: "harian", schedule: "0 0 * * *", command: "ringkas", nextRunAt: 10 });
    createSchedulerJob(db, { name: "nanti", schedule: "0 0 * * *", command: "lain", nextRunAt: 99_999_999_999 });
    expect(dueSchedulerJobs(db, 20).map((row) => row.name)).toEqual(["harian"]);
  });
});
