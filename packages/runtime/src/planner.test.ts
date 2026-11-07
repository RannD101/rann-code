import { describe, expect, it } from "vitest";
import { classifyTask, needsPlan, normalizePlan, validatePlan, planToMarkdown } from "./planner.js";

const validPlan = {
  goal: "Tambah rate limit",
  assumptions: ["Redis tersedia"],
  criteria: [
    { id: "c1", type: "test", command: "pnpm test", expect: "exit 0" },
    { id: "c2", type: "file", path: "src/rate-limit.ts", expect: "ada" }
  ],
  tasks: [
    {
      id: "t1",
      title: "Petakan middleware",
      description: "Baca src/http.ts dan catat urutan middleware",
      agent: "coding",
      dependsOn: [],
      files: ["src/http.ts"],
      risk: "low",
      acceptance: "Daftar middleware dan titik pasang"
    },
    {
      id: "t2",
      title: "Implementasi limiter",
      description: "Tambahkan limiter di src/rate-limit.ts dan sambungkan",
      agent: "coding",
      dependsOn: ["t1"],
      files: ["src/rate-limit.ts"],
      risk: "medium",
      acceptance: "Fungsi limiter dan unit test"
    }
  ],
  estimate: { minutes: [20, 45], costUsd: [0.05, 0.25] },
  risks: [{ taskId: "t2", level: "medium", reason: "Jalur request utama" }]
};

describe("planner", () => {
  it("mengklasifikasikan tugas berdasarkan sinyal", () => {
    expect(classifyTask("apa itu DAG?")).toBe("answer");
    expect(classifyTask("baca src/app.ts lalu jelaskan")).toBe("inspect");
    expect(classifyTask("tambahkan rate limit di endpoint chat")).toBe("modify");
    expect(classifyTask("deploy gateway ke server")).toBe("operate");
    expect(classifyTask("cari paper tentang rate limiting")).toBe("research");
    expect(classifyTask("kenapa produksi error dan crash?")).toBe("incident");
    expect(needsPlan("modify")).toBe(true);
    expect(needsPlan("answer")).toBe(false);
  });

  it("menormalkan dan memvalidasi rencana yang benar", () => {
    const plan = normalizePlan(validPlan, "fallback");
    expect(plan).toBeDefined();
    const validation = validatePlan(plan!);
    expect(validation.ok).toBe(true);
    expect(validation.order).toEqual(["t1", "t2"]);
    expect(validation.highRisk).toBe(false);
    expect(validation.fileCount).toBe(2);
    expect(planToMarkdown(plan!, validation)).toContain("t1 [low]");
  });

  it("menolak siklus dependensi dan task tanpa acceptance", () => {
    const plan = normalizePlan(
      {
        ...validPlan,
        tasks: [
          { ...validPlan.tasks[0], id: "a", dependsOn: ["b"] },
          { ...validPlan.tasks[1], id: "b", dependsOn: ["a"] },
          { ...validPlan.tasks[0], id: "c", acceptance: "", dependsOn: [] }
        ]
      },
      "fallback"
    )!;
    const validation = validatePlan(plan);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((error) => error.includes("siklus"))).toBe(true);
    expect(validation.errors.some((error) => error.includes("acceptance"))).toBe(true);
  });

  it("menandai rencana berisiko tinggi dan estimasi tunggal", () => {
    const plan = normalizePlan(
      {
        ...validPlan,
        tasks: [{ ...validPlan.tasks[0], risk: "high" }],
        estimate: { minutes: [10], costUsd: 1 }
      },
      "fallback"
    )!;
    const validation = validatePlan(plan);
    expect(validation.highRisk).toBe(true);
    expect(plan.estimate.minutes).toEqual([5, 15]);
  });
});
