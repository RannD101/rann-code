import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const main = fileURLToPath(new URL("../dist/main.js", import.meta.url));

function run(args: string[], input?: string): { stdout: string; stderr: string; code: number | null } {
  const home = mkdtempSync(join(tmpdir(), "rann-ac-cli-"));
  const result = spawnSync(process.execPath, [main, ...args], {
    env: { ...process.env, RANN_HOME: home },
    input,
    encoding: "utf8",
    timeout: 30_000
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status };
}

describe("acceptance CLI non-interaktif", () => {
  it("AC-014 output JSON valid dengan text, usage, dan sessionId", () => {
    const out = run(["-p", "jelaskan repo", "--output-format", "json"]);
    expect(out.code).toBe(0);
    const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
    expect(typeof parsed.text).toBe("string");
    expect(parsed.usage).toBeTruthy();
    expect(String(parsed.sessionId)).toMatch(/^ses_/);
  }, 40_000);

  it("AC-015 stdin terbaca dan stdout bersih", () => {
    const out = run(["-p", "ringkas", "--output-format", "json"], "a\nb\n");
    expect(out.code).toBe(0);
    const parsed = JSON.parse(out.stdout) as { text: string };
    expect(parsed.text).toContain("a");
    expect(parsed.text).toContain("b");
    expect(out.stderr.trim()).toBe("");
  }, 40_000);
});
