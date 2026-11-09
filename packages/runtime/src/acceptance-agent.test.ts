import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimJob, enqueueJob, openDatabase } from "@rann/storage";
import { detectRisk, normalizePlan, validatePlan } from "./planner.js";
import { applyFileTransaction } from "./code-tools.js";
import { executeTool, type ToolContext } from "./tools/index.js";
import { MemoryService } from "./memory.js";

const validPlan = {
  goal: "Tambah rate limit",
  assumptions: ["Redis tersedia"],
  criteria: [{ id: "c1", type: "test", command: "pnpm test", expect: "exit 0" }],
  tasks: [
    {
      id: "t1",
      title: "Petakan middleware",
      description: "Baca src/http.ts",
      agent: "coding",
      dependsOn: [],
      files: ["src/http.ts"],
      risk: "low",
      acceptance: "Daftar middleware"
    },
    {
      id: "t2",
      title: "Implementasi limiter",
      description: "Tambah limiter",
      agent: "coding",
      dependsOn: ["t1"],
      files: ["src/rate-limit.ts"],
      risk: "medium",
      acceptance: "Unit test lulus"
    }
  ],
  estimate: { minutes: [20, 45], costUsd: [0.05, 0.25] },
  risks: []
};

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "rann-ac-agent-"));
}

function ctx(root: string): ToolContext {
  return { workspaceRoot: root, workspaceOnly: true, permissionMode: "trusted", approved: false };
}

describe("acceptance agent dan planning", () => {
  it("AC-024 menolak task tanpa agen, file, atau acceptance", () => {
    const plan = normalizePlan(validPlan, "fallback")!;
    const broken = {
      ...plan,
      tasks: [{ ...plan.tasks[0]!, agent: "", files: [], acceptance: "" }]
    };
    const validation = validatePlan(broken);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toContain("tanpa agen");
    expect(validation.errors.join(" ")).toContain("tanpa file area");
    expect(validation.errors.join(" ")).toContain("tanpa acceptance");
  });

  it("AC-025 mengurutkan dependensi A -> B -> C", () => {
    const plan = normalizePlan(
      {
        ...validPlan,
        tasks: [
          { ...validPlan.tasks[0]!, id: "a", dependsOn: [] },
          { ...validPlan.tasks[1]!, id: "b", dependsOn: ["a"], files: ["src/b.ts"] },
          { ...validPlan.tasks[1]!, id: "c", dependsOn: ["b"], files: ["src/c.ts"] }
        ]
      },
      "fallback"
    )!;
    expect(validatePlan(plan).order).toEqual(["a", "b", "c"]);
  });

  it("AC-026 menandai migrasi database berisiko tinggi", () => {
    const risk = detectRisk("jalankan migrasi database lalu drop tabel lama");
    expect(risk.level).toBe("high");
  });

  it("AC-027 estimasi memakai rentang menit dan biaya", () => {
    const plan = normalizePlan(validPlan, "fallback")!;
    expect(plan.estimate.minutes).toEqual([20, 45]);
    expect(plan.estimate.costUsd).toEqual([0.05, 0.25]);
    expect(plan.estimate.source).toBe("heuristic");
  });

  it("AC-042 write_file menulis isi persis dan tidak menyentuh berkas lain", async () => {
    const root = workspace();
    writeFileSync(join(root, "lain.txt"), "jangan berubah");
    const result = await executeTool("fs_write", { path: "baru.txt", content: "isi persis\nbaris dua" }, ctx(root));
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, "baru.txt"), "utf8")).toBe("isi persis\nbaris dua");
    expect(readFileSync(join(root, "lain.txt"), "utf8")).toBe("jangan berubah");
  });

  it("AC-043 edit_file mengubah blok target dan hash sesuai", async () => {
    const root = workspace();
    const lines = Array.from({ length: 200 }, (_, index) => (index === 99 ? "function lama() { return 1; }" : `const baris${index} = ${index};`));
    writeFileSync(join(root, "mod.js"), lines.join("\n"));
    const result = await executeTool(
      "fs_edit",
      { path: "mod.js", old: "function lama() { return 1; }", new: "function baru() { return 2; }" },
      ctx(root)
    );
    const output = result.output as { sha256?: string };
    const content = readFileSync(join(root, "mod.js"), "utf8");
    expect(content).toContain("function baru() { return 2; }");
    expect(content).not.toContain("function lama()");
    expect(content.split("\n")[99]).toBe("function baru() { return 2; }");
    expect(output.sha256).toBe(createHash("sha256").update(content).digest("hex"));
  });

  it("AC-044 transaksi mengembalikan berkas pertama saat berkas kedua gagal", () => {
    const root = workspace();
    expect(() =>
      applyFileTransaction(root, [
        { path: "satu.txt", content: "satu" },
        { path: "dua.txt", content: "dua", expected_sha256: "0".repeat(64) }
      ])
    ).toThrow();
    expect(() => readFileSync(join(root, "satu.txt"), "utf8")).toThrow();
  });

  it("AC-063 memory kandidat menyimpan sumber pesan", () => {
    const root = workspace();
    const { db } = openDatabase({ path: join(root, "rann.db") });
    const service = new MemoryService(db, root, { enabled: true, promptChars: 2_000, retrieve: 10 });
    const result = service.rememberFromTurn("Aku selalu pakai pnpm.", "msg_123");
    expect(result.added.length).toBeGreaterThan(0);
    expect(result.added[0]?.source).toBe("msg_123");
  });

  it("AC-035 job berprioritas tinggi diklaim lebih dulu", () => {
    const root = workspace();
    const { db } = openDatabase({ path: join(root, "rann.db") });
    enqueueJob(db, { kind: "prompt", priority: 200, payload: { text: "rendah" } });
    const high = enqueueJob(db, { kind: "prompt", priority: 10, payload: { text: "tinggi" } });
    const claimed = claimJob(db, { queues: ["default"], workerId: "uji" });
    expect(claimed?.id).toBe(high.id);
  });
});
