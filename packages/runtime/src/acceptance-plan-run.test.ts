import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, createTurn, listTasks, openDatabase } from "@rann/storage";
import { runTurn, type AgentConfig } from "./agent.js";
import type { ChatRequest, Provider, ProviderChunk } from "./providers/types.js";

const PLAN = {
  goal: "Tambah rate limit",
  assumptions: [],
  criteria: [{ id: "c1", type: "file", path: "hasil.txt", expect: "ada" }],
  tasks: [
    { id: "t1", title: "Satu", description: "Kerjakan satu", agent: "coding", dependsOn: [], files: ["a.txt"], risk: "low", acceptance: "selesai" },
    { id: "t2", title: "Dua", description: "Kerjakan dua", agent: "coding", dependsOn: ["t1"], files: ["b.txt"], risk: "low", acceptance: "selesai" },
    { id: "t3", title: "Tiga", description: "Kerjakan tiga", agent: "coding", dependsOn: ["t2"], files: ["c.txt"], risk: "low", acceptance: "selesai" }
  ],
  estimate: { minutes: [5, 10], costUsd: [0, 0.01] },
  risks: []
};

const config: AgentConfig = {
  permissionMode: "trusted",
  workspaceOnly: true,
  allow: [],
  deny: [],
  maxSteps: 4,
  systemExtra: ""
};

class PlanThenText implements Provider {
  readonly name = "plan";
  readonly kind = "mock";
  readonly support = { embed: false, listModels: false, health: false, countTokens: true };
  calls = 0;
  stream(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    return this.chat(request);
  }
  async *chat(): AsyncGenerator<ProviderChunk, void, unknown> {
    this.calls += 1;
    yield { type: "text", text: this.calls === 1 ? JSON.stringify(PLAN) : "selesai" };
    yield { type: "usage", inputTokens: 4, outputTokens: 2 };
    yield { type: "done", finishReason: "stop" };
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "rann-ac-planrun-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  const session = createSession(db, { projectPath: dir, model: "plan-1", permissionMode: "trusted" });
  const turn = createTurn(db, { sessionId: session.id });
  return { db, dir, session, turn };
}

describe("acceptance plan execution", () => {
  it("AC-023 mode plan tidak mengeksekusi tool tulis sebelum disetujui", async () => {
    const { db, dir, session, turn } = setup();
    const result = await runTurn({
      db,
      session,
      turnId: turn.id,
      userText: "tambah rate limit",
      provider: new PlanThenText(),
      model: "plan-1",
      workspaceRoot: dir,
      config,
      planOnly: true,
      forcePlan: true
    });
    expect(result.plan?.id).toBeTruthy();
    const tools = db.prepare("SELECT COUNT(*) AS n FROM tool_calls WHERE turn_id = ?").get(turn.id) as { n: number };
    expect(tools.n).toBe(0);
  });

  it("AC-028 persetujuan sebagian hanya menjalankan task yang disetujui", async () => {
    const { db, dir, session, turn } = setup();
    await runTurn({
      db,
      session,
      turnId: turn.id,
      userText: "tambah rate limit",
      provider: new PlanThenText(),
      model: "plan-1",
      workspaceRoot: dir,
      config,
      forcePlan: true,
      approvePlan: async () => ({ approved: true, taskIds: ["t1"] })
    }).catch(() => undefined);
    const tasks = listTasks(db, session.id);
    expect(tasks.find((task) => task.title === "Satu")?.status).toBe("done");
    expect(tasks.find((task) => task.title === "Dua")?.status).toBe("paused");
    expect(tasks.find((task) => task.title === "Tiga")?.status).toBe("paused");
  });
});
