import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookRunner, parseDecision } from "./hooks.js";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "rann-hooks-"));
}

describe("parseDecision", () => {
  it("menerima JSON allow, deny, dan modify", () => {
    expect(parseDecision('{"decision":"allow"}').decision).toBe("allow");
    expect(parseDecision('{"decision":"deny","reason":"berbahaya"}').reason).toBe("berbahaya");
    const modified = parseDecision('{"decision":"modify","modified":{"path":"a.txt"}}');
    expect(modified.decision).toBe("modify");
    expect(modified.modified).toEqual({ path: "a.txt" });
  });

  it("menganggap output kosong sebagai allow", () => {
    expect(parseDecision("").decision).toBe("allow");
  });
});

describe("HookRunner", () => {
  it("menjalankan command berurutan sesuai prioritas dan mengirim payload JSON", async () => {
    const root = workspace();
    const script = join(root, "hook.mjs");
    writeFileSync(
      script,
      `let data = ""; process.stdin.on("data", (c) => (data += c)); process.stdin.on("end", () => { const p = JSON.parse(data); if (p.tool === "fs_write") { console.log(JSON.stringify({ decision: "deny", reason: "dilarang" })); } else { console.log(JSON.stringify({ decision: "allow" })); } });`
    );
    const runner = new HookRunner(
      [
        { event: "PreToolUse", kind: "command", command: `${process.execPath} ${script}`, priority: 1 },
        { event: "PreToolUse", kind: "command", command: `${process.execPath} ${script}`, priority: 10 }
      ],
      { projectRoot: root }
    );
    const denied = await runner.run("PreToolUse", { tool: "fs_write" });
    expect(denied.allowed).toBe(false);
    expect(denied.outcomes).toHaveLength(1);
    const allowed = await runner.run("PreToolUse", { tool: "fs_read" });
    expect(allowed.allowed).toBe(true);
    expect(allowed.outcomes).toHaveLength(2);
  });

  it("meneruskan args hasil modify", async () => {
    const root = workspace();
    const script = join(root, "modify.mjs");
    writeFileSync(script, `console.log(JSON.stringify({ decision: "modify", modified: { path: "aman.txt" } }))`);
    const runner = new HookRunner([{ event: "PreToolUse", kind: "command", command: `${process.execPath} ${script}` }], { projectRoot: root });
    const result = await runner.run("PreToolUse", { tool: "fs_write" });
    expect(result.modified).toEqual({ path: "aman.txt" });
  });

  it("on_error warn tidak memblokir, block memblokir", async () => {
    const root = workspace();
    const warnRunner = new HookRunner([{ event: "Stop", kind: "command", command: `${process.execPath} -e "process.exit(3)"`, on_error: "warn" }], { projectRoot: root });
    expect((await warnRunner.run("Stop", {})).allowed).toBe(true);
    const blockRunner = new HookRunner([{ event: "Stop", kind: "command", command: `${process.execPath} -e "process.exit(3)"`, on_error: "block" }], { projectRoot: root });
    const blocked = await blockRunner.run("Stop", {});
    expect(blocked.allowed).toBe(false);
    expect(blocked.outcomes[0]?.error).toBeTruthy();
  });

  it("membunuh hook yang melewati timeout", async () => {
    const root = workspace();
    const runner = new HookRunner(
      [{ event: "Stop", kind: "command", command: `${process.execPath} -e "setTimeout(() => {}, 5000)"`, timeout_ms: 200, on_error: "block" }],
      { projectRoot: root }
    );
    const started = Date.now();
    const result = await runner.run("Stop", {});
    expect(result.allowed).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("dry-run tidak menjalankan efek samping", async () => {
    const root = workspace();
    const marker = join(root, "marker.txt");
    const runner = new HookRunner(
      [{ event: "Stop", kind: "command", command: `${process.execPath} -e "require('fs').writeFileSync('${marker.replace(/\\/g, "/")}','x')"` }],
      { projectRoot: root }
    );
    const result = await runner.run("Stop", {}, { dryRun: true });
    expect(result.outcomes[0]?.skipped).toBe(true);
    expect(() => readFileSync(marker)).toThrow();
  });

  it("memvalidasi event dan target yang tidak lengkap", () => {
    const runner = new HookRunner([{ event: "PreToolUse", kind: "command" }], { projectRoot: workspace() });
    const invalid = runner.validate();
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.errors.join(" ")).toContain("command kosong");
  });
});
