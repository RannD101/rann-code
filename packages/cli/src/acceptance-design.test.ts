import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeTheme,
  chooseWith,
  contrastRatio,
  displayWidth,
  setTheme,
  stripAnsi
} from "./ui.js";
import { renderHeader } from "./session-header.js";
import { renderStatus } from "./tui/status.js";
import { renderToolStart, renderToolEnd, renderEditPreview, toolMark, type ToolState } from "./tui/tool-view.js";
import { renderPlan } from "./tui/plan-view.js";
import { renderAgents } from "./tui/agent-view.js";
import { renderApproval } from "./tui/approval-view.js";
import { renderPalette } from "./tui/palette.js";
import { renderDiffText } from "./tui/diff-view.js";
import { highlightCode } from "./tui/syntax.js";
import { resolveUiMode } from "./tui/modes.js";
import { MarkdownStream, renderMarkdownLine } from "./markdown.js";
import { matchReplCommands, nearestCommands, REPL_COMMANDS, isAvailable } from "./repl-commands.js";

const main = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function withColor<T>(value: string, fn: () => T): T {
  const previous = process.env.RANN_COLOR;
  process.env.RANN_COLOR = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.RANN_COLOR;
    else process.env.RANN_COLOR = previous;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Pty {
  output: () => string;
  waitFor: (needle: string, timeoutMs?: number) => Promise<number>;
  write: (text: string) => void;
}

function startPty(options: { env?: Record<string, string>; cwd?: string; cols?: number; rows?: number } = {}): Pty {
  const home = mkdtempSync(join(tmpdir(), "rann-design-"));
  const cols = options.cols ?? 120;
  const rows = options.rows ?? 40;
  const child = spawn("script", ["-qec", `stty cols ${cols} rows ${rows}; node ${main}`, "/dev/null"], {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...process.env, RANN_HOME: home, TERM: "xterm-256color", ...(options.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  cleanups.push(() => {
    child.kill("SIGKILL");
    stopDaemon(home);
  });
  return {
    output: () => output,
    waitFor: async (needle, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (output.includes(needle)) return Date.now();
        await sleep(20);
      }
      throw new Error(`tidak muncul: ${needle}\n${output.slice(-1200)}`);
    },
    write: (text) => child.stdin.write(text)
  };
}

function everyLineWithin(lines: string[], width: number): void {
  for (const line of lines) {
    expect(displayWidth(line), JSON.stringify(stripAnsi(line))).toBeLessThanOrEqual(width);
  }
}

function stopDaemon(home: string): void {
  const pidPath = join(home, "run", "daemon.pid");
  if (existsSync(pidPath)) {
    try {
      process.kill(Number(readFileSync(pidPath, "utf8").trim()), "SIGKILL");
    } catch {
      // daemon sudah berhenti
    }
  }
  // Satu sesi bisa meninggalkan lebih dari satu proses daemon. /proc dipakai
  // agar semua proses dengan RANN_HOME yang sama ikut berhenti.
  if (!existsSync("/proc")) return;
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const env = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0");
      if (env.includes(`RANN_HOME=${home}`)) process.kill(Number(pid), "SIGKILL");
    } catch {
      // proses sudah berhenti atau bukan milik pengguna ini
    }
  }
}

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectSources(path, out);
    else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("acceptance desain terminal", () => {
  it("kriteria 1 dan 13: header muat di 40 sampai 160 kolom", () => {
    for (const width of [40, 60, 80, 120, 160]) {
      const lines = renderHeader({
        cwd: "/proyek/aplikasi",
        branch: "main",
        session: "ses_01",
        model: "mock-1",
        provider: "9Router",
        permission: "ask",
        profile: "default"
      }, width);
      everyLineWithin(lines, width);
      const plain = stripAnsi(lines.join("\n"));
      expect(plain).toContain("Rann Code");
      expect(plain).toMatch(/WORKSPACE|DIR/);
    }
  });

  it("kriteria 12: status bar bertingkat dan tetap dalam lebar", () => {
    const input = {
      model: "mock-1",
      provider: "9Router",
      providerStatus: "ok",
      branch: "main",
      permission: "ask",
      session: "ses_01",
      project: "/proyek/aplikasi",
      contextPercent: 42,
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      turnCost: 0.012,
      dayCost: 0.34,
      agents: 2,
      task: "implementasi"
    };
    const narrow = stripAnsi(renderStatus({ ...input, width: 40 }));
    expect(narrow).toContain("42% ctx");
    expect(narrow).not.toContain("turn $");
    const wide = stripAnsi(renderStatus({ ...input, width: 160, mode: "verbose" }));
    for (const needle of ["mock-1", "9Router", "in 120 out 80", "turn $", "sesi ses_01", "agen 2", "/proyek/a"]) {
      expect(wide).toContain(needle);
    }
    const normal = stripAnsi(renderStatus({ ...input, width: 160 }));
    expect(normal).toContain("mock-1");
    expect(normal).toContain("42% ctx");
    expect(normal).toContain("turn $");
    expect(normal).not.toContain("sesi ses_01");
    expect(normal).not.toContain("/proyek/a");
    const fresh = stripAnsi(renderStatus({ width: 160, model: "mock-1", contextPercent: 0, branch: "main", permission: "ask" }));
    expect(fresh).not.toContain("turn $");
    expect(fresh).not.toContain("tok");
    everyLineWithin([renderStatus({ ...input, width: 40 }), renderStatus({ ...input, width: 160 })], 160);
  });

  it("kriteria 5, 7, 8, 9, 10, 11: semua panel muat di 40 kolom", () => {
    const tasks = [
      { title: "Analisis repositori dan struktur proyek", status: "done", agent: "architect" },
      { title: "Rancang arsitektur API", status: "done" },
      { title: "Implementasi autentikasi", status: "running", agent: "backend" },
      { title: "Tulis tes", status: "pending" },
      { title: "Verifikasi build", status: "pending" }
    ];
    const diff = [
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -1 +1 @@",
      "-export const auth = false;",
      "+export const auth = true;",
      "+export const ready = true;"
    ].join("\n");
    const samples: string[][] = [
      renderToolStart("fs_stat", { path: "package.json" }, 40).split("\n"),
      renderToolEnd({ tool: "fs_stat", state: "ok", durationMs: 1200, width: 40 }).split("\n"),
      renderEditPreview({ path: "src/auth.ts", added: 2, removed: 1, lines: ["+ const a = 1;", "- const a = 0;"] }, 40),
      renderPlan(tasks, 40),
      renderAgents([
        { name: "architect", status: "completed", task: "analisis" },
        { name: "backend", status: "running", task: "autentikasi" },
        { name: "frontend", status: "running", task: "halaman login" }
      ], 40),
      renderApproval({ tool: "shell_run", args: { command: "npm install express" }, risk: "high", width: 40 }),
      renderPalette({
        title: "Command palette",
        items: [{ value: "/model", description: "Ganti model aktif", category: "model", usage: "/model <nama>" }],
        selected: 0,
        width: 40
      }),
      renderDiffText(diff, 40).split("\n")
    ];
    for (const lines of samples) everyLineWithin(lines, 40);
  });

  it("kriteria 6: markdown lengkap, tabel, dan blok kode berlabel", () => {
    const state = { inFence: false };
    const body = [
      "# Judul",
      "**tebal** dan *miring* serta `kode`",
      "- satu",
      "> kutip",
      "[tautan](https://example.com)",
      "```ts",
      "const a = 1;",
      "```"
    ].map((line) => renderMarkdownLine(line, state)).join("\n");
    const plain = stripAnsi(body);
    for (const needle of ["Judul", "tebal", "miring", "kode", "• satu", "│ kutip", "tautan", "https://example.com", "ts", "const a = 1;"]) {
      expect(plain).toContain(needle);
    }
    expect(plain).not.toContain("**");
    const stream = new MarkdownStream();
    const table = stream.push("| Nama | Nilai |\n| --- | --- |\n| alpha | 1 |\n") + stream.flush();
    const tableText = stripAnsi(table);
    expect(tableText).toContain("Nama");
    expect(tableText).toContain("alpha");
    expect(tableText).toContain("─");
  });

  it("kriteria 5 dan 6: highlighter mempertahankan teks asli", () => {
    const line = 'const x = "halo"; // komentar';
    expect(withColor("none", () => highlightCode(line, "ts"))).toBe(line);
    expect(stripAnsi(withColor("truecolor", () => highlightCode(line, "ts")))).toBe(line);
    expect(withColor("truecolor", () => highlightCode(line, "ts"))).not.toBe(line);
  });

  it("kriteria 6: streaming tidak menghapus layar atau menggambar ulang", () => {
    withColor("none", () => {
      const stream = new MarkdownStream();
      expect(stream.push("halo **dun")).toBe("");
      const output = stream.push("ia**\n");
      expect(output).toContain("halo dunia");
      expect(output).not.toContain("\u001b[2J");
      expect(output).not.toContain("\u001b[H");
    });
  });

  it("kriteria 7: enam status tool punya penanda tekstual", () => {
    const states: ToolState[] = ["pending", "running", "ok", "failed", "cancelled", "approval"];
    for (const state of states) {
      const line = stripAnsi(renderToolEnd({ tool: "fs_read", state }));
      expect(line).toContain("fs_read");
      expect(line).toContain(toolMark(state));
    }
  });

  it("kriteria 8: plan menampilkan progres, status, agen, dan batas 20 baris", () => {
    const tasks = [
      { title: "Analisis", status: "done" },
      { title: "Rancang", status: "done" },
      { title: "Implementasi", status: "running", agent: "backend" },
      { title: "Tes", status: "pending" },
      { title: "Verifikasi", status: "pending" }
    ];
    const plain = stripAnsi(renderPlan(tasks, 80).join("\n"));
    expect(plain).toContain("2/5");
    expect(plain).toContain("[>]");
    expect(plain).toContain("@backend");
    const many = stripAnsi(renderPlan(Array.from({ length: 25 }, (_value, index) => ({ title: `langkah ${index}`, status: "pending" })), 80).join("\n"));
    expect(many).toContain("5 langkah lagi");
  });

  it("kriteria 9: aktivitas multi-agent punya status dan ringkasan", () => {
    const rows = [
      { name: "architect", status: "completed", task: "analisis" },
      { name: "backend", status: "running", task: "autentikasi" },
      { name: "tester", status: "waiting", task: "tes" },
      { name: "frontend", status: "failed", task: "halaman" }
    ];
    const plain = stripAnsi(renderAgents(rows, 100).join("\n"));
    for (const needle of ["architect", "completed", "running", "waiting", "failed"]) expect(plain).toContain(needle);
    const many = stripAnsi(renderAgents(Array.from({ length: 25 }, (_value, index) => ({ name: `agent${index}`, status: "running" })), 100).join("\n"));
    expect(many).toContain("5 agen lagi");
  });

  it("kriteria 10: diff menghitung tambah, hapus, dan tetap terbaca", () => {
    const diff = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n+const b = 3;";
    const plain = stripAnsi(renderDiffText(diff, 80));
    expect(plain).toContain("-const a = 1;");
    expect(plain).toContain("+const a = 2;");
    expect(plain).toContain("2 tambah  1 hapus");
  });

  it("kriteria 11: dialog izin menyebut risiko, dampak, dan V detail", () => {
    const plain = stripAnsi(renderApproval({
      tool: "shell_run",
      args: { command: "npm install express" },
      risk: "high",
      reason: "memasang dependency baru",
      width: 100
    }).join("\n"));
    expect(plain.toUpperCase()).toContain("PERLU IZIN");
    expect(plain).toContain("risiko tinggi");
    expect(plain).toContain("menjalankan perintah shell");
    expect(plain).toContain("V detail");
  });

  it("kriteria 2 dan 11: palette punya kategori, usage, dan navigasi", () => {
    const plain = stripAnsi(renderPalette({
      title: "Command palette",
      items: [
        { value: "/model", description: "Ganti model aktif", category: "model", usage: "/model <nama>" },
        { value: "/models", description: "Daftar model", category: "model" }
      ],
      selected: 0,
      width: 100
    }).join("\n"));
    for (const needle of ["Command palette", "/model", "Ganti model aktif", "usage /model <nama>", "model", "Esc tutup"]) {
      expect(plain).toContain(needle);
    }
  });

  it("kriteria 17: mode UI valid dan nilai asing ditolak", () => {
    expect(resolveUiMode(undefined)).toBe("interactive");
    expect(resolveUiMode("compact")).toBe("compact");
    expect(resolveUiMode("verbose")).toBe("verbose");
    expect(resolveUiMode("debug")).toBe("debug");
    expect(() => resolveUiMode("neon")).toThrow(/tidak dikenal/);
  });

  it("kriteria 16 dan 20: semua panel tetap terbaca tanpa warna dan tanpa emoji", () => {
    const sample = withColor("none", () => {
      const parts = [
        ...renderHeader({ cwd: "/proyek", session: "ses_1", model: "mock-1", permission: "ask", profile: "default" }, 80),
        renderStatus({ width: 80, model: "mock-1", contextPercent: 10, turnCost: 0.01, dayCost: 0.02, project: "/proyek" }),
        renderToolStart("fs_read", { path: "a.ts" }, 80),
        renderToolEnd({ tool: "fs_read", state: "ok", durationMs: 20, width: 80 }),
        ...renderPlan([{ title: "langkah", status: "running" }], 80),
        ...renderAgents([{ name: "backend", status: "running", task: "tes" }], 80),
        ...renderApproval({ tool: "shell_run", args: { command: "ls" }, width: 80 }),
        ...renderPalette({ title: "Palette", items: [{ value: "/help", description: "Bantuan" }], selected: 0, width: 80 }),
        renderDiffText("--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b", 80)
      ];
      return parts.join("\n");
    });
    expect(sample).not.toContain("\u001b[");
    expect(sample).toContain("Rann Code");
    expect(sample.toUpperCase()).toContain("PERLU IZIN");
    const emoji = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}]/u;
    expect(sample).not.toMatch(emoji);
  });

  it("kriteria 18: tema gelap, terang, dan minimal memenuhi kontras", () => {
    for (const name of ["dark", "light", "minimal"] as const) {
      setTheme(name);
      const { tokens, background } = activeTheme();
      expect(contrastRatio(tokens.foreground, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens.dim, background)).toBeGreaterThanOrEqual(3);
    }
    setTheme("auto");
  });

  it("kriteria 19: command yang ditampilkan punya deskripsi, usage, dan saran", () => {
    for (const command of REPL_COMMANDS) {
      expect(command.description.length).toBeGreaterThan(0);
      expect(command.usage.startsWith("/")).toBe(true);
      expect(command.category.length).toBeGreaterThan(0);
    }
    const hits = matchReplCommands("model").map((command) => command.name);
    expect(hits).toContain("model");
    expect(hits).toContain("models");
    expect(nearestCommands("modl").map((command) => command.name)).toContain("model");
    expect(REPL_COMMANDS.some((command) => isAvailable(command))).toBe(true);
  });

  it("kriteria 2 dan 3: slash membuka palette dan panah memilih command", async () => {
    const visible = REPL_COMMANDS.filter((command) => isAvailable(command))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const second = visible[1]!;
    const pty = startPty();
    await pty.waitFor("›", 10_000);
    pty.write("/");
    await pty.waitFor("Command palette", 2_000);
    const mark = pty.output().length;
    pty.write("\u001b[B");
    await sleep(250);
    const after = stripAnsi(pty.output().slice(mark));
    expect(after).toContain(`❯ /${second.name}`);
  }, 30_000);

  it("kriteria 11: V memanggil detail tanpa memutus pilihan", async () => {
    let calls = 0;
    const inspect = vi.fn();
    const answer = await chooseWith(
      async () => {
        calls += 1;
        return calls === 1 ? "v" : "d";
      },
      "Perlu izin",
      [{ key: "deny", shortcut: "D", label: "Tolak" }],
      "deny",
      inspect
    );
    expect(answer).toBe("deny");
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it("kriteria 15: mode non-interactive mengeluarkan teks polos", () => {
    const home = mkdtempSync(join(tmpdir(), "rann-design-run-"));
    cleanups.push(() => stopDaemon(home));
    const result = spawnSync(process.execPath, [main, "run", "halo"], {
      env: { ...process.env, RANN_HOME: home, RANN_COLOR: "none" },
      input: "",
      encoding: "utf8",
      timeout: 30_000
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Balasan mock: halo");
    expect(result.stdout).not.toContain("\u001b[");
  }, 40_000);

  it("kriteria 17: tidak ada emoji di seluruh sumber tampilan", () => {
    const root = fileURLToPath(new URL(".", import.meta.url));
    const files = collectSources(root);
    expect(files.length).toBeGreaterThan(20);
    const emoji = /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}]/u;
    for (const file of files) {
      expect(emoji.test(readFileSync(file, "utf8")), file).toBe(false);
    }
  });

  it("kriteria 19: command tidak tersedia menyebut alasan dan tetap bisa ditemukan", () => {
    const unavailable = REPL_COMMANDS.filter((command) => !isAvailable(command));
    expect(unavailable.length).toBeGreaterThan(0);
    for (const command of unavailable) {
      expect(command.unavailableReason?.length ?? 0).toBeGreaterThan(0);
    }
    const sample = unavailable[0]!;
    const plain = stripAnsi(renderPalette({
      title: "Command palette",
      items: [{
        value: `/${sample.name}`,
        description: `${sample.description} [tidak tersedia: ${sample.unavailableReason}]`
      }],
      selected: 0,
      width: 200
    }).join("\n"));
    expect(plain).toContain("tidak tersedia");
    expect(plain).toContain(sample.unavailableReason!);
  });

  it("kriteria 16: no-color tetap menampilkan identitas dan prompt", async () => {
    const pty = startPty({ env: { RANN_COLOR: "none" } });
    await pty.waitFor("Rann Code", 5_000);
    await pty.waitFor("›", 10_000);
    const output = pty.output();
    expect(output).not.toContain("\u001b[38;");
    expect(output).not.toContain("\u001b[48;");
    expect(stripAnsi(output).toUpperCase()).toContain("WORKSPACE");
  }, 30_000);
});
