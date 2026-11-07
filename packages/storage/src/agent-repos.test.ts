import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquirePathLease,
  cancelSubagentTree,
  countSubagentChildren,
  createSession,
  createSubagent,
  finishSubagent,
  getSubagent,
  heartbeatSubagent,
  listSubagentMessages,
  listSubagents,
  markOrphanedSubagents,
  openDatabase,
  recordSubagentMessage,
  releaseAgentLeases,
  subagentForest,
  updateSubagent,
  type Db
} from "./index.js";

const opened: Db[] = [];

function setup(): Db {
  const dir = mkdtempSync(join(tmpdir(), "rann-subagent-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

function seed(db: Db) {
  const session = createSession(db, { title: "induk", model: "mock", permissionMode: "ask" });
  const root = createSubagent(db, {
    sessionId: session.id,
    profile: "explore",
    goal: "petakan repo",
    depth: 0,
    path: "explore"
  });
  const child = createSubagent(db, {
    sessionId: session.id,
    parentId: root.id,
    profile: "tester",
    goal: "jalankan tes",
    depth: 1,
    path: "explore/tester"
  });
  return { session, root, child };
}

describe("subagent storage", () => {
  it("membuat pohon, menghitung anak aktif, dan menyusun forest", () => {
    const db = setup();
    const { root, child } = seed(db);

    expect(getSubagent(db, child.id)?.parent_id).toBe(root.id);
    expect(getSubagent(db, child.id)?.profile).toBe("tester");
    expect(countSubagentChildren(db, root.id)).toBe(1);

    const forest = subagentForest(db);
    expect(forest).toHaveLength(1);
    expect(forest[0]?.id).toBe(root.id);
    expect(forest[0]?.children[0]?.id).toBe(child.id);
  });

  it("memperbarui status, heartbeat, dan hasil akhir", () => {
    const db = setup();
    const { root } = seed(db);

    updateSubagent(db, root.id, { status: "running", steps: 2 });
    heartbeatSubagent(db, root.id, { steps: 4, costUsd: 0.25 });
    const running = getSubagent(db, root.id)!;
    expect(running.status).toBe("running");
    expect(running.steps).toBe(4);
    expect(running.heartbeat_at).toBeTypeOf("number");

    finishSubagent(db, root.id, "done", { text: "selesai" });
    const done = getSubagent(db, root.id)!;
    expect(done.status).toBe("done");
    expect(done.finished_at).toBeTypeOf("number");
    expect(JSON.parse(done.result_json ?? "{}")).toEqual({ text: "selesai" });
    expect(listSubagents(db, { status: "done" }).map((row) => row.id)).toEqual([root.id]);
  });

  it("membatalkan seluruh pohon dan menandai heartbeat basi sebagai orphan", () => {
    const db = setup();
    const { root, child } = seed(db);
    updateSubagent(db, root.id, { status: "running" });
    updateSubagent(db, child.id, { status: "waiting" });

    expect(cancelSubagentTree(db, root.id).sort()).toEqual([root.id, child.id].sort());
    expect(getSubagent(db, root.id)?.status).toBe("cancelled");
    expect(getSubagent(db, child.id)?.status).toBe("cancelled");

    const { root: stale } = seed(db);
    updateSubagent(db, stale.id, { status: "running" });
    db.prepare("UPDATE agents SET heartbeat_at = ?, updated_at = ? WHERE id = ?").run(Date.now() - 120_000, Date.now() - 120_000, stale.id);
    expect(markOrphanedSubagents(db, 60_000)).toContain(stale.id);
    expect(getSubagent(db, stale.id)?.status).toBe("failed");
  });

  it("mencatat pesan dan melepas lease saat agent selesai", () => {
    const db = setup();
    const { root, child } = seed(db);

    const id = recordSubagentMessage(db, {
      from: root.id,
      to: child.id,
      type: "note",
      subject: "arah",
      body: "fokus ke tes",
      refs: ["src/a.ts"],
      priority: "high"
    });
    expect(id.startsWith("amsg_")).toBe(true);
    const inbox = listSubagentMessages(db, child.id);
    expect(inbox[0]?.subject).toBe("arah");
    expect(inbox[0]?.refs).toEqual(["src/a.ts"]);

    expect(acquirePathLease(db, { path: "src/a.ts", ownerAgentId: root.id }).ok).toBe(true);
    releaseAgentLeases(db, root.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM path_leases").get()).toEqual({ n: 0 });
  });
});
