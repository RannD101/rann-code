import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface HistoryEntry {
  text: string;
  at: number;
  cwd: string;
}

export interface HistoryQuery {
  search?: string;
  from?: number;
  to?: number;
  limit?: number;
}

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/i
];

export function isPrivatePrompt(text: string): boolean {
  return /^\[private\]/i.test(text.trim()) || /\[private\]\s*$/i.test(text.trim()) || SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function projectKey(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

export class HistoryStore {
  path: string;
  private entries: HistoryEntry[] = [];

  constructor(
    private readonly dir: string,
    cwd: string,
    private readonly maxEntries = 1_000
  ) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // filesystem non-POSIX
    }
    this.path = join(dir, `${projectKey(cwd)}.jsonl`);
    this.load();
  }

  private draftsPath(): string {
    return join(this.dir, "drafts.json");
  }

  saveDraft(cwd: string, text: string): void {
    if (text.trim().length === 0) return;
    let all: Record<string, string> = {};
    try {
      all = JSON.parse(readFileSync(this.draftsPath(), "utf8")) as Record<string, string>;
    } catch {
      all = {};
    }
    all[cwd] = text;
    writeFileSync(this.draftsPath(), JSON.stringify(all), { mode: 0o600 });
  }

  takeDraft(cwd: string): string {
    let all: Record<string, string> = {};
    try {
      all = JSON.parse(readFileSync(this.draftsPath(), "utf8")) as Record<string, string>;
    } catch {
      return "";
    }
    const text = all[cwd] ?? "";
    if (text.length > 0) {
      delete all[cwd];
      writeFileSync(this.draftsPath(), JSON.stringify(all), { mode: 0o600 });
    }
    return text;
  }

  switchTo(cwd: string): void {
    this.path = join(this.dir, `${projectKey(cwd)}.jsonl`);
    this.entries = [];
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    const lines = readFileSync(this.path, "utf8").split("\n");
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        if (typeof entry.text === "string" && typeof entry.at === "number" && typeof entry.cwd === "string") entries.push(entry);
      } catch {
        // baris rusak diabaikan, riwayat tetap bisa dipakai
      }
    }
    this.entries = entries.slice(-this.maxEntries);
  }

  private persist(): void {
    const body = `${this.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, body, { mode: 0o600 });
    try {
      chmodSync(temporary, 0o600);
    } catch {
      // abaikan
    }
    renameSync(temporary, this.path);
  }

  add(text: string, cwd = process.cwd()): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0 || isPrivatePrompt(trimmed)) return false;
    const previous = this.entries[this.entries.length - 1];
    if (previous?.text === trimmed) return true;
    this.entries.push({ text: trimmed, at: Date.now(), cwd });
    if (this.entries.length > this.maxEntries) this.entries = this.entries.slice(-this.maxEntries);
    this.persist();
    return true;
  }

  all(): HistoryEntry[] {
    return [...this.entries];
  }

  search(query: HistoryQuery = {}): HistoryEntry[] {
    const needle = (query.search ?? "").toLowerCase();
    return this.entries
      .filter((entry) => (query.from === undefined ? true : entry.at >= query.from))
      .filter((entry) => (query.to === undefined ? true : entry.at <= query.to))
      .filter((entry) => (needle.length === 0 ? true : fuzzyMatch(entry.text.toLowerCase(), needle)))
      .slice(-(query.limit ?? 50));
  }

  clear(): number {
    const count = this.entries.length;
    this.entries = [];
    this.persist();
    return count;
  }
}

export function fuzzyMatch(haystack: string, needle: string): boolean {
  if (needle.length === 0) return true;
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

export function fuzzyScore(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let index = 0;
  let gaps = 0;
  let matched = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      matched += 1;
      if (index === needle.length) return 100 - gaps - Math.max(0, haystack.length - matched);
    } else if (index > 0) {
      gaps += 1;
    }
  }
  return -1;
}
