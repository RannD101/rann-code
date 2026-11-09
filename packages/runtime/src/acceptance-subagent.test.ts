import { describe, expect, it } from "vitest";
import { aggregateSubagentResults } from "./subagent-aggregate.js";
import { loadProfiles, pickProfile } from "./subagent-profiles.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("acceptance subagent", () => {
  it("AC-054 dua spesialisasi berbeda dipilih untuk tugas berbeda", () => {
    const profiles = loadProfiles(mkdtempSync(join(tmpdir(), "rann-prof-")), mkdtempSync(join(tmpdir(), "rann-proj-")));
    const frontend = pickProfile(profiles, undefined, "buat komponen UI halaman");
    const backend = pickProfile(profiles, undefined, "perbaiki query database dan migrasi");
    expect(frontend.name).not.toBe(backend.name);
  });

  it("AC-056 agregasi memuat status, bukti, biaya, dan konflik", () => {
    const summary = aggregateSubagentResults([
      { id: "a", profile: "coder", status: "done", evidence: "src/a.ts", costUsd: 0.1 },
      { id: "b", profile: "reviewer", status: "failed", costUsd: 0.05, conflicts: ["src/a.ts"] },
      { id: "c", profile: "tester", status: "done", evidence: "tes lulus", costUsd: 0.02 }
    ]);
    expect(summary).toMatchObject({ total: 3, done: 2, failed: 1, costUsd: 0.17 });
    expect(summary.evidence).toHaveLength(2);
    expect(summary.conflicts).toContain("src/a.ts");
  });
});
