import { ui } from "./ui.js";

interface MarkdownState {
  inFence: boolean;
}

function inline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => `${label} (${ui.dim(url)})`)
    .replace(/`([^`]+)`/g, (_match, code: string) => ui.cyan(code))
    .replace(/\*\*([^*]+)\*\*/g, (_match, bold: string) => ui.bold(bold));
}

export function renderMarkdownLine(line: string, state: MarkdownState): string {
  if (/^\s*```/.test(line)) {
    if (state.inFence) {
      state.inFence = false;
      return ui.dim("+--");
    }
    state.inFence = true;
    const language = line.trim().slice(3).trim();
    return ui.dim(`+-- ${language || "kode"}`);
  }
  if (state.inFence) return ui.dim(`| ${line}`);
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) return ui.bold(heading[2] ?? "");
  if (/^\s*>\s?/.test(line)) return ui.dim(`| ${line.replace(/^\s*>\s?/, "")}`);
  if (/^\s*[-*+]\s+/.test(line)) return line.replace(/^(\s*)[-*+]\s+/, "$1- ");
  return inline(line);
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
      output += `${renderMarkdownLine(line, this.state)}\n`;
    }
    return output;
  }

  flush(): string {
    if (this.buffer.length === 0) return "";
    const line = this.buffer;
    this.buffer = "";
    return `${renderMarkdownLine(line, this.state)}\n`;
  }
}
