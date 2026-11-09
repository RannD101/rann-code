import { truncateWidth, ui } from "../ui.js";
import type { EditPreview } from "../edit-preview.js";

export type ToolState = "pending" | "running" | "ok" | "failed" | "cancelled" | "approval";

const MARKS: Record<ToolState, string> = {
  pending: "○",
  running: "●",
  ok: "✓",
  failed: "×",
  cancelled: "–",
  approval: "!"
};

export function toolMark(state: ToolState): string {
  return MARKS[state];
}

export function renderToolStart(tool: string, args: unknown, width = process.stdout.columns ?? 80): string {
  const brief = typeof args === "string" ? args : JSON.stringify(args ?? {});
  const detail = truncateWidth(brief, Math.max(8, width - tool.length - 20));
  return `${ui.dim(`[tool] ${tool}`)} ${ui.dim(detail)} ${ui.yellow(MARKS.running)}`;
}

export function renderToolEnd(input: {
  tool: string;
  state: ToolState;
  durationMs?: number;
  exitCode?: number | null;
  summary?: string;
  width?: number;
}): string {
  const width = input.width ?? process.stdout.columns ?? 80;
  const mark = MARKS[input.state];
  const label = input.state === "ok" ? ui.green(mark) : input.state === "failed" ? ui.red(mark) : ui.dim(mark);
  const timing = input.durationMs && input.durationMs > 0 ? ui.dim(` ${(input.durationMs / 1000).toFixed(1)}s`) : "";
  const exit = input.exitCode === undefined || input.exitCode === null ? "" : ui.dim(` exit ${input.exitCode}`);
  const summary = input.summary ? ui.dim(`  ${truncateWidth(input.summary, Math.max(8, width - input.tool.length - 28))}`) : "";
  return `${ui.dim(`[tool] ${input.tool}`)} ${label}${timing}${exit}${summary}`;
}

export function renderEditPreview(preview: EditPreview, width = process.stdout.columns ?? 80): string[] {
  const lines = [`${ui.label("edit")} ${ui.fg(preview.path)}  ${ui.green(`+${preview.added}`)} ${ui.red(`-${preview.removed}`)}`];
  for (const line of preview.lines) {
    const tone = line.startsWith("+") ? ui.green : line.startsWith("-") ? ui.red : ui.dim;
    lines.push(ui.dim("  ") + tone(truncateWidth(line, Math.max(10, width - 4))));
  }
  return lines;
}
