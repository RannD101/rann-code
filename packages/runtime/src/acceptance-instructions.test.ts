import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadInstructions } from "./instructions.js";

describe("acceptance instruksi", () => {
  it("AC-076 prioritas RANN.md dan AGENTS.md serta konflik dicatat", () => {
    const root = mkdtempSync(join(tmpdir(), "rann-ac-instr-"));
    writeFileSync(join(root, "RANN.md"), "Selalu pakai pnpm.\n");
    writeFileSync(join(root, "AGENTS.md"), "Jangan pakai pnpm.\n");
    const bundle = loadInstructions(root);
    expect(bundle.files.length).toBeGreaterThanOrEqual(2);
    expect(bundle.conflicts.length).toBeGreaterThan(0);
    expect(bundle.text).toContain("prioritas");
  });
});
