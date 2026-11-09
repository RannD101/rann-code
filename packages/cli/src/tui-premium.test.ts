import { describe, expect, it } from "vitest";
import { colorDepth, displayWidth, setTheme, stripAnsi, ui } from "./ui.js";
import { renderHeader } from "./session-header.js";
import { renderStatus } from "./tui/status.js";
import { renderToolStart, renderToolEnd, renderEditPreview } from "./tui/tool-view.js";
import { renderPlan } from "./tui/plan-view.js";
import { renderAgents } from "./tui/agent-view.js";
import { renderApproval } from "./tui/approval-view.js";
import { highlightCode } from "./tui/syntax.js";
import { MarkdownStream, renderMarkdownLine } from "./markdown.js";
import { renderPalette } from "./tui/palette.js";
import { renderDiffText } from "./tui/diff-view.js";
import { resolveUiMode } from "./tui/modes.js";

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

describe("tampilan premium", () => {
  it("mendeteksi truecolor, 256, 16, dan none", () => {
    expect(withColor("truecolor", colorDepth)).toBe("truecolor");
    expect(withColor("256", colorDepth)).toBe("256");
    expect(withColor("16", colorDepth)).toBe("16");
    expect(withColor("none", colorDepth)).toBe("none");
    expect(withColor("none", () => ui.fg("teks"))).toBe("teks");
  });

  it("header menyesuaikan lebar dan tetap dalam batas terminal", () => {
    const wide = renderHeader({ cwd: "/proyek", branch: "main", session: "ses_1", model: "mock-1", provider: "9Router", permission: "ask", profile: "default" }, 100);
    expect(stripAnsi(wide.join("\n"))).toContain("Rann Code");
    expect(stripAnsi(wide.join("\n"))).toContain("PROVIDER");
    const narrow = renderHeader({ cwd: "/proyek", session: "ses_1", model: "mock-1", permission: "ask", profile: "default" }, 40);
    for (const line of narrow) expect(displayWidth(line)).toBeLessThanOrEqual(40);
  });

  it("status bar menyembunyikan informasi sekunder di terminal sempit", () => {
    const narrow = stripAnsi(renderStatus({ width: 40, model: "mock-1", contextPercent: 12, turnCost: 0.01, dayCost: 0.02 }));
    expect(narrow).toContain("% ctx");
    expect(narrow).not.toContain("turn $");
    const wide = stripAnsi(renderStatus({ width: 140, model: "mock-1", provider: "9Router", providerStatus: "ok", contextPercent: 12, inputTokens: 4, outputTokens: 6, totalTokens: 10, turnCost: 0.01, dayCost: 0.02, session: "ses_1", agents: 2 }));
    expect(wide).toContain("in 4 out 6");
    expect(wide).toContain("turn $0.0100");
    expect(wide).toContain("agen 2");
  });

  it("tool view mempertahankan prefix yang stabil dan status", () => {
    expect(stripAnsi(renderToolStart("fs_stat", { path: "package.json" }))).toMatch(/^\[tool\] fs_stat /);
    expect(stripAnsi(renderToolEnd({ tool: "fs_stat", state: "ok", durationMs: 1200 }))).toContain("[tool] fs_stat ✓");
    const preview = renderEditPreview({ path: "src/a.ts", added: 1, removed: 0, lines: ["+ const a = 1;"] });
    expect(stripAnsi(preview.join("\n"))).toContain("EDIT src/a.ts");
    expect(stripAnsi(preview.join("\n"))).toContain("+ const a = 1;");
  });

  it("plan, agent, dan approval punya status tekstual", () => {
    const plan = stripAnsi(renderPlan([{ title: "Baca repo", status: "done" }, { title: "Uji", status: "running" }]).join("\n"));
    expect(plan).toContain("[x] Baca repo");
    expect(plan).toContain("[>] Uji");
    const agents = stripAnsi(renderAgents([{ id: "agt_1", profile: "backend", status: "running", goal: "API" }]).join("\n"));
    expect(agents).toContain("backend");
    expect(agents).toContain("running");
    const approval = stripAnsi(renderApproval({ tool: "shell_run", args: { command: "npm test" }, risk: "medium" }).join("\n"));
    expect(approval).toContain("PERLU IZIN");
    expect(approval).toContain("DAMPAK");
    expect(approval).toContain("A/S/D/V");
    const wide = stripAnsi(renderApproval({ tool: "shell_run", args: { command: "npm test" }, risk: "medium", width: 110 }).join("\n"));
    expect(wide).toContain("A izinkan sekali");
    expect(wide).toContain("V detail");
  });

  it("syntax highlighting tidak mengubah teks asli", () => {
    withColor("truecolor", () => {
      const source = 'const x = 1; // komentar';
      expect(stripAnsi(highlightCode(source, "ts"))).toBe(source);
    });
  });

  it("tabel markdown dirapikan dan blok kode memakai highlighter", () => {
    const stream = new MarkdownStream();
    const table = stripAnsi(stream.push("| nama | nilai |\n|---|---|\n| a | 1 |\n") + stream.flush());
    expect(table).toContain("nama");
    expect(table).toContain("nilai");
    const code = stripAnsi(renderMarkdownLine("```ts", { inFence: false }));
    expect(code).toContain("╭─");
    const state = { inFence: true };
    expect(stripAnsi(renderMarkdownLine("const x = 1;", state))).toContain("const x = 1;");
  });

  it("palette menampilkan kategori, deskripsi, usage, dan navigasi", () => {
    const lines = stripAnsi(renderPalette({
      title: "Command palette",
      items: [{ value: "/model", description: "Ganti model", category: "model", usage: "/model <nama>" }],
      selected: 0,
      width: 100
    }).join("\n"));
    expect(lines).toContain("/model");
    expect(lines).toContain("Ganti model");
    expect(lines).toContain("usage /model <nama>");
    expect(lines).toContain("model");
    expect(lines).toContain("Esc tutup");
  });

  it("mode compact dan verbose mengubah kepadatan status", () => {
    expect(resolveUiMode("compact")).toBe("compact");
    expect(() => resolveUiMode("none")).toThrow();
    const compact = stripAnsi(renderStatus({ width: 140, mode: "compact", model: "mock-1", contextPercent: 10, turnCost: 1, dayCost: 2, session: "ses_1", agents: 1 }));
    expect(compact).not.toContain("turn $");
    const verbose = stripAnsi(renderStatus({ width: 80, mode: "verbose", model: "mock-1", contextPercent: 10, turnCost: 1, dayCost: 2, session: "ses_1", agents: 1 }));
    expect(verbose).toContain("turn $1.0000");
    expect(verbose).toContain("sesi ses_1");
  });

  it("diff mewarnai baris tanpa mengubah isi", () => {
    const source = "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;";
    expect(stripAnsi(renderDiffText(source))).toContain("-const a = 1;");
    expect(stripAnsi(renderDiffText(source))).toContain("+const a = 2;");
  });

  it("tema minimal tetap memakai teks tanpa warna", () => {
    setTheme("minimal");
    expect(ui.fg("kontras")).toContain("kontras");
    withColor("none", () => expect(ui.fg("kontras")).toBe("kontras"));
    setTheme("auto");
  });
});
