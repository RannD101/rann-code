import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

export interface SymbolEntry {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "method";
  path: string;
  line: number;
}

const SKIP = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".rann", "vendor", "target"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".kts"]);

const PATTERNS: Array<{ pattern: RegExp; kind: SymbolEntry["kind"] }> = [
  { pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
  { pattern: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: "type" },
  { pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function)/, kind: "const" },
  { pattern: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, kind: "function" },
  { pattern: /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/, kind: "class" },
  { pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function" },
  { pattern: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
  { pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: "function" },
  { pattern: /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, kind: "type" },
  { pattern: /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?(?:final\s+)?(?:class|interface|enum)\s+([A-Za-z_]\w*)/, kind: "class" },
  { pattern: /^\s*(?:public|private|protected|internal)\s+(?:static\s+)?(?:final\s+)?[\w<>[\], ?]+\s+([A-Za-z_]\w*)\s*\(/, kind: "method" }
];

function listFiles(root: string, limit: number): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) visit(path);
      } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        out.push(path);
      }
    }
  };
  visit(root);
  return out;
}

export function buildSymbolIndex(root: string, options: { maxFiles?: number } = {}): SymbolEntry[] {
  const entries: SymbolEntry[] = [];
  for (const file of listFiles(root, options.maxFiles ?? 2_000)) {
    let info;
    try {
      info = statSync(file);
    } catch {
      continue;
    }
    if (info.size > 1_000_000) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(root, file).replace(/\\/g, "/");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      for (const rule of PATTERNS) {
        const match = rule.pattern.exec(line);
        if (!match?.[1]) continue;
        entries.push({ name: match[1], kind: rule.kind, path: rel, line: index + 1 });
        break;
      }
    }
  }
  return entries;
}

export function saveSymbolIndex(root: string, entries = buildSymbolIndex(root)): string {
  const dir = join(root, ".rann");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "symbols.json");
  writeFileSync(path, JSON.stringify({ version: 1, generated_at: Date.now(), entries }, null, 2), { mode: 0o600 });
  return path;
}

export function loadSymbolIndex(root: string): SymbolEntry[] {
  const path = join(root, ".rann", "symbols.json");
  if (!existsSync(path)) return buildSymbolIndex(root);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: SymbolEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : buildSymbolIndex(root);
  } catch {
    return buildSymbolIndex(root);
  }
}

export function searchSymbols(root: string, query: string, limit = 50): SymbolEntry[] {
  const needle = query.toLowerCase();
  return loadSymbolIndex(root)
    .map((entry) => ({
      entry,
      score: entry.name.toLowerCase() === needle ? 4 : entry.name.toLowerCase().startsWith(needle) ? 3 : entry.name.toLowerCase().includes(needle) ? 2 : 0
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((item) => item.entry);
}
