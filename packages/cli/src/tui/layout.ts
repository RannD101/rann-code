import { displayWidth, padWidth, truncateWidth, ui } from "../ui.js";

export type Breakpoint = "narrow" | "medium" | "wide" | "ultrawide";

export function terminalWidth(fallback = 80): number {
  return Math.max(20, process.stdout.columns ?? fallback);
}

export function breakpoint(width = terminalWidth()): Breakpoint {
  if (width < 60) return "narrow";
  if (width < 100) return "medium";
  if (width < 140) return "wide";
  return "ultrawide";
}

export function fit(text: string, width: number): string {
  return truncateWidth(text, Math.max(1, width));
}

export function columns(cells: string[], gap = 2, width = terminalWidth()): string {
  const visible = cells.filter((cell) => cell.length > 0);
  if (visible.length === 0) return "";
  const available = Math.max(1, width - gap * (visible.length - 1));
  const each = Math.floor(available / visible.length);
  return visible.map((cell) => padWidth(fit(cell, each), each)).join(" ".repeat(gap)).trimEnd();
}

export function labelValue(label: string, value: string, width = terminalWidth()): string {
  const left = ui.label(label);
  return `${left} ${fit(value, Math.max(1, width - displayWidth(left) - 1))}`;
}

export function section(title: string, lines: string[], width = terminalWidth()): string[] {
  return [ruleWithLabel(title, width), ...lines];
}

export function ruleWithLabel(label: string, width = terminalWidth()): string {
  const text = ` ${label.toUpperCase()} `;
  const left = Math.max(0, Math.floor((width - displayWidth(text)) / 2));
  const right = Math.max(0, width - left - displayWidth(text));
  return `${ui.border("─".repeat(left))}${ui.dim(text)}${ui.border("─".repeat(right))}`;
}

export function bullet(text: string, width = terminalWidth()): string {
  return `${ui.dim("│")} ${fit(text, width - 2)}`;
}
