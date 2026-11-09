import { describe, expect, it } from "vitest";
import { buildSharedContext } from "./subagent-context.js";

describe("konteks subagent", () => {
  it("AC-058 hanya membagikan goal, plan, dan ringkasan keputusan", () => {
    const text = buildSharedContext({
      goal: { text: "Perbaiki login", done: 1, total: 3 },
      plan: { goal: "Perbaiki login", version: 2, status: "active" },
      decisionSummary: "Pakai sesi JWT, bukan cookie."
    });
    expect(text).toContain("Goal induk: Perbaiki login");
    expect(text).toContain("1/3 selesai");
    expect(text).toContain("versi 2");
    expect(text).toContain("Pakai sesi JWT");
    expect(text).not.toContain("user:");
    expect(text).not.toContain("assistant:");
  });
});
