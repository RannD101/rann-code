import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { displayWidth, screenReaderMode } from "./ui.js";
import type { HistoryStore } from "./history.js";

export interface CompletionItem {
  value: string;
  description?: string;
}

export interface CompletionResult {
  start: number;
  items: CompletionItem[];
}

export type Completer = (line: string, cursor: number) => CompletionResult | Promise<CompletionResult>;

export interface PaletteItem {
  name: string;
  description: string;
  category?: string;
  usage?: string;
}

export type CtrlDChoice = "wait" | "cancel" | "background" | "exit";

export interface LineEditorOptions {
  history?: HistoryStore;
  completer?: Completer;
  palette?: PaletteItem[];
  busy?: () => boolean;
  onCancel?: () => Promise<boolean> | boolean;
  onExit?: (code: number) => void;
  onCtrlD?: (busy: boolean) => Promise<CtrlDChoice>;
  onExpand?: () => string | Promise<string | undefined>;
  prompt?: () => string;
}

export class ReplExit extends Error {
  constructor(readonly code: number) {
    super("repl-exit");
    this.name = "ReplExit";
  }
}

interface Overlay {
  kind: "completion" | "history" | "palette";
  title: string;
  items: Array<{ value: string; description?: string }>;
  selected: number;
  start?: number;
  query?: string;
}

const KEY_SEQUENCES: Array<{ sequence: string; action: string }> = [
  { sequence: "\u001b[200~", action: "paste-start" },
  { sequence: "\u001b[201~", action: "paste-end" },
  { sequence: "\u001b[13;2u", action: "newline" },
  { sequence: "\u001b[13;3u", action: "newline" },
  { sequence: "\u001b[27;2;13~", action: "newline" },
  { sequence: "\u001b\r", action: "newline" },
  { sequence: "\u001b[A", action: "up" },
  { sequence: "\u001b[B", action: "down" },
  { sequence: "\u001b[C", action: "right" },
  { sequence: "\u001b[D", action: "left" },
  { sequence: "\u001bOA", action: "up" },
  { sequence: "\u001bOB", action: "down" },
  { sequence: "\u001bOC", action: "right" },
  { sequence: "\u001bOD", action: "left" },
  { sequence: "\u001b[H", action: "home" },
  { sequence: "\u001b[F", action: "end" },
  { sequence: "\u001b[1~", action: "home" },
  { sequence: "\u001b[4~", action: "end" },
  { sequence: "\u001b[7~", action: "home" },
  { sequence: "\u001b[8~", action: "end" },
  { sequence: "\u001b[3~", action: "delete" },
  { sequence: "\u001b[Z", action: "backtab" },
  { sequence: "\u001b[1;5D", action: "word-left" },
  { sequence: "\u001b[1;5C", action: "word-right" },
  { sequence: "\u001b[1;3D", action: "word-left" },
  { sequence: "\u001b[1;3C", action: "word-right" },
  { sequence: "\u001b[5~", action: "none" },
  { sequence: "\u001b[6~", action: "none" }
];

const CONTROL_KEYS: Record<number, string> = {
  1: "home",
  3: "ctrl-c",
  4: "ctrl-d",
  5: "ctrl-e",
  11: "ctrl-k",
  12: "ctrl-l",
  15: "ctrl-o",
  18: "ctrl-r",
  21: "ctrl-u",
  23: "ctrl-w",
  25: "ctrl-y"
};

function commonPrefix(items: string[]): string {
  if (items.length === 0) return "";
  let prefix = items[0] ?? "";
  for (const item of items.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < item.length && prefix[index] === item[index]) index += 1;
    prefix = prefix.slice(0, index);
    if (prefix.length === 0) break;
  }
  return prefix;
}

function fuzzyScore(haystack: string, needle: string): number {
  if (needle.length === 0) return 1;
  const lower = haystack.toLowerCase();
  const target = needle.toLowerCase();
  if (lower.startsWith(target)) return 100;
  let index = 0;
  let gaps = 0;
  for (const char of lower) {
    if (char === target[index]) {
      index += 1;
      if (index === target.length) return 60 - gaps;
    } else if (index > 0) {
      gaps += 1;
    }
  }
  return -1;
}

export class LineEditor {
  private buffer = "";
  private cursor = 0;
  private promptText = "";
  private renderedRows = 0;
  private cursorRow = 0;
  private overlay?: Overlay;
  private historyIndex = -1;
  private ctrlCAt = 0;
  private ctrlCCount = 0;
  private pasting = false;
  private pending = "";
  private rawEnabled = false;
  private attached = false;
  private listening = false;
  private queuedInput = "";
  private closed = false;
  private fallback?: Awaited<ReturnType<typeof import("node:readline/promises").createInterface>>;
  private readonly onData = (chunk: Buffer | string): void => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (!this.listening) {
      this.queuedInput += text;
      return;
    }
    this.feed(text);
  };
  private readonly onResize = (): void => {
    if (!this.listening) return;
    this.clearRender();
    this.render();
  };

  constructor(private readonly options: LineEditorOptions = {}) {}

  private tty(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true && process.env.TERM !== "dumb" && !screenReaderMode();
  }

  private width(): number {
    return Math.max(20, process.stdout.columns ?? 80);
  }

  private promptValue(): string {
    if (this.options.prompt) return this.options.prompt();
    return `rann ${process.cwd()}> `;
  }

  async readLine(prompt?: string): Promise<string> {
    if (this.closed) throw new Error("editor sudah ditutup");
    if (!this.tty()) return this.fallbackReadLine(prompt);
    if (prompt !== undefined) this.promptText = prompt;
    if (this.promptText.length === 0) this.promptText = this.promptValue();
    this.buffer = "";
    this.cursor = 0;
    this.overlay = undefined;
    this.historyIndex = this.options.history?.all().length ?? 0;
    return new Promise<string>((resolve, reject) => {
      this.resolveRead = resolve;
      this.rejectRead = reject;
      this.start();
      this.render();
    });
  }

  private resolveRead?: (line: string) => void;
  private rejectRead?: (error: Error) => void;

  private finish(line: string): void {
    this.stopListening();
    this.clearRender();
    const resolve = this.resolveRead;
    this.resolveRead = undefined;
    this.rejectRead = undefined;
    resolve?.(line);
  }

  private start(): void {
    if (this.listening) return;
    this.listening = true;
    this.attach();
    if (this.queuedInput.length > 0) {
      const queued = this.queuedInput;
      this.queuedInput = "";
      this.feed(queued);
    }
  }

  private attach(): void {
    if (this.attached) return;
    if (!this.rawEnabled) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdout.write("\u001b[>1u");
      this.rawEnabled = true;
    }
    process.stdin.on("data", this.onData);
    process.stdout.on("resize", this.onResize);
    this.attached = true;
  }

  private detach(): void {
    if (!this.attached) return;
    process.stdin.off("data", this.onData);
    process.stdout.off("resize", this.onResize);
    if (this.rawEnabled) {
      process.stdout.write("\u001b[<u");
      process.stdin.setRawMode(false);
      this.rawEnabled = false;
    }
    this.attached = false;
  }

  private stopListening(): void {
    this.listening = false;
  }

  private async withPrompt<T>(action: () => Promise<T>): Promise<T> {
    const wasListening = this.listening;
    if (wasListening) {
      this.listening = false;
      this.detach();
    }
    this.clearRender();
    try {
      return await action();
    } finally {
      if (wasListening && !this.closed) {
        this.listening = true;
        this.attach();
        this.render();
      }
    }
  }

  private async fallbackReadLine(prompt?: string): Promise<string> {
    if (!this.fallback) {
      const { createInterface } = await import("node:readline/promises");
      this.fallback = createInterface({ input: process.stdin, output: process.stdout, historySize: 200 });
    }
    const text = await this.fallback.question(prompt ?? this.promptValue());
    this.options.history?.add(text);
    return text;
  }

  close(): void {
    this.closed = true;
    this.stopListening();
    this.fallback?.close();
    this.fallback = undefined;
  }

  private feed(chunk: string): void {
    this.pending += chunk;
    for (;;) {
      if (!this.listening) {
        this.queuedInput = this.pending + this.queuedInput;
        this.pending = "";
        return;
      }
      if (this.pending.length === 0) return;
      if (this.pasting) {
        const end = this.pending.indexOf("\u001b[201~");
        if (end === -1) {
          this.insert(this.pending);
          this.pending = "";
          return;
        }
        this.insert(this.pending.slice(0, end));
        this.pending = this.pending.slice(end + 6);
        this.pasting = false;
        this.render();
        continue;
      }
      if (this.pending.startsWith("\u001b[200~")) {
        this.pending = this.pending.slice(6);
        this.pasting = true;
        continue;
      }
      const matched = KEY_SEQUENCES.find((entry) => this.pending.startsWith(entry.sequence));
      if (matched) {
        this.pending = this.pending.slice(matched.sequence.length);
        this.handleAction(matched.action);
        continue;
      }
      if (this.pending.startsWith("\u001b")) {
        if (KEY_SEQUENCES.some((entry) => entry.sequence.startsWith(this.pending))) return;
        if (this.pending.length >= 2) {
          this.pending = this.pending.slice(1);
          this.cancelOverlay();
          continue;
        }
        return;
      }
      const code = this.pending.codePointAt(0);
      if (code === undefined) return;
      const char = String.fromCodePoint(code);
      this.pending = this.pending.slice(char.length);
      if (char === "\r" || char === "\n") {
        void this.submit();
        return;
      }
      if (char === "\t") {
        void this.complete();
        continue;
      }
      if (char === "\u007f" || char === "\b") {
        if (this.overlay?.kind === "history" || this.overlay?.kind === "palette") {
          this.overlay.query = (this.overlay.query ?? "").slice(0, -1);
          this.refreshOverlay();
          this.render();
          continue;
        }
        this.backspace();
        continue;
      }
      if (code < 32) {
        const action = CONTROL_KEYS[code];
        if (action) this.handleAction(action);
        continue;
      }
      if (this.overlay?.kind === "history" || this.overlay?.kind === "palette") {
        this.overlay.query = `${this.overlay.query ?? ""}${char}`;
        this.refreshOverlay();
        this.render();
        continue;
      }
      this.insert(char);
    }
  }

  private handleAction(action: string): void {
    switch (action) {
      case "left":
        this.overlay = undefined;
        this.moveCursor(-1);
        return;
      case "right":
        this.overlay = undefined;
        this.moveCursor(1);
        return;
      case "word-left":
        this.overlay = undefined;
        this.moveWord(-1);
        return;
      case "word-right":
        this.overlay = undefined;
        this.moveWord(1);
        return;
      case "home":
        this.overlay = undefined;
        this.cursor = this.lineStart();
        this.render();
        return;
      case "end": {
        this.overlay = undefined;
        const next = this.buffer.indexOf("\n", this.cursor);
        this.cursor = next === -1 ? this.buffer.length : next;
        this.render();
        return;
      }
      case "delete":
        this.deleteForward();
        return;
      case "up":
        if (this.overlay) this.moveOverlay(-1);
        else this.navigateHistory(-1);
        return;
      case "down":
        if (this.overlay) this.moveOverlay(1);
        else this.navigateHistory(1);
        return;
      case "newline":
        this.overlay = undefined;
        this.insert("\n");
        return;
      case "backtab":
        void this.complete(true);
        return;
      case "ctrl-c":
        void this.handleCtrlC();
        return;
      case "ctrl-d":
        void this.handleCtrlD();
        return;
      case "ctrl-e":
        void this.openEditor();
        return;
      case "ctrl-k":
        this.openPalette();
        return;
      case "ctrl-l":
        process.stdout.write("\u001b[2J\u001b[H");
        this.renderedRows = 0;
        this.cursorRow = 0;
        this.render();
        return;
      case "ctrl-o":
        void this.expandOutput();
        return;
      case "ctrl-r":
        this.openHistorySearch();
        return;
      case "ctrl-u": {
        this.overlay = undefined;
        const start = this.lineStart();
        this.buffer = `${this.buffer.slice(0, start)}${this.buffer.slice(this.cursor)}`;
        this.cursor = start;
        this.render();
        return;
      }
      case "ctrl-w":
        this.killWord();
        return;
      case "ctrl-y":
        return;
      default:
        return;
    }
  }

  private lineStart(): number {
    const index = this.buffer.lastIndexOf("\n", this.cursor - 1);
    return index + 1;
  }

  private moveCursor(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.buffer.length, this.cursor + delta));
    this.render();
  }

  private moveWord(direction: -1 | 1): void {
    if (direction === -1) {
      let index = this.cursor;
      while (index > 0 && /\s/.test(this.buffer[index - 1] ?? "")) index -= 1;
      while (index > 0 && !/\s/.test(this.buffer[index - 1] ?? "")) index -= 1;
      this.cursor = index;
    } else {
      let index = this.cursor;
      while (index < this.buffer.length && !/\s/.test(this.buffer[index] ?? "")) index += 1;
      while (index < this.buffer.length && /\s/.test(this.buffer[index] ?? "")) index += 1;
      this.cursor = index;
    }
    this.render();
  }

  private killWord(): void {
    const start = this.cursor;
    this.moveWord(-1);
    const end = this.cursor;
    this.buffer = `${this.buffer.slice(0, end)}${this.buffer.slice(start)}`;
    this.cursor = end;
    this.render();
  }

  private insert(text: string): void {
    this.overlay = undefined;
    this.buffer = `${this.buffer.slice(0, this.cursor)}${text}${this.buffer.slice(this.cursor)}`;
    this.cursor += text.length;
    this.render();
  }

  private backspace(): void {
    this.overlay = undefined;
    if (this.cursor === 0) return;
    this.buffer = `${this.buffer.slice(0, this.cursor - 1)}${this.buffer.slice(this.cursor)}`;
    this.cursor -= 1;
    this.render();
  }

  private deleteForward(): void {
    this.overlay = undefined;
    if (this.cursor >= this.buffer.length) return;
    this.buffer = `${this.buffer.slice(0, this.cursor)}${this.buffer.slice(this.cursor + 1)}`;
    this.render();
  }

  private async submit(): Promise<void> {
    if (this.overlay) {
      this.acceptOverlay();
      return;
    }
    const line = this.buffer;
    if (line.trim().length > 0) this.options.history?.add(line);
    this.finish(line);
  }

  private async handleCtrlC(): Promise<void> {
    const now = Date.now();
    if (now - this.ctrlCAt > 1_500) this.ctrlCCount = 0;
    this.ctrlCAt = now;
    if (this.overlay) {
      this.overlay = undefined;
      this.render();
      return;
    }
    if (this.buffer.length > 0) {
      this.buffer = "";
      this.cursor = 0;
      this.ctrlCCount = 1;
      this.render();
      return;
    }
    this.ctrlCCount += 1;
    if (this.ctrlCCount === 1) {
      process.stdout.write("\nTekan Ctrl+C lagi untuk membatalkan turn, tiga kali untuk keluar.\n");
      this.render();
      return;
    }
    if (this.ctrlCCount === 2) {
      const busy = this.options.busy?.() ?? false;
      if (busy && this.options.onCancel) {
        await this.withPrompt(async () => {
          const handled = await this.options.onCancel?.();
          if (handled) process.stdout.write("Turn dibatalkan.\n");
          else process.stdout.write("Tidak ada turn aktif.\n");
        });
      } else {
        process.stdout.write("Tidak ada turn aktif. Tekan Ctrl+C sekali lagi untuk keluar.\n");
      }
      this.render();
      return;
    }
    this.exit(130);
  }

  private async handleCtrlD(): Promise<void> {
    if (this.buffer.length > 0) {
      this.deleteForward();
      return;
    }
    if (!this.options.onCtrlD) {
      this.exit(130);
      return;
    }
    const choice = await this.withPrompt(() => this.options.onCtrlD!(this.options.busy?.() ?? false));
    if (choice === "exit") {
      this.exit(130);
      return;
    }
    if (choice === "cancel") {
      await this.withPrompt(async () => {
        await this.options.onCancel?.();
      });
    }
    this.render();
  }

  private exit(code: number): void {
    this.options.onExit?.(code);
    this.stopListening();
    this.clearRender();
    const reject = this.rejectRead;
    this.resolveRead = undefined;
    this.rejectRead = undefined;
    reject?.(new ReplExit(code));
  }

  private openHistorySearch(): void {
    const entries = this.options.history?.all() ?? [];
    if (entries.length === 0) {
      process.stdout.write("\nRiwayat masih kosong.\n");
      this.render();
      return;
    }
    this.overlay = {
      kind: "history",
      title: "Cari riwayat (Ctrl+R, Esc batal)",
      items: this.historyOverlayItems(""),
      selected: 0,
      query: ""
    };
    this.render();
  }

  private refreshOverlay(): void {
    const overlay = this.overlay;
    if (!overlay || overlay.kind === "completion") return;
    if (overlay.kind === "history") {
      overlay.items = this.historyOverlayItems(overlay.query ?? "");
    } else {
      overlay.items = this.paletteItems(overlay.query ?? "");
    }
    overlay.selected = Math.min(overlay.selected, Math.max(0, overlay.items.length - 1));
  }

  private historyOverlayItems(query: string): Array<{ value: string; description?: string }> {
    const entries = this.options.history?.all() ?? [];
    return entries
      .slice()
      .reverse()
      .filter((entry) => fuzzyScore(entry.text, query) >= 0)
      .slice(0, 12)
      .map((entry) => ({ value: entry.text, description: new Date(entry.at).toLocaleString() }));
  }

  private openPalette(): void {
    const palette = this.options.palette ?? [];
    if (palette.length === 0) {
      process.stdout.write("\nPalette command belum tersedia.\n");
      this.render();
      return;
    }
    this.overlay = {
      kind: "palette",
      title: "Command palette (Ctrl+K, Esc batal)",
      items: this.paletteItems(""),
      selected: 0,
      query: ""
    };
    this.render();
  }

  private paletteItems(query: string): Array<{ value: string; description?: string }> {
    const palette = this.options.palette ?? [];
    return palette
      .map((item) => ({ item, score: fuzzyScore(`${item.name} ${item.description} ${item.category ?? ""}`, query) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
      .slice(0, 12)
      .map((entry) => ({ value: `/${entry.item.name}`, description: entry.item.description }));
  }

  private navigateHistory(delta: -1 | 1): void {
    const entries = this.options.history?.all() ?? [];
    if (entries.length === 0) return;
    if (this.historyIndex >= entries.length) this.historyIndex = entries.length;
    const next = Math.max(0, Math.min(entries.length, this.historyIndex + delta));
    if (next === this.historyIndex) return;
    this.historyIndex = next;
    this.overlay = undefined;
    if (next === entries.length) {
      this.buffer = "";
    } else {
      this.buffer = entries[next]?.text ?? "";
    }
    this.cursor = this.buffer.length;
    this.render();
  }

  private moveOverlay(delta: number): void {
    if (!this.overlay) return;
    const size = this.overlay.items.length;
    if (size === 0) return;
    this.overlay.selected = (this.overlay.selected + delta + size) % size;
    this.render();
  }

  private acceptOverlay(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    const item = overlay.items[overlay.selected];
    this.overlay = undefined;
    if (!item) {
      this.render();
      return;
    }
    if (overlay.kind === "completion" && overlay.start !== undefined) {
      this.buffer = `${this.buffer.slice(0, overlay.start)}${item.value}`;
      this.cursor = this.buffer.length;
    } else {
      this.buffer = item.value;
      this.cursor = this.buffer.length;
    }
    this.render();
  }

  private cancelOverlay(): void {
    if (!this.overlay) return;
    this.overlay = undefined;
    this.render();
  }

  private async complete(reverse = false): Promise<void> {
    if (this.overlay?.kind === "completion" && this.overlay.items.length > 0) {
      this.overlay.selected = (this.overlay.selected + (reverse ? -1 : 1) + this.overlay.items.length) % this.overlay.items.length;
      this.render();
      return;
    }
    if (!this.options.completer) return;
    const result = await this.options.completer(this.buffer, this.cursor);
    if (result.items.length === 0) {
      this.render();
      return;
    }
    const values = result.items.map((item) => item.value);
    if (values.length === 1) {
      this.buffer = `${this.buffer.slice(0, result.start)}${values[0] ?? ""}`;
      this.cursor = this.buffer.length;
      this.render();
      return;
    }
    const prefix = commonPrefix(values);
    const current = this.buffer.slice(result.start, this.cursor);
    if (prefix.length > current.length) {
      this.buffer = `${this.buffer.slice(0, result.start)}${prefix}`;
      this.cursor = this.buffer.length;
    }
    this.overlay = {
      kind: "completion",
      title: "Saran (Tab untuk pilih)",
      items: result.items.slice(0, 12),
      selected: 0,
      start: result.start
    };
    this.render();
  }

  private async openEditor(): Promise<void> {
    const editor = process.env.RANN_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR ?? (process.platform === "win32" ? "notepad" : "vi");
    const original = this.buffer;
    await this.withPrompt(async () => {
      const directory = mkdtempSync(join(tmpdir(), "rann-editor-"));
      const file = join(directory, "prompt.md");
      try {
        writeFileSync(file, original, { mode: 0o600 });
        const result = spawnSync(editor, [file], { stdio: "inherit", shell: process.platform === "win32" });
        if (result.status !== 0) {
          process.stdout.write(`Editor keluar dengan status ${result.status ?? "tidak diketahui"}, perubahan dibatalkan.\n`);
          return;
        }
        this.buffer = readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");
        this.cursor = this.buffer.length;
      } catch (error) {
        process.stdout.write(`Editor gagal dijalankan: ${error instanceof Error ? error.message : String(error)}\n`);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
    this.render();
  }

  private async expandOutput(): Promise<void> {
    this.clearRender();
    const text = await this.options.onExpand?.();
    process.stdout.write(`${text ?? "Tidak ada output yang bisa diperluas."}\n`);
    this.render();
  }

  private overlayLines(): string[] {
    const overlay = this.overlay;
    if (!overlay) return [];
    const lines = [overlay.title];
    const visible = 8;
    const start = Math.max(0, Math.min(overlay.selected - Math.floor(visible / 2), overlay.items.length - visible));
    const slice = overlay.items.slice(start, start + visible);
    slice.forEach((item, offset) => {
      const index = start + offset;
      const marker = index === overlay.selected ? "> " : "  ";
      const description = item.description ? `  ${item.description}` : "";
      lines.push(`${marker}${item.value}${description}`);
    });
    if (overlay.items.length > visible) lines.push(`  ${start + 1}-${Math.min(start + visible, overlay.items.length)} dari ${overlay.items.length}`);
    return lines;
  }

  private render(): void {
    if (!this.listening) return;
    const width = this.width();
    const overlay = this.overlayLines();
    const prompt = this.promptText.length > 0 ? this.promptText : this.promptValue();
    const beforeCursor = this.buffer.slice(0, this.cursor);
    const lines = this.buffer.split("\n");
    const beforeLines = beforeCursor.split("\n");
    const cursorLineIndex = beforeLines.length - 1;
    let rows = 0;
    const output: string[] = [];
    for (const line of overlay) {
      output.push(line);
      rows += Math.max(1, Math.ceil(Math.max(1, displayWidth(line)) / width));
    }
    const overlayRows = rows;
    const rendered: string[] = [];
    lines.forEach((line, index) => {
      const prefix = index === 0 ? prompt : "  ";
      rendered.push(`${prefix}${line}`);
    });
    rows += rendered.reduce((total, line) => total + Math.max(1, Math.ceil(Math.max(1, displayWidth(line)) / width)), 0);
    const promptWidth = displayWidth(prompt);
    const prefixFor = (index: number): number => (index === 0 ? promptWidth : 2);
    const lineRows = (index: number): number => {
      const content = lines[index] ?? "";
      return Math.max(1, Math.ceil(Math.max(1, prefixFor(index) + displayWidth(content)) / width));
    };
    let cursorRow = overlayRows;
    for (let index = 0; index < cursorLineIndex; index += 1) cursorRow += lineRows(index);
    const currentLineText = beforeLines[cursorLineIndex] ?? "";
    const cursorAbsolute = prefixFor(cursorLineIndex) + displayWidth(currentLineText);
    cursorRow += Math.floor(cursorAbsolute / width);
    const cursorColumnFinal = cursorAbsolute % width;

    if (this.renderedRows > 0) {
      const up = Math.min(this.renderedRows, this.cursorRow);
      if (up > 0) process.stdout.write(`\u001b[${up}A`);
      process.stdout.write("\r\u001b[0J");
    }
    process.stdout.write(`${output.concat(rendered).join("\n")}`);
    const total = rows;
    const down = Math.max(0, total - 1 - cursorRow);
    if (down > 0) process.stdout.write(`\u001b[${down}A`);
    process.stdout.write("\r");
    if (cursorColumnFinal > 0) process.stdout.write(`\u001b[${cursorColumnFinal}C`);
    this.renderedRows = total;
    this.cursorRow = cursorRow;
  }

  private clearRender(): void {
    if (this.renderedRows === 0) return;
    const up = Math.min(this.renderedRows, this.cursorRow);
    if (up > 0) process.stdout.write(`\u001b[${up}A`);
    process.stdout.write("\r\u001b[0J");
    this.renderedRows = 0;
    this.cursorRow = 0;
  }
}

export function completionForPalette(items: PaletteItem[]): Array<{ value: string; description?: string }> {
  return items.map((item) => ({ value: `/${item.name}`, description: item.description }));
}
