import { displayWidth, padWidth, truncateWidth, ui } from "./ui.js";
import { highlightCode, languageLabel } from "./tui/syntax.js";

interface MarkdownState {
  inFence: boolean;
  fenceLanguage?: string;
  table?: string[];
}

function inline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => `${ui.accent(label)} ${ui.dim(`(${url})`)}`)
    .replace(/`([^`]+)`/g, (_match, code: string) => ui.cyan(code))
    .replace(/\*\*([^*]+)\*\*/g, (_match, bold: string) => ui.bold(bold))
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, (_match, prefix: string, italic: string) => `${prefix}${ui.dim(italic)}`)
    .replace(/~~([^~]+)~~/g, (_match, struck: string) => ui.dim(struck));
}

function tableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderTable(rows: string[], width = process.stdout.columns ?? 80): string[] {
  if (rows.length === 0) return [];
  const cells = rows.map(tableRow);
  const separator = cells.findIndex((row) => row.every((cell) => /^:?-{2,}:?$/.test(cell)));
  const header = cells[0] ?? [];
  const body = cells.filter((_row, index) => index !== 0 && index !== separator);
  const columnCount = Math.max(...cells.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_value, column) =>
    Math.max(3, ...cells.map((row) => displayWidth(row[column] ?? "")))
  );
  const total = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, columnCount - 1) * 2;
  if (total > width) {
    const scale = Math.max(1, Math.floor((width - (columnCount - 1) * 2) / columnCount));
    for (let index = 0; index < widths.length; index += 1) widths[index] = Math.min(widths[index]!, scale);
  }
  const line = (row: string[], headerRow = false): string => {
    const content = row.map((cell, index) => padWidth(truncateWidth(cell, widths[index] ?? 3), widths[index] ?? 3)).join("  ");
    return headerRow ? ui.bold(content) : content;
  };
  const output = [line(header, true), ui.dim(widths.map((value) => "─".repeat(value)).join("  "))];
  for (const row of body) output.push(line(row));
  return output;
}

export function renderMarkdownLine(line: string, state: MarkdownState): string {
  if (/^\s*```/.test(line)) {
    if (state.inFence) {
      state.inFence = false;
      state.fenceLanguage = undefined;
      return ui.dim("╰─");
    }
    state.inFence = true;
    state.fenceLanguage = line.trim().slice(3).trim();
    return `${ui.dim("╭─")} ${ui.accent(languageLabel(state.fenceLanguage))}`;
  }
  if (state.inFence) {
    return `${ui.dim("│")} ${highlightCode(line, state.fenceLanguage ?? "")}`;
  }
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) {
    const level = heading[1]?.length ?? 1;
    const text = inline(heading[2] ?? "");
    return level === 1 ? `${ui.bold(ui.accent(text))}\n${ui.border("─".repeat(Math.max(8, displayWidth(text))))}` : level === 2 ? ui.bold(text) : ui.dim(text);
  }
  if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return ui.border("─".repeat(Math.min(40, process.stdout.columns ?? 40)));
  if (/^\s*>\s?/.test(line)) return `${ui.dim("│")} ${ui.dim(inline(line.replace(/^\s*>\s?/, "")))}`;
  if (/^\s*[-*+]\s+/.test(line)) return line.replace(/^(\s*)[-*+]\s+/, `$1${ui.accent("•")} `);
  if (/^\s*\d+[.)]\s+/.test(line)) return line.replace(/^(\s*)(\d+[.)])\s+/, (_match, space: string, number: string) => `${space}${ui.accent(number)} `);
  return inline(line);
}

function flushTable(state: MarkdownState): string {
  const rows = state.table;
  state.table = undefined;
  if (!rows || rows.length === 0) return "";
  return `${renderTable(rows).join("\n")}\n`;
}

export class MarkdownStream {
  private buffer = "";
  private readonly state: MarkdownState = { inFence: false };

  push(chunk: string): string {
    this.buffer += chunk;
    let output = "";
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) break;
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (!this.state.inFence && /^\s*\|.*\|\s*$/.test(line)) {
        this.state.table ??= [];
        this.state.table.push(line);
        continue;
      }
      if (this.state.table) output += flushTable(this.state);
      output += `${renderMarkdownLine(line, this.state)}\n`;
    }
    return output;
  }

  flush(): string {
    let output = this.state.table ? flushTable(this.state) : "";
    if (this.buffer.length === 0) return output;
    const line = this.buffer;
    this.buffer = "";
    output += `${renderMarkdownLine(line, this.state)}\n`;
    return output;
  }
}
