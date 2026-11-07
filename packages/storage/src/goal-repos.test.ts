import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSession,
  finishGoal,
  getActiveGoal,
  listGoals,
  openDatabase,
  setGoal,
  updateGoalProgress,
  type Db
} from "./index.js";

const opened: Db[] = [];

function setup(): { db: Db; sessionId: string } {
  const dir = mkdtempSync(join(tmpdir(), "rann-goal-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  opened.push(db);
  const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
  return { db, sessionId: session.id };
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe("goal tracking", () => {
  it("menyimpan goal, kriteria, dan asumsi", () => {
    const { db, sessionId } = setup();
    const goal = setGoal(db, {
      sessionId,
      goal: "Tambahkan rate limit per API key",
      criteria: ["Middleware terpasang", { id: "c2", text: "Tes 429 lulus" }],
      assumptions: ["Redis sudah ada"],
      createdBy: "user"
    });
    expect(goal.version).toBe(1);
    expect(goal.criteria.map((item) => item.id)).toEqual(["c1", "c2"]);
    expect(goal.progress.step).toBe(0);
    expect(getActiveGoal(db, sessionId)?.goal).toContain("rate limit");
  });

  it("menolak agent mengubah goal dan menjaga versi saat replan", () => {
    const { db, sessionId } = setup();
    setGoal(db, { sessionId, goal: "Goal awal", criteria: ["selesai"], createdBy: "user" });
    expect(() =>
      setGoal(db, { sessionId, goal: "Goal baru", createdBy: "agent" as "user" })
    ).toThrowError(/Agent tidak boleh/);
    const replanned = setGoal(db, { sessionId, goal: "Goal hasil replan", criteria: ["selesai"], createdBy: "replan" });
    expect(replanned.version).toBe(2);
    expect(listGoals(db, sessionId)).toHaveLength(2);
    expect(listGoals(db, sessionId)[1]?.status).toBe("superseded");
  });

  it("menandai kriteria dengan bukti dan menyimpan progres", () => {
    const { db, sessionId } = setup();
    setGoal(db, { sessionId, goal: "Perbaiki bug", criteria: ["tes hijau", "build sukses"], createdBy: "user" });
    const progress = updateGoalProgress(db, sessionId, {
      action: "menjalankan tes",
      tool: "shell_run",
      complete: [{ id: "c1", evidence: "pnpm test 137 passed" }]
    });
    expect(progress?.progress.step).toBe(1);
    expect(progress?.criteria[0]).toMatchObject({ done: true, evidence: "pnpm test 137 passed" });
    expect(() => updateGoalProgress(db, sessionId, { complete: [{ id: "c2", evidence: " " }] })).toThrowError(/bukti/);
    expect(() => updateGoalProgress(db, sessionId, { complete: [{ id: "c9", evidence: "ada" }] })).toThrowError(/tidak ditemukan/);
  });

  it("menutup goal dan mempertahankan state setelah koneksi dibuka ulang", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-goal-reopen-"));
    const path = join(dir, "rann.db");
    const first = openDatabase({ path }).db;
    const session = createSession(first, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
    setGoal(first, { sessionId: session.id, goal: "Task panjang", criteria: ["beres"], createdBy: "user" });
    updateGoalProgress(first, session.id, { action: "langkah satu" });
    expect(() => finishGoal(first, session.id, "done", "selesai")).toThrowError(/kriteria belum terpenuhi/);
    updateGoalProgress(first, session.id, { complete: [{ id: "c1", evidence: "tes lulus" }] });
    finishGoal(first, session.id, "done", "selesai");
    first.close();

    const second = openDatabase({ path }).db;
    opened.push(second);
    expect(getActiveGoal(second, session.id)).toBeUndefined();
    expect(listGoals(second, session.id)[0]).toMatchObject({ status: "done", progress: { step: 2 } });
  });
});
