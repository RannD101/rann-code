import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MAX_PER_FILE = 32_000;
const MAX_TOTAL = 64_000;

export interface InstructionBundle {
  files: string[];
  text: string;
  truncated: boolean;
  conflicts: string[];
}

interface Source {
  path: string;
  label: string;
  priority: number;
}

function readRules(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Urutan prioritas: makin besar makin kuat. Konflik antar berkas dicatat,
 * bukan diselesaikan diam-diam, supaya pengguna tahu aturan mana yang menang.
 */
export function instructionSources(workspaceRoot: string, globalConfigDir?: string, homeDir?: string): Source[] {
  const sources: Source[] = [];
  if (homeDir) {
    for (const [name, priority] of [
      ["SOUL.md", 44],
      ["USER.md", 40],
      ["MEMORY.md", 42]
    ] as const) {
      sources.push({ path: join(homeDir, name), label: name, priority });
    }
  }
  if (globalConfigDir) sources.push({ path: join(globalConfigDir, "RANN.md"), label: "global:RANN.md", priority: 20 });
  sources.push({ path: join(workspaceRoot, "RANN.md"), label: "RANN.md", priority: 30 });
  sources.push({ path: join(workspaceRoot, "README.md"), label: "README.md", priority: 10 });
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    sources.push({ path: join(workspaceRoot, name), label: name, priority: 28 });
  }
  sources.push({ path: join(workspaceRoot, ".rann", "instructions.md"), label: ".rann/instructions.md", priority: 35 });
  for (const path of readRules(join(workspaceRoot, ".rann", "rules"))) {
    sources.push({ path, label: `.rann/rules/${path.split(/[\\/]/).pop() ?? "rule.md"}`, priority: 50 });
  }
  return sources;
}

export function loadInstructions(workspaceRoot: string, globalConfigDir?: string, homeDir?: string): InstructionBundle {
  const files: string[] = [];
  const chunks: string[] = [];
  const conflicts: string[] = [];
  let total = 0;
  let truncated = false;

  const sources = instructionSources(workspaceRoot, globalConfigDir, homeDir)
    .sort((a, b) => b.priority - a.priority);
  const seen = new Set<string>();

  for (const source of sources) {
    if (!existsSync(source.path)) continue;
    let text: string;
    try {
      text = readFileSync(source.path, "utf8");
    } catch {
      continue;
    }
    if (text.length > MAX_PER_FILE) {
      text = text.slice(0, MAX_PER_FILE);
      truncated = true;
    }
    if (total + text.length > MAX_TOTAL) {
      text = text.slice(0, Math.max(0, MAX_TOTAL - total));
      truncated = true;
    }
    if (text.length === 0) continue;

    for (const line of text.split("\n")) {
      const key = line.trim().toLowerCase();
      if (key.startsWith("jangan ")) {
        if (seen.has(key.replace(/^jangan\s+/, "selalu "))) conflicts.push(`${source.label}: "${line.trim()}" bertentangan dengan aturan sebelumnya`);
      }
      if (key.startsWith("selalu ")) seen.add(key);
    }

    files.push(source.path);
    chunks.push(`### Instruksi ${source.label} (prioritas ${source.priority})\n${text}`);
    total += text.length;
    if (total >= MAX_TOTAL) break;
  }

  return { files, text: chunks.join("\n\n"), truncated, conflicts };
}
