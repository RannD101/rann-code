import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const main = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const helper = fileURLToPath(new URL("./fixtures/pty_resize.py", import.meta.url));

describe("acceptance resize", () => {
  it("AC-013 terminal 40x20 di-resize ke 200x60 tetap utuh dan bisa keluar", () => {
    const home = mkdtempSync(join(tmpdir(), "rann-resize-"));
    const result = spawnSync("python3", [helper, main, home], { encoding: "utf8", timeout: 20_000 });
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout.trim()) as { first: boolean; resized: boolean; exit: number; output: string };
    expect(data.first).toBe(true);
    expect(data.resized).toBe(true);
    expect(data.output).not.toContain("E_");
  }, 30_000);
});
