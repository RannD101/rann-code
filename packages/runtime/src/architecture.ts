import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const IGNORED = new Set(["node_modules", ".git", "dist", "build", "coverage", ".rann"]);

export interface ArchitectureReport {
  files: number;
  cycles: string[][];
  layerViolations: Array<{ from: string; to: string; rule: string }>;
}

function walk(root: string, dir = root, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) walk(root, absolute, out);
    else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(absolute);
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const output: string[] = [];
  for (const match of text.matchAll(/(?:from\s+|import\s+)["'](\.[^"']+)["']/g)) {
    const raw = match[1]!;
    const base = resolve(dirname(file), raw.replace(/\.(js|ts|tsx|mjs)$/, ""));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, "index.ts"), join(base, "index.js")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        output.push(resolve(candidate));
        break;
      }
    }
  }
  return output;
}

/** Deteksi siklus import dan pelanggaran lapisan domain -> infra (AC-049). */
export function analyzeArchitecture(root: string): ArchitectureReport {
  const rootPath = resolve(root);
  const files = walk(rootPath);
  const graph = new Map<string, string[]>();
  for (const file of files) graph.set(file, importsOf(file));
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (file: string): void => {
    const current = state.get(file);
    if (current === "done") return;
    if (current === "visiting") {
      const index = stack.indexOf(file);
      if (index >= 0) cycles.push(stack.slice(index).map((item) => relative(rootPath, item).split(sep).join("/")));
      return;
    }
    state.set(file, "visiting");
    stack.push(file);
    for (const next of graph.get(file) ?? []) visit(next);
    stack.pop();
    state.set(file, "done");
  };
  for (const file of files) visit(file);
  const layerViolations: ArchitectureReport["layerViolations"] = [];
  for (const [file, imports] of graph) {
    const rel = relative(rootPath, file).split(sep).join("/");
    if (!rel.startsWith("src/domain/")) continue;
    for (const target of imports) {
      const targetRel = relative(rootPath, target).split(sep).join("/");
      if (targetRel.startsWith("src/infra/")) {
        layerViolations.push({ from: rel, to: targetRel, rule: "domain tidak boleh mengimpor infra" });
      }
    }
  }
  const seen = new Set<string>();
  const unique = cycles.filter((cycle) => {
    const key = [...cycle].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { files: files.length, cycles: unique, layerViolations };
}
