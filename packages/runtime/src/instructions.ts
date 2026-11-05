import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = ["RANN.md", "AGENTS.md", "CLAUDE.md"];
const MAX_PER_FILE = 32_000;
const MAX_TOTAL = 64_000;

export interface InstructionBundle {
  files: string[];
  text: string;
  truncated: boolean;
}

export function loadInstructions(workspaceRoot: string, globalConfigDir?: string): InstructionBundle {
  const files: string[] = [];
  const chunks: string[] = [];
  let total = 0;
  let truncated = false;

  const sources: Array<{ path: string; label: string }> = [];
  if (globalConfigDir) sources.push({ path: join(globalConfigDir, "RANN.md"), label: "global" });
  for (const name of CANDIDATES) sources.push({ path: join(workspaceRoot, name), label: name });

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
    files.push(source.path);
    chunks.push(`### Instruksi dari ${source.label}\n${text}`);
    total += text.length;
    if (total >= MAX_TOTAL) break;
  }

  return { files, text: chunks.join("\n\n"), truncated };
}
