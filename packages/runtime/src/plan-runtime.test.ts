import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addToolCall,
  completeToolCall,
  createSession,
  createTurn,
  getPlan,
  openDatabase,
  updateTaskStatus,
  type Db
} from "@rann/storage";
import { finishPlan, persistPlan, revisePlan, verifyPlan } from "./plan-runtime.js";
import type { PlanDraft, PlanValidation } from "./planner.js";

const open: Db[] = [];

function fresh(): { db: Db; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "rann-plan-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  open.push(db);
  return { db, dir };
}

afterEach(() => {
  while (open.length > 0) open.pop()?.close();
});

const draft: PlanDraft = {
  goal: "Tambah endpoint",
  assumptions: [],
  criteria: [
    { id: "c1", type: "test", command: "pnpm test", expect: "exit 0" },
    { id: "c2", type: "file", path: "src/app.ts", expect: "ada" }
  ],
  tasks: [
    {
      id: "t1",
      title: "Buat endpoint",
      agent: "coding",
      dependsOn: [],
      files: ["src/app.ts"],
      risk: "medium",
      acceptance: "Endpoint mengembalikan 200"
    }
  ],
  estimate: { minutes: [5, 10], costUsd: [0, 0.1] },
  risks: []
};

const validation: PlanValidation = {
  ok: true,
  errors: [],
  order: ["t1"],
  highRisk: false,
  fileCount: 1
};

describe("plan runtime", () => {
  it("menyimpan plan dan task, lalu menutupnya", () => {
    const { db, dir } = fresh();
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "ask" });
    const turn = createTurn(db, { sessionId: session.id });
    const events: string[] = [];
    const plan = persistPlan(db, session.id, turn.id, draft, validation, "teks rencana", (type) => events.push(type));
    expect(plan.taskIds.size).toBe(1);
    expect(events).toContain("plan.update");
    finishPlan(db, plan, "done", (type) => events.push(type));
    const row = db.prepare("SELECT status FROM plans WHERE id = ?").get(plan.id) as { status: string };
    expect(row.status).toBe("done");
  });

  it("memverifikasi perintah dan file, lalu melaporkan gap", () => {
    const { db, dir } = fresh();
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "ask" });
    const turn = createTurn(db, { sessionId: session.id });

    let result = verifyPlan(db, turn.id, draft, dir);
    expect(result.passed).toBe(false);
    expect(result.gaps).toHaveLength(2);

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "export {};", { encoding: "utf8" });
    const call = addToolCall(db, { sessionId: session.id, turnId: turn.id, toolName: "shell_run", args: { command: "pnpm test" } });
    completeToolCall(db, call.id, { status: "ok", result: { output: "ok" }, exitCode: 0, durationMs: 5 });

    result = verifyPlan(db, turn.id, draft, dir);
    expect(result.passed).toBe(true);
    expect(result.checked).toBe(2);
  });

  it("merevisi plan, menaikkan versi, dan mempertahankan task selesai", () => {
    const { db, dir } = fresh();
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "ask" });
    const turn = createTurn(db, { sessionId: session.id });
    const plan = persistPlan(db, session.id, turn.id, draft, validation, "teks rencana", () => {});
    const first = plan.taskIds.get("t1");
    expect(first).toBeTypeOf("string");
    updateTaskStatus(db, first!, "done");

    const next = revisePlan(
      db,
      plan,
      {
        reason: "file target berubah",
        tasks: [
          {
            id: "t1",
            title: "Buat endpoint",
            agent: "coding",
            dependsOn: [],
            files: ["src/app.ts"],
            risk: "medium",
            acceptance: "Endpoint mengembalikan 200"
          },
          {
            id: "t2",
            title: "Tambah tes endpoint",
            agent: "testing",
            dependsOn: ["t1"],
            files: ["src/app.test.ts"],
            risk: "low",
            acceptance: "tes lulus"
          }
        ]
      },
      () => {}
    );

    expect(next.version).toBe(2);
    expect(getPlan(db, plan.id)?.version).toBe(2);
    const tasks = db
      .prepare("SELECT title, status FROM tasks WHERE plan_id = ? ORDER BY created_at")
      .all(plan.id) as { title: string; status: string }[];
    expect(tasks.find((task) => task.title === "Buat endpoint")?.status).toBe("done");
    expect(tasks.find((task) => task.title === "Tambah tes endpoint")?.status).toBe("queued");
    const metadata = JSON.parse(getPlan(db, plan.id)?.metadata_json ?? "{}") as {
      revisions?: { reason: string }[];
    };
    expect(metadata.revisions?.at(-1)?.reason).toBe("file target berubah");
  });
});
