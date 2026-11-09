import { padWidth, truncateWidth, ui } from "../ui.js";

export interface AgentRowView {
  id?: string;
  profile?: string;
  name?: string;
  status?: string;
  task?: string;
  goal?: string;
}

function tone(status: string): (text: string) => string {
  if (status === "done" || status === "completed" || status === "idle") return ui.green;
  if (status === "running" || status === "active") return ui.yellow;
  if (status === "failed" || status === "error") return ui.red;
  return ui.dim;
}

export function renderAgents(rows: AgentRowView[], width = process.stdout.columns ?? 80): string[] {
  if (rows.length === 0) return [ui.dim("belum ada subagent")];
  const idWidth = width >= 100 ? 16 : 0;
  const nameWidth = Math.max(12, Math.min(22, Math.floor(width * 0.2)));
  const statusWidth = 10;
  const taskWidth = Math.max(10, width - nameWidth - statusWidth - idWidth - 8);
  const lines = rows.slice(0, 20).map((row) => {
    const name = padWidth(truncateWidth(row.profile ?? row.name ?? "agent", nameWidth), nameWidth);
    const status = row.status ?? "unknown";
    const badge = padWidth(tone(status)(status), statusWidth);
    const task = truncateWidth(row.task ?? row.goal ?? "", taskWidth);
    const id = idWidth > 0 ? ui.dim(padWidth(row.id ?? "", idWidth)) : "";
    return `${ui.accent(name)} ${badge} ${id}${task}`;
  });
  if (rows.length > 20) lines.push(ui.dim(`  ${rows.length - 20} agen lagi`));
  return lines;
}

export function renderAgentEvent(input: { id: string; profile: string; status: string; steps?: number; cost?: number }): string {
  const badge = tone(input.status)(input.status);
  const steps = input.steps === undefined ? "" : ui.dim(` ${input.steps} langkah`);
  const cost = input.cost === undefined ? "" : ui.dim(` $${input.cost.toFixed(4)}`);
  return `${ui.dim("[agent]")} ${ui.accent(input.profile)} ${badge}${steps}${cost} ${ui.dim(input.id)}`;
}
