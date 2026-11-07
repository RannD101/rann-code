import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";

export type CustomCommandPermission = "read" | "write" | "exec" | "net" | "admin";

export interface CustomCommandArgument {
  name: string;
  required: boolean;
  description?: string;
}

export interface CustomCommand {
  name: string;
  description: string;
  aliases: string[];
  permission: CustomCommandPermission;
  args: CustomCommandArgument[];
  model?: string;
  body: string;
  path: string;
  source: "project" | "global";
}

export interface CustomCommandLoadResult {
  commands: CustomCommand[];
  errors: string[];
}

interface RawFrontmatter {
  name?: unknown;
  description?: unknown;
  aliases?: unknown;
  permission?: unknown;
  args?: unknown;
  model?: unknown;
}

const NAME = /^[a-z][a-z0-9-]{1,63}$/;
const PERMISSIONS = new Set<CustomCommandPermission>(["read", "write", "exec", "net", "admin"]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter((item): item is string => item !== undefined);
}

function parseArgs(value: unknown): CustomCommandArgument[] {
  if (!Array.isArray(value)) return [];
  const output: CustomCommandArgument[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const name = asString(raw.name);
    if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) continue;
    output.push({
      name,
      required: raw.required === true,
      ...(asString(raw.description) ? { description: asString(raw.description)! } : {})
    });
  }
  return output;
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return undefined;
  return { frontmatter: match[1] ?? "", body: (match[2] ?? "").trim() };
}

function minimalPermission(declared: CustomCommandPermission, body: string): CustomCommandPermission {
  const asksShell = /(^|\n)\s*!|`[^`]*`|\b(shell|bash|terminal|jalankan perintah)\b/i.test(body);
  if (!asksShell) return declared;
  const rank: CustomCommandPermission[] = ["read", "write", "exec", "net", "admin"];
  return rank[Math.max(rank.indexOf(declared), rank.indexOf("exec"))] ?? "exec";
}

export function parseCustomCommand(text: string, path: string, source: "project" | "global"): CustomCommand {
  const parts = splitFrontmatter(text);
  if (!parts) throw new Error("frontmatter tidak ditemukan");
  let raw: RawFrontmatter;
  try {
    const parsed = parseYaml(parts.frontmatter);
    if (parsed === null || typeof parsed !== "object") throw new Error("frontmatter bukan objek");
    raw = parsed as RawFrontmatter;
  } catch (error) {
    throw new Error(`frontmatter tidak valid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const name = asString(raw.name) ?? basename(path, ".md");
  if (!NAME.test(name)) throw new Error(`nama command tidak valid: ${name}`);
  const description = asString(raw.description);
  if (!description) throw new Error("description wajib diisi");
  const declared = (asString(raw.permission) ?? "read") as CustomCommandPermission;
  if (!PERMISSIONS.has(declared)) throw new Error(`permission tidak dikenal: ${String(raw.permission)}`);
  if (parts.body.length === 0) throw new Error("isi command kosong");
  const aliases = asStringList(raw.aliases);
  for (const alias of aliases) {
    if (!NAME.test(alias)) throw new Error(`alias tidak valid: ${alias}`);
  }
  return {
    name,
    description,
    aliases,
    permission: minimalPermission(declared, parts.body),
    args: parseArgs(raw.args),
    ...(asString(raw.model) ? { model: asString(raw.model)! } : {}),
    body: parts.body,
    path,
    source
  };
}

function loadDirectory(directory: string, source: "project" | "global"): { commands: CustomCommand[]; errors: string[] } {
  const commands: CustomCommand[] = [];
  const errors: string[] = [];
  if (!existsSync(directory)) return { commands, errors };
  for (const entry of readdirSync(directory).sort()) {
    if (!entry.endsWith(".md")) continue;
    const path = join(directory, entry);
    try {
      commands.push(parseCustomCommand(readFileSync(path, "utf8"), path, source));
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { commands, errors };
}

export function loadCustomCommands(options: {
  homeDir: string;
  projectDir: string;
  coreNames?: Iterable<string>;
}): CustomCommandLoadResult {
  const errors: string[] = [];
  const core = new Set(options.coreNames ?? []);
  const globalResult = loadDirectory(options.homeDir, "global");
  const projectResult = loadDirectory(options.projectDir, "project");
  errors.push(...globalResult.errors, ...projectResult.errors);
  const byName = new Map<string, CustomCommand>();
  for (const command of [...globalResult.commands, ...projectResult.commands]) {
    if (core.has(command.name)) {
      errors.push(`${command.path}: nama ${command.name} bentrok dengan command inti`);
      continue;
    }
    const existing = byName.get(command.name);
    if (existing?.source === "project" && command.source === "global") {
      errors.push(`${command.path}: command global ${command.name} kalah dari versi project`);
      continue;
    }
    if (existing?.source === "global" && command.source === "project") {
      errors.push(`${existing.path}: command global ${command.name} ditimpa versi project`);
    }
    byName.set(command.name, command);
  }
  return { commands: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), errors };
}

function parseArgumentList(input: string): string[] {
  const output: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        output.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) output.push(current);
  return output;
}

export function expandCustomCommand(command: CustomCommand, rawArguments: string): string {
  const tokens = parseArgumentList(rawArguments);
  const named = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) {
      named.set(token.slice(2, equals), token.slice(equals + 1));
      continue;
    }
    const next = tokens[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      named.set(token.slice(2), next);
      index += 1;
    } else {
      named.set(token.slice(2), "true");
    }
  }
  const missing = command.args.filter((arg) => arg.required && !named.has(arg.name) && tokens.length === 0);
  if (missing.length > 0) {
    throw new Error(`argumen wajib: ${missing.map((arg) => arg.name).join(", ")}`);
  }
  let text = command.body;
  text = text.replaceAll("$ARGUMENTS", rawArguments.trim());
  text = text.replace(/\$(\d+)/g, (_match, index: string) => tokens[Number(index) - 1] ?? "");
  text = text.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g, (_match, name: string) => named.get(name) ?? "");
  const hasPlaceholder = /\$ARGUMENTS|\$\d+|\{\{/.test(command.body);
  if (!hasPlaceholder && rawArguments.trim().length > 0) {
    text = `${text}\n\nArgumen: ${rawArguments.trim()}`;
  }
  return text.trim();
}
