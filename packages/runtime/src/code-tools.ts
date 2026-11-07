import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { RannError } from "@rann/shared";
import { resolveInsideWorkspace } from "./policy.js";

const IGNORED = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".rann",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".turbo",
  ".cache"
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".toml",
  ".yaml",
  ".yml",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".php",
  ".rb",
  ".cs",
  ".c",
  ".h",
  ".cpp",
  ".css",
  ".scss",
  ".html",
  ".sql",
  ".sh",
  ".xml",
  ".ini",
  ".env"
]);

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  reason: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  scanned: number;
  truncated: boolean;
  note?: string;
}

function isProbablyText(path: string): boolean {
  if (TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return true;
  try {
    const buffer = readFileSync(path);
    if (buffer.length === 0) return true;
    return !buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0);
  } catch {
    return false;
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const token = "@@DOUBLE_STAR@@";
  const pattern = escaped
    .replace(/\*\*/g, token)
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replaceAll(token, ".*");
  return new RegExp(`^${pattern}$`);
}

export function searchCode(
  workspaceRoot: string,
  query: string,
  options: {
    regex?: boolean;
    caseSensitive?: boolean;
    glob?: string;
    maxResults?: number;
    context?: number;
    maxFileBytes?: number;
  } = {}
): SearchResult {
  const maxResults = Math.min(options.maxResults ?? 50, 500);
  const maxFileBytes = options.maxFileBytes ?? 1_000_000;
  const glob = options.glob ? globToRegExp(options.glob.replaceAll("\\", "/")) : null;
  let matcher: RegExp;
  try {
    matcher = new RegExp(options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), options.caseSensitive ? "g" : "gi");
  } catch {
    throw new RannError("E_TOOL_INVALID_ARGS", "Pola pencarian tidak valid");
  }

  const matches: SearchMatch[] = [];
  let scanned = 0;
  let truncated = false;
  const visit = (dir: string): void => {
    if (truncated) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED.has(entry.name)) visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(workspaceRoot, absolute).split(sep).join("/");
      if (glob && !glob.test(rel)) continue;
      if (!glob && !isProbablyText(absolute)) continue;
      let stat;
      try {
        stat = statSync(absolute);
      } catch {
        continue;
      }
      if (stat.size > maxFileBytes) continue;
      scanned += 1;
      let content: string;
      try {
        content = readFileSync(absolute, "utf8");
      } catch {
        continue;
      }
      if (glob && content.includes("\u0000")) continue;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        matcher.lastIndex = 0;
        const found = matcher.exec(line);
        if (!found) continue;
        const reason = options.regex
          ? "cocok dengan pola regex"
          : found[0].toLowerCase() === query.toLowerCase() && found[0] === query
            ? "kecocokan persis"
            : "kecocokan kata kunci";
        matches.push({
          path: rel,
          line: index + 1,
          column: found.index + 1,
          text: line.trim().slice(0, 400),
          reason
        });
        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
      }
    }
  };
  visit(resolve(workspaceRoot));
  return {
    matches,
    scanned,
    truncated,
    ...(matches.length === 0 ? { note: "Tidak ada kecocokan. Coba kata kunci yang lebih umum atau matikan filter glob." } : {})
  };
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
}

/**
 * Diff terpadu sederhana berbasis awalan dan akhiran yang sama.
 *
 * Untuk edit satu blok (old_string -> new_string) hasilnya satu hunk yang
 * minimal. Untuk penulisan ulang penuh, blok tengah bisa lebih lebar dari
 * diff LCS, tetapi tetap cukup untuk audit dan pratinjau.
 */
export function unifiedDiff(path: string, before: string | null, after: string, context = 3): string {
  const a = before === null || before.length === 0 ? [] : before.split(/\r?\n/);
  const b = after.length === 0 ? [] : after.split(/\r?\n/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }
  if (start > endA && start > endB) return "";

  const hunkStart = Math.max(0, start - context);
  const hunkEndA = Math.min(a.length, endA + 1 + context);
  const hunkEndB = Math.min(b.length, endB + 1 + context);
  const oldCount = hunkEndA - hunkStart;
  const newCount = hunkEndB - hunkStart;
  const range = (lineCount: number): string =>
    lineCount === 0 ? `${hunkStart},0` : `${hunkStart + 1},${lineCount}`;
  const lines = [
    `--- ${before === null ? "/dev/null" : `a/${path}`}`,
    `+++ b/${path}`,
    `@@ -${range(oldCount)} +${range(newCount)} @@`
  ];
  for (let i = hunkStart; i < start; i += 1) lines.push(` ${a[i] ?? ""}`);
  for (let i = start; i <= endA; i += 1) lines.push(`-${a[i] ?? ""}`);
  for (let i = start; i <= endB; i += 1) lines.push(`+${b[i] ?? ""}`);
  for (let i = endA + 1; i < hunkEndA; i += 1) lines.push(` ${a[i] ?? ""}`);
  return `${lines.join("\n")}\n`;
}

export interface FileChange {
  path: string;
  content: string;
  expected_sha256?: string;
}

export interface TransactionFile {
  path: string;
  status: "created" | "updated" | "unchanged";
  before_sha256: string | null;
  after_sha256: string;
  lines_before: number;
  lines_after: number;
  lines_added: number;
  lines_removed: number;
  diff: string;
  before_text?: string | null;
  after_text?: string;
}

export interface TransactionResult {
  files: TransactionFile[];
  bytes: number;
  rolled_back: boolean;
}

export function applyFileTransaction(
  workspaceRoot: string,
  changes: FileChange[],
  options: { workspaceOnly?: boolean; dryRun?: boolean; includeText?: boolean } = {}
): TransactionResult {
  if (changes.length === 0) throw new RannError("E_TOOL_INVALID_ARGS", "Transaksi tanpa berkas");
  const prepared: Array<{
    absolute: string;
    rel: string;
    content: string;
    original: string | null;
    before: string | null;
    existed: boolean;
  }> = [];
  const seen = new Set<string>();

  for (const change of changes) {
    const absolute = resolveInsideWorkspace(change.path, {
      workspaceRoot,
      workspaceOnly: options.workspaceOnly !== false
    });
    if (seen.has(absolute)) throw new RannError("E_TOOL_INVALID_ARGS", `Berkas duplikat dalam transaksi: ${change.path}`);
    seen.add(absolute);
    const existed = existsSync(absolute);
    const original = existed ? readFileSync(absolute, "utf8") : null;
    if (change.expected_sha256 && change.expected_sha256 !== (original === null ? null : hash(original))) {
      throw new RannError("E_FILE_CHANGED", `Berkas berubah sejak dibaca: ${change.path}`);
    }
    prepared.push({
      absolute,
      rel: relative(workspaceRoot, absolute).split(sep).join("/"),
      content: change.content,
      original,
      before: original === null ? null : hash(original),
      existed
    });
  }

  const resultFiles: TransactionFile[] = prepared.map((item) => ({
    path: item.rel,
    status: item.original === item.content ? "unchanged" : item.existed ? "updated" : "created",
    before_sha256: item.before,
    after_sha256: hash(item.content),
    lines_before: item.original === null ? 0 : countLines(item.original),
    lines_after: countLines(item.content),
    ...(() => {
      const diff = unifiedDiff(item.rel, item.original, item.content);
      const lines = diff.split("\n");
      return {
        lines_added: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
        lines_removed: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length
      };
    })(),
    diff: unifiedDiff(item.rel, item.original, item.content),
    ...(options.includeText === true
      ? { before_text: item.original, after_text: item.content }
      : {})
  }));

  if (options.dryRun === true) {
    return { files: resultFiles, bytes: prepared.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0), rolled_back: false };
  }

  const written: typeof prepared = [];
  try {
    for (const item of prepared) {
      if (item.original === item.content) continue;
      mkdirSync(dirname(item.absolute), { recursive: true });
      const temp = join(dirname(item.absolute), `.${basename(item.absolute)}.rann-${process.pid}-${Date.now()}`);
      writeFileSync(temp, item.content, "utf8");
      renameSync(temp, item.absolute);
      written.push(item);
    }
    for (const item of written) {
      const actual = readFileSync(item.absolute, "utf8");
      if (hash(actual) !== hash(item.content)) {
        throw new RannError("E_FILE_CHANGED", `Hash berkas setelah tulis tidak cocok: ${item.rel}`);
      }
    }
  } catch (error) {
    for (const item of written.reverse()) {
      try {
        if (item.existed && item.original !== null) writeFileSync(item.absolute, item.original, "utf8");
        else unlinkSync(item.absolute);
      } catch {
        // lanjut memulihkan berkas lain
      }
    }
    throw new RannError("E_TOOL_FAILED", `Transaksi gagal dan dikembalikan: ${(error as Error).message}`, {
      data: { rolled_back: true }
    });
  }

  return {
    files: resultFiles,
    bytes: prepared.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0),
    rolled_back: false
  };
}

export function cleanupEmptyDirs(workspaceRoot: string, dirs: string[]): void {
  for (const dir of dirs) {
    try {
      const absolute = resolve(workspaceRoot, dir);
      if (absolute.startsWith(resolve(workspaceRoot) + sep)) rmSync(absolute, { recursive: false });
    } catch {
      // folder tidak kosong atau tidak ada
    }
  }
}
