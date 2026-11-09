import { truncateWidth, ui } from "../ui.js";
import { formatApprovalArgs } from "../approval.js";
import { ruleWithLabel } from "./layout.js";

export interface ApprovalView {
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
  risk?: "low" | "medium" | "high";
  width?: number;
}

export function approvalImpact(tool: string, args: Record<string, unknown>): string {
  if (tool === "shell_run" && typeof args.command === "string") return `menjalankan perintah shell: ${args.command}`;
  if (tool === "fs_write" || tool === "write_file") return `membuat atau menimpa berkas ${String(args.path ?? "")}`;
  if (tool === "fs_edit" || tool === "edit_file") return `mengubah berkas ${String(args.path ?? "")}`;
  if (tool === "apply_patch") return `menerapkan patch ke ${Array.isArray(args.changes) ? args.changes.length : 0} berkas`;
  if (tool.startsWith("web_") || tool === "http_request") return `mengakses jaringan ${String(args.url ?? args.domain ?? "")}`;
  return `menjalankan tool ${tool}`;
}

export function renderApproval(view: ApprovalView): string[] {
  const width = view.width ?? process.stdout.columns ?? 80;
  const risk = view.risk ?? "medium";
  const riskLabel = risk === "high" ? ui.red("risiko tinggi") : risk === "low" ? ui.green("risiko rendah") : ui.yellow("risiko sedang");
  const lines = [ruleWithLabel("Perlu izin", width)];
  lines.push(`${ui.label("tool")} ${ui.accent(view.tool)}  ${riskLabel}`);
  lines.push(`${ui.label("dampak")} ${truncateWidth(approvalImpact(view.tool, view.args), Math.max(12, width - 8))}`);
  const args = formatApprovalArgs(view.args, 600);
  if (args.length > 0) lines.push(`${ui.label("args")} ${truncateWidth(args.replace(/\n/g, " "), Math.max(12, width - 7))}`);
  if (view.reason) lines.push(`${ui.label("alasan")} ${truncateWidth(view.reason, Math.max(12, width - 8))}`);
  const hint = width >= 100
    ? "A izinkan sekali  ·  S izinkan sesi ini  ·  D tolak  ·  V detail  ·  Esc tolak"
    : "A/S/D/V · Esc tolak";
  lines.push(ui.dim(hint));
  return lines;
}
