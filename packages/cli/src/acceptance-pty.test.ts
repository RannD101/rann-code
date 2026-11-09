import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const main = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

interface Pty {
  output: () => string;
  waitFor: (needle: string, timeoutMs?: number) => Promise<number>;
  write: (text: string) => void;
  exit: Promise<number | null>;
}

function startPty(options: { env?: Record<string, string>; cwd?: string } = {}): { pty: Pty; home: string } {
  const home = mkdtempSync(join(tmpdir(), "rann-pty-"));
  const child = spawn("script", ["-qec", `stty cols 120 rows 40; node ${main}`, "/dev/null"], {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...process.env, RANN_HOME: home, TERM: "xterm-256color", ...(options.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  const started = Date.now();
  const marks = new Map<string, number>();
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    for (const needle of ["Rann Code", "Command palette", "›"]) {
      if (!marks.has(needle) && output.includes(needle)) marks.set(needle, Date.now() - started);
    }
  });
  const exit = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
  cleanups.push(() => {
    child.kill("SIGKILL");
    const pidPath = join(home, "run", "daemon.pid");
    if (existsSync(pidPath)) {
      try {
        process.kill(Number(readFileSync(pidPath, "utf8").trim()), "SIGKILL");
      } catch {
        // daemon sudah berhenti
      }
    }
  });
  return {
    home,
    pty: {
      output: () => output,
      waitFor: async (needle, timeoutMs = 10_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (!marks.has(needle) && output.includes(needle)) marks.set(needle, Date.now() - started);
          if (marks.has(needle)) return marks.get(needle)!;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`tidak muncul: ${needle}`);
      },
      write: (text) => child.stdin.write(text),
      exit
    }
  };
}

describe("acceptance terminal", () => {
  it("AC-001 header tampil di bawah satu detik", async () => {
    const { pty } = startPty();
    const elapsed = await pty.waitFor("Rann Code", 5_000);
    expect(elapsed).toBeLessThan(1_000);
  }, 20_000);

  it("AC-003 Tab menampilkan kandidat /model dan /models tanpa eksekusi", async () => {
    const { pty } = startPty();
    await pty.waitFor("›", 10_000);
    for (const char of "/model") {
      pty.write(char);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    await pty.waitFor("/models", 2_000);
    pty.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const output = pty.output();
    expect(output).toContain("/model");
    expect(output).toContain("/models");
    expect(output).not.toContain("Balasan mock");
  }, 20_000);

  it("AC-002 palette muncul saat / ditekan", async () => {
    const { pty } = startPty();
    await pty.waitFor("›", 10_000);
    const before = Date.now();
    pty.write("/");
    await pty.waitFor("Command palette", 2_000);
    expect(Date.now() - before).toBeLessThan(500);
  }, 20_000);

  it("AC-020 command tidak dikenal memberi saran tanpa crash", async () => {
    const { pty } = startPty();
    await pty.waitFor("›", 10_000);
    pty.write("/tidakada\n");
    await pty.waitFor("E_UNKNOWN_COMMAND", 5_000);
    await pty.waitFor("mungkin:", 5_000);
    expect(pty.output()).toContain("/help");
  }, 20_000);

  it("AC-017 !menjalankan shell tanpa mengirim ke model", async () => {
    const { pty } = startPty();
    await pty.waitFor("›", 10_000);
    pty.write("!echo halo-shell\n");
    await pty.waitFor("halo-shell", 5_000);
    expect(pty.output()).not.toContain("Balasan mock");
  }, 20_000);

  it("AC-006 panah atas memunculkan prompt terakhir", async () => {
    const { pty } = startPty();
    await pty.waitFor("›", 10_000);
    pty.write("halo\n");
    await pty.waitFor("Balasan mock: halo", 10_000);
    pty.write("\u001b[A");
    await new Promise((resolve) => setTimeout(resolve, 200));
    pty.write("\n");
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if ((pty.output().match(/Balasan mock: halo/g) ?? []).length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect((pty.output().match(/Balasan mock: halo/g) ?? []).length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("AC-005 Shift+Enter menambah baris dan Ctrl+E memakai editor eksternal", async () => {
    const editorDir = mkdtempSync(join(tmpdir(), "rann-editor-"));
    const editor = join(editorDir, "editor.sh");
    writeFileSync(editor, '#!/bin/sh\nprintf "dari-editor" > "$1"\n', { mode: 0o755 });
    const { pty } = startPty({ env: { EDITOR: editor, VISUAL: editor } });
    await pty.waitFor("›", 10_000);
    pty.write("baris satu");
    pty.write("\u001b\r");
    pty.write("baris dua");
    pty.write("\n");
    await pty.waitFor("baris dua", 5_000);
    expect(pty.output()).toContain("baris satu");
    await pty.waitFor("›", 10_000);
    pty.write("\u0005");
    await pty.waitFor("dari-editor", 5_000);
    pty.write("\n");
    await pty.waitFor("dari-editor", 5_000);
  }, 30_000);

  it("AC-010 status bar menampilkan model, token, context, dan biaya", async () => {
    const { pty } = startPty();
    await pty.waitFor("›", 10_000);
    pty.write("halo\n");
    await pty.waitFor("Balasan mock: halo", 10_000);
    await pty.waitFor("tok", 5_000);
    await pty.waitFor("in 1 out 5", 5_000);
    await pty.waitFor("% ctx", 5_000);
    await pty.waitFor("turn $?", 5_000);
  }, 30_000);

  it("AC-018 /project menampilkan daftar dan berpindah project", async () => {
    const a = mkdtempSync(join(tmpdir(), "rann-proj-a-"));
    const b = mkdtempSync(join(tmpdir(), "rann-proj-b-"));
    const { pty } = startPty({ cwd: a });
    await pty.waitFor("›", 10_000);
    pty.write(`/project add ${b}\n`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    pty.write("/project\n");
    await pty.waitFor(b, 5_000);
    expect(pty.output()).toContain(a);
    pty.write(`/project switch ${b}\n`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((pty.output().match(new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
