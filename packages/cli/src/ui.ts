import { existsSync, readFileSync } from "node:fs";

export type ThemeName = "dark" | "light" | "minimal" | "auto" | "custom";
export type ColorDepth = "none" | "16" | "256" | "truecolor";

export interface ThemeTokens {
  foreground: string;
  dim: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  border: string;
}

const THEMES: Record<"dark" | "light" | "minimal", ThemeTokens> = {
  dark: {
    foreground: "#e6edf3",
    dim: "#8b949e",
    accent: "#7ee787",
    success: "#7ee787",
    warning: "#e3b341",
    danger: "#ff7b72",
    border: "#30363d"
  },
  light: {
    foreground: "#1f2328",
    dim: "#57606a",
    accent: "#1a7f37",
    success: "#1a7f37",
    warning: "#9a6700",
    danger: "#cf222e",
    border: "#d0d7de"
  },
  minimal: {
    foreground: "#f0f0f0",
    dim: "#a8a8a8",
    accent: "#ffffff",
    success: "#ffffff",
    warning: "#ffffff",
    danger: "#ffffff",
    border: "#4a4a4a"
  }
};

const VALID_THEMES: ThemeName[] = ["dark", "light", "minimal", "auto", "custom"];
const configuredTheme = process.env.RANN_THEME as ThemeName | undefined;
let themeName: ThemeName = configuredTheme && VALID_THEMES.includes(configuredTheme) ? configuredTheme : "auto";
let customTokens: Partial<ThemeTokens> = {};

/** Deteksi kemampuan warna sekali per proses, dengan override untuk tes. */
export function colorDepth(): ColorDepth {
  const forced = process.env.RANN_COLOR;
  if (forced === "none" || process.env.NO_COLOR !== undefined || process.env.RANN_NO_COLOR === "1" || process.env.RANN_SCREEN_READER === "1") return "none";
  if (forced === "16" || forced === "256" || forced === "truecolor") return forced;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined) {
    if (force === "0" || force === "false") return "none";
    if (force === "3") return "truecolor";
    if (force === "2") return "256";
    return "16";
  }
  if (process.stdout.isTTY !== true || process.env.TERM === "dumb") return "none";
  const term = process.env.TERM ?? "";
  const colorTerm = (process.env.COLORTERM ?? "").toLowerCase();
  if (colorTerm === "truecolor" || colorTerm === "24bit") return "truecolor";
  if (term.includes("256color")) return "256";
  if (term.includes("color") || term.includes("xterm") || term.includes("screen") || term.includes("tmux") || term.includes("ansi")) return "16";
  return "16";
}

export function colorEnabled(): boolean {
  return colorDepth() !== "none";
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
  const resolved: "dark" | "light" | "minimal" = themeName === "auto"
    ? (process.env.COLORFGBG?.endsWith(";15") ? "light" : "dark")
    : themeName === "custom" ? "dark" : themeName === "minimal" ? "minimal" : themeName;
  const base = THEMES[resolved];
  return {
    name: themeName,
    tokens: { ...base, ...customTokens },
    background: resolved === "light" ? "#ffffff" : resolved === "minimal" ? "#000000" : "#0d1117"
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

function rgbTo256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  const toCube = (value: number): number => Math.round((value / 255) * 5);
  return 16 + 36 * toCube(r) + 6 * toCube(g) + toCube(b);
}

const ANSI16: Array<[number, number, number]> = [
  [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
  [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
  [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]
];

function rgbTo16(r: number, g: number, b: number): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ANSI16.length; index += 1) {
    const [rr, gg, bb] = ANSI16[index]!;
    const next = (r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2;
    if (next < distance) {
      distance = next;
      best = index;
    }
  }
  return best < 8 ? 30 + best : 90 + (best - 8);
}

function wrapRgb(hex: string, text: string): string {
  const depth = colorDepth();
  if (depth === "none") return text;
  const [r, g, b] = parseHex(hex);
  if (depth === "truecolor") return `\u001b[38;2;${r};${g};${b}m${text}\u001b[0m`;
  if (depth === "256") return `\u001b[38;5;${rgbTo256(r, g, b)}m${text}\u001b[0m`;
  return `\u001b[${rgbTo16(r, g, b)}m${text}\u001b[0m`;
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
  fg: (text: string) => wrapRgb(themeTokens().foreground, text),
  white: (text: string) => wrapRgb("#ffffff", text),
  label: (text: string) => wrapRgb(themeTokens().dim, text.toUpperCase()),
  selected: (text: string) => wrapRgb(themeTokens().accent, text)
};

/** Rule horizontal tanpa border berlebih; aman untuk terminal sempit. */
export function rule(width = process.stdout.columns ?? 80, label = ""): string {
  const safe = Math.max(1, width);
  if (label.length === 0) return ui.border("─".repeat(safe));
  const text = ` ${label} `;
  const left = Math.max(0, Math.floor((safe - displayWidth(text)) / 2));
  const right = Math.max(0, safe - left - displayWidth(text));
  return `${ui.border("─".repeat(left))}${ui.dim(text)}${ui.border("─".repeat(right))}`;
}

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

import { translateUi } from "./i18n.js";

export function print(line = ""): void {
  process.stdout.write(`${translateUi(line)}\n`);
}

export function printErr(line: string): void {
  process.stderr.write(`${translateUi(line)}\n`);
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
  shortcut?: string;
}

export async function chooseWith<T extends string>(
  ask: (question: string) => Promise<string>,
  prompt: string,
  choices: Array<Choice<T>>,
  fallback: T
): Promise<T> {
  for (;;) {
    process.stderr.write(`${prompt}\n`);
    choices.forEach((choice, index) => process.stderr.write(`  [${choice.shortcut ?? index + 1}] ${choice.label}\n`));
    const answer = (await ask(`Pilih ${choices.map((choice, index) => choice.shortcut ?? index + 1).join("/")} (Enter = ${fallback}): `)).trim().toLowerCase();
    if (answer.length === 0) return fallback;
    const numeric = Number.parseInt(answer, 10);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) return choices[numeric - 1]!.key;
    const direct = choices.find((choice) => choice.key === answer || choice.shortcut?.toLowerCase() === answer);
    if (direct) return direct.key;
    process.stderr.write(`${translateUi("Pilihan tidak dikenal, coba lagi.")}\n`);
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
    if (!colorEnabled() || screenReaderMode() || this.stream.isTTY !== true || process.env.RANN_REDUCED_MOTION === "1" || process.env.RANN_ANIMATIONS === "0") {
      this.stream.write(`${translateUi(label)}\n`);
      return;
    }
    const draw = (): void => {
      const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
      this.stream.write(`\r${this.frames[this.frame % this.frames.length]} ${translateUi(this.label)} ${elapsed}s`);
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
