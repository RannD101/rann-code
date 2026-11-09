import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeArchitecture } from "./architecture.js";

describe("analisis arsitektur", () => {
  it("AC-049 melaporkan siklus import dan pelanggaran lapisan", () => {
    const root = mkdtempSync(join(tmpdir(), "rann-arch-"));
    mkdirSync(join(root, "src", "domain"), { recursive: true });
    mkdirSync(join(root, "src", "infra"), { recursive: true });
    writeFileSync(join(root, "src", "domain", "a.ts"), 'import "./b";\nexport const a = 1;\n');
    writeFileSync(join(root, "src", "domain", "b.ts"), 'import "./a";\nexport const b = 1;\n');
    writeFileSync(join(root, "src", "domain", "c.ts"), 'import "../infra/db";\nexport const c = 1;\n');
    writeFileSync(join(root, "src", "infra", "db.ts"), "export const db = 1;\n");
    const report = analyzeArchitecture(root);
    expect(report.cycles.length).toBeGreaterThan(0);
    expect(report.cycles[0]).toEqual(expect.arrayContaining(["src/domain/a.ts", "src/domain/b.ts"]));
    expect(report.layerViolations[0]).toMatchObject({ from: "src/domain/c.ts", to: "src/infra/db.ts" });
  });
});
