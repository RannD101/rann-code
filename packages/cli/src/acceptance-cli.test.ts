import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { idleCtrlCStep } from "./line-editor.js";

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

  it("AC-016 NO_COLOR menghapus escape warna", () => {
    const home = mkdtempSync(join(tmpdir(), "rann-ac-cli-"));
    const result = spawnSync(process.execPath, [main, "--theme", "dark", "--help"], {
      env: { ...process.env, RANN_HOME: home, NO_COLOR: "1" },
      encoding: "utf8",
      timeout: 20_000
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("\u001b[");
  }, 30_000);

  it("AC-150 startup < 1 detik dan RSS < 150 MB, doctor melaporkan komponen", () => {
    const home = mkdtempSync(join(tmpdir(), "rann-ac-doctor-"));
    const time = spawnSync("/usr/bin/time", ["-f", "RSS=%M TIME=%e", process.execPath, main, "--version"], {
      env: { ...process.env, RANN_HOME: home },
      encoding: "utf8",
      timeout: 20_000
    });
    expect(time.status).toBe(0);
    const rss = Number(/RSS=(\d+)/.exec(time.stderr)?.[1] ?? "0");
    const elapsed = Number(/TIME=([\d.]+)/.exec(time.stderr)?.[1] ?? "0");
    expect(elapsed).toBeLessThan(1);
    expect(rss).toBeLessThan(150 * 1024);
    const doctor = spawnSync(process.execPath, [main, "doctor"], {
      env: { ...process.env, RANN_HOME: home },
      encoding: "utf8",
      timeout: 30_000
    });
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain("versi");
    expect(doctor.stdout).toContain("gateway");
  }, 40_000);

  it("AC-004 siklus Ctrl+C idle: 1 bersihkan, 2 peringatan, 3 keluar 130", () => {
    const first = idleCtrlCStep(0, 0, 1_000);
    const second = idleCtrlCStep(first.count, 1_000, 1_200);
    const third = idleCtrlCStep(second.count, 1_200, 1_400);
    expect(first).toEqual({ count: 1, exit: false });
    expect(second).toEqual({ count: 2, exit: false });
    expect(third).toEqual({ count: 3, exit: true });
    expect(idleCtrlCStep(2, 1_000, 3_000).count).toBe(1);
  });
});
