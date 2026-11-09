import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendAudit, openDatabase, verifyAuditChain } from "@rann/storage";
import { detectMergeConflicts } from "./merge-queue.js";
import { evaluateOutcomes } from "./self-eval.js";

describe("acceptance operasional", () => {
  it("AC-117 merge queue mendeteksi path yang diubah dua agen", () => {
    const conflicts = detectMergeConflicts([
      { agent: "a", path: "src/app.ts", hash: "satu" },
      { agent: "b", path: "src/app.ts", hash: "dua" },
      { agent: "c", path: "src/lain.ts", hash: "tiga" }
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ path: "src/app.ts", agents: ["a", "b"] });
  });

  it("AC-144 hash chain audit utuh dan mendeteksi satu baris diubah", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-ac-audit-"));
    const { db } = openDatabase({ path: join(dir, "rann.db") });
    for (let index = 0; index < 100; index += 1) {
      appendAudit(db, { actor: "uji", action: "cek", resource: `r${index}`, decision: "ok", metadata: { index } });
    }
    expect(verifyAuditChain(db).ok).toBe(true);
    db.prepare("UPDATE audit_log SET metadata_json = '{\"index\":999}' WHERE resource = 'r50'").run();
    const broken = verifyAuditChain(db);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).toBeTruthy();
  });

  it("AC-151 evaluasi 20 hasil task melaporkan pola dan saran", () => {
    const outcomes = Array.from({ length: 20 }, (_, index) => ({
      title: `task ${index}`,
      status: (index % 4 === 0 ? "failed" : "done") as "failed" | "done",
      ...(index % 4 === 0 ? { errorCode: index % 8 === 0 ? "E_TIMEOUT" : "E_TOOL_FAILED" } : {}),
      skill: index % 3 === 0 ? "debug-sistematis" : undefined,
      skillSucceeded: index % 6 === 0
    }));
    const report = evaluateOutcomes(outcomes);
    expect(report.total).toBe(20);
    expect(report.failurePatterns.length).toBeGreaterThan(0);
    expect(report.skillEffectiveness.length).toBeGreaterThan(0);
    expect(report.suggestions.length).toBeGreaterThan(0);
  });
});
