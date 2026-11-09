import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, createTurn, getPlan, openDatabase } from "@rann/storage";
import { runTurn, type AgentConfig } from "./agent.js";
import { normalizePlan, validatePlan } from "./planner.js";
import { persistPlan } from "./plan-runtime.js";
import { MockProvider } from "./providers/mock.js";
import type { ProviderChunk } from "./providers/types.js";

const config: AgentConfig = {
  permissionMode: "trusted",
  workspaceOnly: true,
  allow: [],
  deny: [],
  maxSteps: 5,
  systemExtra: ""
};

const draft = normalizePlan(
  {
    goal: "Uji",
    criteria: [{ id: "c1", type: "file", path: "hasil.txt", expect: "ada" }],
    tasks: [
      {
        id: "t1",
        title: "Baca berkas",
        description: "Baca berkas contoh",
        agent: "coding",
        dependsOn: [],
        files: ["hasil.txt"],
        risk: "low",
        acceptance: "Isi terbaca"
      }
    ],
    estimate: { minutes: [1, 2], costUsd: [0, 0.01] }
  },
  "uji"
)!;

class RepeatFailProvider extends MockProvider {
  async *chat(): AsyncGenerator<ProviderChunk, void, unknown> {
    yield { type: "tool_call", id: `call_${Date.now()}`, name: "fs_read", args: { path: "tidak-ada.txt" } };
    yield { type: "usage", inputTokens: 2, outputTokens: 1 };
    yield { type: "done", finishReason: "tool_calls" };
  }
}

function setup(): { db: ReturnType<typeof openDatabase>["db"]; dir: string; session: ReturnType<typeof createSession>; turn: ReturnType<typeof createTurn> } {
  const dir = mkdtempSync(join(tmpdir(), "rann-ac-agent2-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
  const turn = createTurn(db, { sessionId: session.id });
  return { db, dir, session, turn };
}

describe("acceptance agent lanjutan", () => {
  it("AC-021 fase understand, act, observe, evaluate terjadi pada turn", async () => {
    const { db, dir, session, turn } = setup();
    const phases: string[] = [];
    await runTurn({
      db,
      session,
      turnId: turn.id,
      userText: 'tool:fs_list {"path":"."}',
      provider: new MockProvider(),
      model: "urut-1",
      workspaceRoot: dir,
      config,
      emit: (event) => {
        if (event.type === "phase" && typeof event.data.phase === "string") phases.push(event.data.phase);
      }
    });
    expect(phases).toEqual(expect.arrayContaining(["understand", "act", "observe", "evaluate"]));
  });

  it("AC-029 plan dan versinya bertahan setelah database dibuka ulang", () => {
    const { db, dir, session, turn } = setup();
    const validation = validatePlan(draft);
    const plan = persistPlan(db, session.id, turn.id, draft, validation, "awal", () => {});
    db.close();
    const reopened = openDatabase({ path: join(dir, "rann.db") }).db;
    const stored = getPlan(reopened, plan.id);
    expect(stored?.status).toBe("active");
    expect(stored?.version).toBe(1);
    expect(JSON.parse(stored?.metadata_json ?? "{}").snapshots[0].version).toBe(1);
  });

  it("AC-032/033 tool gagal berulang identik dihentikan dengan E_NO_PROGRESS", async () => {
    const { db, dir, session, turn } = setup();
    const error = await runTurn({
      db,
      session,
      turnId: turn.id,
      userText: 'tool:fs_read {"path":"tidak-ada.txt"}',
      provider: new RepeatFailProvider(),
      model: "ulang-1",
      workspaceRoot: dir,
      config
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "E_NO_PROGRESS" });
    const calls = db.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE turn_id = ?").get(turn.id) as { n: number };
    expect(calls.n).toBeLessThanOrEqual(3);
  });
});
