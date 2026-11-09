import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerCommands, type ReplCommand } from "./repl-commands.js";

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw.trim() };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of raw.slice(3, end).split("\n")) {
    const match = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line.trim());
    if (match) meta[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return { meta, body: raw.slice(end + 4).trim() };
}

/**
 * Command proyek dari `.rann/commands/*.md`. Nama yang sama dengan command
 * bawaan menimpa command bawaan selama sesi ini (FR-002).
 */
export function loadProjectCommands(projectRoot: string): ReplCommand[] {
  const dir = join(projectRoot, ".rann", "commands");
  if (!existsSync(dir)) return [];
  const commands: ReplCommand[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const parsed = parseFrontmatter(readFileSync(join(dir, entry.name), "utf8"));
    const name = (parsed.meta.name ?? entry.name.replace(/\.md$/, "")).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(name)) continue;
    const body = parsed.body;
    if (body.length === 0) continue;
    commands.push({
      name,
      aliases: parsed.meta.aliases ? parsed.meta.aliases.split(",").map((item) => item.trim()).filter(Boolean) : [],
      usage: `/${name} [argumen]`,
      description: parsed.meta.description ?? `Command proyek ${name}`,
      category: "proyek",
      permission: "read",
      arguments: [],
      optionalParams: [],
      output: ["text"],
      errors: [],
      handler: body,
      docs: body,
      available: true,
      source: "project"
    });
  }
  return commands;
}

export function registerProjectCommands(projectRoot: string): string[] {
  const conflicts = registerCommands(loadProjectCommands(projectRoot));
  return conflicts;
}
