import { truncateWidth, ui } from "../ui.js";
import { isCompact, isVerbose, type UiMode } from "./modes.js";

export interface StatusInput {
  width?: number;
  model: string;
  provider?: string;
  providerStatus?: string;
  branch?: string;
  permission?: string;
  session?: string;
  project?: string;
  contextPercent?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  turnCost?: number | null;
  dayCost?: number;
  agents?: number;
  task?: string;
  mode?: UiMode;
}

function cost(value: number | null | undefined): string {
  return value === undefined || value === null ? "?" : value.toFixed(4);
}

function contextTone(percent: number): (text: string) => string {
  if (percent >= 90) return ui.red;
  if (percent >= 75) return ui.yellow;
  if (percent >= 50) return ui.yellow;
  return ui.green;
}

/**
 * Status bar bertingkat: makin lebar, makin banyak konteks.
 * Tidak pernah mengandalkan warna saja; setiap segmen punya label teks.
 */
export function renderStatus(input: StatusInput): string {
  const width = Math.max(20, input.width ?? process.stdout.columns ?? 80);
  const compact = isCompact(input.mode ?? "interactive");
  const verbose = isVerbose(input.mode ?? "interactive");
  const parts: string[] = [ui.fg(input.model || "default")];
  if (input.contextPercent !== undefined && (verbose || (!compact && width >= 40))) {
    const percent = Math.max(0, Math.min(100, Math.round(input.contextPercent)));
    parts.push(contextTone(percent)(`${percent}% ctx`));
  }
  if ((verbose || (!compact && width >= 52)) && input.branch) parts.push(ui.dim(input.branch));
  if ((verbose || (!compact && width >= 60)) && input.permission) parts.push(ui.dim(input.permission));
  if ((verbose || (!compact && width >= 74)) && input.provider) {
    const health = input.providerStatus && input.providerStatus !== "unknown" ? `:${input.providerStatus}` : "";
    parts.push(ui.dim(`${input.provider}${health}`));
  }
  if ((verbose || (!compact && width >= 84)) && (input.inputTokens || input.outputTokens)) {
    parts.push(ui.dim(`in ${input.inputTokens ?? 0} out ${input.outputTokens ?? 0}`));
  }
  if ((verbose || (!compact && width >= 90)) && input.totalTokens) parts.push(ui.dim(`${(input.totalTokens / 1000).toFixed(1)}k tok`));
  if (verbose || (!compact && width >= 96)) parts.push(ui.dim(`turn $${cost(input.turnCost)}`));
  if (verbose || (!compact && width >= 104)) parts.push(ui.dim(`hari $${input.dayCost === undefined ? "?" : input.dayCost.toFixed(3)}`));
  if ((verbose || (!compact && width >= 112)) && input.session) parts.push(ui.dim(`sesi ${input.session}`));
  if ((verbose || (!compact && width >= 120)) && input.agents !== undefined) parts.push(ui.dim(`agen ${input.agents}`));
  if ((verbose || (!compact && width >= 126)) && input.task) parts.push(ui.dim(input.task));
  const text = parts.join(ui.dim("  │  "));
  return truncateWidth(text, Math.max(10, width - 4));
}

export function statusPrompt(input: StatusInput, show = true): string {
  const marker = ui.accent("› ");
  if (!show) return marker;
  const width = Math.max(20, input.width ?? process.stdout.columns ?? 80);
  if (width < 48) return marker;
  return `${marker}${renderStatus(input)} `;
}
