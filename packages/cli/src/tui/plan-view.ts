import { truncateWidth, ui } from "../ui.js";

export interface PlanTask {
  id?: string;
  title: string;
  status: string;
  agent?: string;
}

function mark(status: string): string {
  if (status === "done" || status === "completed") return ui.green("[x]");
  if (status === "running" || status === "in_progress") return ui.yellow("[>]");
  if (status === "failed" || status === "blocked") return ui.red("[!]");
  return ui.dim("[ ]");
}

export function renderPlan(tasks: PlanTask[], width = process.stdout.columns ?? 80): string[] {
  const done = tasks.filter((task) => task.status === "done" || task.status === "completed").length;
  const total = tasks.length;
  const ratio = total === 0 ? 0 : done / total;
  const barWidth = Math.max(8, Math.min(24, width - 28));
  const filled = Math.round(ratio * barWidth);
  const bar = `${ui.green("█".repeat(filled))}${ui.dim("░".repeat(barWidth - filled))}`;
  const lines = [`${ui.label("plan")} ${bar} ${done}/${total}`];
  for (const task of tasks.slice(0, 20)) {
    const agent = task.agent ? ui.dim(`  @${task.agent}`) : "";
    lines.push(`${mark(task.status)} ${truncateWidth(task.title, Math.max(10, width - 8))}${agent}`);
  }
  if (tasks.length > 20) lines.push(ui.dim(`  ${tasks.length - 20} langkah lagi`));
  return lines;
}

export function renderPlanEvent(input: { status: string; total?: number; reason?: string; version?: number }): string {
  const version = input.version && input.version > 1 ? ` v${input.version}` : "";
  const total = input.total ? ` ${input.total} langkah` : "";
  const reason = input.reason ? `: ${input.reason}` : "";
  return `${ui.label("plan")}${ui.dim(version)} ${ui.fg(input.status)}${ui.dim(total + reason)}`;
}
