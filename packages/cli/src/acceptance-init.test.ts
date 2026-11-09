import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const main = fileURLToPath(new URL("../dist/main.js", import.meta.url));

describe("acceptance init", () => {
  it("AC-052 membuat RANN.md dan .rann/config.json berisi", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-ac-init-"));
    const result = spawnSync(process.execPath, [main, "init"], {
      cwd: dir,
      env: { ...process.env, RANN_HOME: mkdtempSync(join(tmpdir(), "rann-init-home-")) },
      encoding: "utf8",
      timeout: 30_000
    });
    expect(result.status).toBe(0);
    const instructions = readFileSync(join(dir, "RANN.md"), "utf8");
    expect(instructions.length).toBeGreaterThan(100);
    expect(instructions).not.toContain("TODO");
    const config = JSON.parse(readFileSync(join(dir, ".rann", "config.json"), "utf8")) as Record<string, unknown>;
    expect(config.profile).toBe("default");
    expect(existsSync(join(dir, ".rann", "config.toml"))).toBe(true);
  }, 40_000);
});
