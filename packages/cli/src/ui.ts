import { existsSync, readFileSync } from "node:fs";

export type ThemeName = "dark" | "light" | "auto" | "custom";

export interface ThemeTokens {
  foreground: string;
  dim: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  border: string;
}

const THEMES: Record<"dark" | "light", ThemeTokens> = {
  dark: {
    foreground: "#e6e6e6",
    dim: "#9aa0a6",
    accent: "#7cc7ff",
    success: "#6ddc8a",
    warning: "#f2c14e",
    danger: "#ff7b72",
    border: "#5f6368"
  },
  light: {
    foreground: "#1f2328",
    dim: "#57606a",
    accent: "#0550ae",
    success: "#1a7f37",
    warning: "#9a6700",
    danger: "#cf222e",
    border: "#8c959f"
  }
};

let themeName: ThemeName = (process.env.RANN_THEME as ThemeName | undefined) ?? "auto";
let customTokens: Partial<ThemeTokens> = {};

export function colorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined || process.env.RANN_NO_COLOR === "1") return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") return true;
  return process.stdout.isTTY === true && process.env.TERM !== "dumb";
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [Number.parseInt(clean.slice(0, 2), 16), Number.parseInt(clean.slice(2, 4), 16), Number.parseInt(clean.slice(4, 6), 16)];
}

function luminance(hex: string): number {
  const channels = parseHex(hex).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function activeTheme(): { name: ThemeName; tokens: ThemeTokens; background: string } {
  const resolved: "dark" | "light" = themeName === "auto" ? (process.env.COLORFGBG?.endsWith(";15") ? "light" : "dark") : themeName === "custom" ? "dark" : themeName;
  const base = THEMES[resolved];
  return {
    name: themeName,
    tokens: { ...base, ...customTokens },
    background: resolved === "light" ? "#ffffff" : "#0d1117"
  };
}

export function setTheme(name: ThemeName, tokens?: Partial<ThemeTokens>): ThemeTokens {
  themeName = name;
  customTokens = tokens ?? customTokens;
  return activeTheme().tokens;
}

export function loadThemeFile(path: string): ThemeTokens {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ThemeTokens>;
  const allowed: Array<keyof ThemeTokens> = ["foreground", "dim", "accent", "success", "warning", "danger", "border"];
  const tokens: Partial<ThemeTokens> = {};
  for (const key of allowed) {
    const value = parsed[key];
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) tokens[key] = value;
  }
  return setTheme("custom", tokens);
}

export function themeTokens(): ThemeTokens {
  return activeTheme().tokens;
}

function wrapRgb(hex: string, text: string): string {
  if (!colorEnabled()) return text;
  const [r, g, b] = parseHex(hex);
  return `\u001b[38;2;${r};${g};${b}m${text}\u001b[0m`;
}

function wrap(code: number, text: string): string {
  return colorEnabled() ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const ui = {
  bold: (text: string) => wrap(1, text),
  dimRaw: (text: string) => wrap(2, text),
  dim: (text: string) => wrapRgb(themeTokens().dim, text),
  red: (text: string) => wrapRgb(themeTokens().danger, text),
  green: (text: string) => wrapRgb(themeTokens().success, text),
  yellow: (text: string) => wrapRgb(themeTokens().warning, text),
  orange: (text: string) => wrapRgb("#e07b39", text),
  cyan: (text: string) => wrapRgb(themeTokens().accent, text),
  accent: (text: string) => wrapRgb(themeTokens().accent, text),
  border: (text: string) => wrapRgb(themeTokens().border, text),
  fg: (text: string) => wrapRgb(themeTokens().foreground, text)
};

export function colorsEnabled(): boolean {
  return colorEnabled();
}

export function screenReaderMode(): boolean {
  return process.env.RANN_SCREEN_READER === "1";
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of stripAnsi(text)) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0) continue;
    if (code < 32 || (code >= 0x7f && code < 0xa0)) continue;
    if (code >= 0x300 && code <= 0x36f) continue;
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function truncateWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (displayWidth(text) <= maxWidth) return text;
  let result = "";
  for (const char of text) {
    if (displayWidth(result + char) > maxWidth - 1) break;
    result += char;
  }
  return `${result}…`;
}

export function padWidth(text: string, width: number): string {
  const padding = Math.max(0, width - displayWidth(text));
  return `${text}${" ".repeat(padding)}`;
}

export function print(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export function printErr(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function clearScreen(tty = colorsEnabled()): void {
  if (!tty) return;
  process.stdout.write("\u001b[2J\u001b[H");
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[index] ?? ""))));
  const render = (row: string[]): string => row.map((cell, index) => padWidth(cell, widths[index] ?? 0)).join("  ").trimEnd();
  return [render(headers), ...rows.map(render)].join("\n");
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export interface Choice<T extends string> {
  key: T;
  label: string;
}

export async function chooseWith<T extends string>(
  ask: (question: string) => Promise<string>,
  prompt: string,
  choices: Array<Choice<T>>,
  fallback: T
): Promise<T> {
  for (;;) {
    process.stderr.write(`${prompt}\n`);
    choices.forEach((choice, index) => process.stderr.write(`  [${index + 1}] ${choice.label}\n`));
    const answer = (await ask(`Pilih 1-${choices.length} (Enter = ${fallback}): `)).trim().toLowerCase();
    if (answer.length === 0) return fallback;
    const numeric = Number.parseInt(answer, 10);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) return choices[numeric - 1]!.key;
    const direct = choices.find((choice) => choice.key === answer);
    if (direct) return direct.key;
    process.stderr.write("Pilihan tidak dikenal, coba lagi.\n");
  }
}

export async function choose<T extends string>(prompt: string, choices: Array<Choice<T>>, fallback: T): Promise<T> {
  if (process.stdin.isTTY !== true) return fallback;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await chooseWith((question) => rl.question(question), prompt, choices, fallback);
  } finally {
    rl.close();
  }
}

export class Spinner {
  private timer?: NodeJS.Timeout;
  private frame = 0;
  private startedAt = 0;
  private label = "";
  private readonly frames = ["-", "\\", "|", "/"];

  constructor(private readonly stream: NodeJS.WriteStream = process.stderr) {}

  start(label: string): void {
    this.stop();
    this.label = label;
    this.startedAt = Date.now();
    if (!colorEnabled() || screenReaderMode() || this.stream.isTTY !== true) {
      this.stream.write(`${label}\n`);
      return;
    }
    const draw = (): void => {
      const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
      this.stream.write(`\r${this.frames[this.frame % this.frames.length]} ${this.label} ${elapsed}s`);
      this.frame += 1;
    };
    draw();
    this.timer = setInterval(draw, 120);
    this.timer.unref();
  }

  stop(finalLine?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.stream.write("\r\u001b[2K");
    }
    if (finalLine) this.stream.write(`${finalLine}\n`);
  }
}

export function customThemePath(home: string): string {
  return `${home}/theme.json`;
}

export function loadCustomThemeIfPresent(home: string): void {
  const path = customThemePath(home);
  if (!existsSync(path)) return;
  try {
    loadThemeFile(path);
  } catch {
    // tema rusak tidak boleh menghalangi CLI
  }
}
