import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generatePlan } from "./planner.js";
import type { ChatRequest, Provider, ProviderChunk } from "./providers/types.js";

const PLAN = {
  goal: "Tambah rate limit",
  assumptions: [],
  criteria: [{ id: "c1", type: "test", command: "pnpm test", expect: "exit 0" }],
  tasks: [
    { id: "t1", title: "Petakan", description: "Baca middleware", agent: "coding", dependsOn: [], files: ["src/a.ts"], risk: "low", acceptance: "daftar" },
    { id: "t2", title: "Implementasi", description: "Tulis limiter", agent: "coding", dependsOn: ["t1"], files: ["src/b.ts"], risk: "medium", acceptance: "tes" },
    { id: "t3", title: "Verifikasi", description: "Jalankan tes", agent: "tester", dependsOn: ["t2"], files: ["src/c.ts"], risk: "low", acceptance: "lulus" }
  ],
  estimate: { minutes: [10, 30], costUsd: [0.01, 0.05] },
  risks: []
};

class PlanProvider implements Provider {
  readonly name = "plan";
  readonly kind = "mock";
  readonly support = { embed: false, listModels: false, health: false, countTokens: true };
  stream(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    return this.chat(request);
  }
  async *chat(): AsyncGenerator<ProviderChunk, void, unknown> {
    yield { type: "text", text: JSON.stringify(PLAN) };
    yield { type: "usage", inputTokens: 5, outputTokens: 5 };
    yield { type: "done", finishReason: "stop" };
  }
}

describe("acceptance planner", () => {
  it("AC-022 planner menghasilkan minimal tiga task dengan dependensi valid", async () => {
    const root = mkdtempSync(join(tmpdir(), "rann-ac-plan-"));
    const { plan, validation } = await generatePlan(new PlanProvider(), "plan-1", "tambah rate limit", "modify", root);
    expect(plan.tasks.length).toBeGreaterThanOrEqual(3);
    expect(validation.ok).toBe(true);
    expect(validation.order).toEqual(["t1", "t2", "t3"]);
  });
});
