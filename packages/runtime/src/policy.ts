import { existsSync, lstatSync, realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { RannError, type PermissionMode } from "@rann/shared";

export type ToolRisk = "read" | "write" | "exec" | "net" | "admin";
export type PolicyDecision = "allow" | "ask" | "deny";

const DANGEROUS_SHELL = [
  /\brm\s+-[a-z]*[rf][a-z]*\s+\/(\s|$)/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\b[^\n]*\bof=\/dev\//i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/i,
  /\b:\(\)\s*\{[^}]*\}\s*;?\s*:/,
  />\s*\/dev\/(sd|nvme|vd)/i,
  /\bwipefs\b/i,
  /\bgit\s+push\b[^\n]*(--force\b|-f\b)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*[fdx]/i
];

const SENSITIVE_PATHS = [
  /(^|[/\\])\.ssh([/\\]|$)/i,
  /(^|[/\\])\.aws([/\\]|$)/i,
  /(^|[/\\])\.gnupg([/\\]|$)/i,
  /(^|[/\\])\.env(\.|$)/i,
  /(^|[/\\])id_(rsa|ed25519|ecdsa)(\.pub)?$/i,
  /(^|[/\\])\.kube[/\\]config$/i,
  /(^|[/\\])credentials(\.json)?$/i
];

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATHS.some((pattern) => pattern.test(path));
}

export function isDangerousShell(command: string): boolean {
  return DANGEROUS_SHELL.some((pattern) => pattern.test(command));
}

const DESTRUCTIVE_REASONS: Array<[RegExp, string]> = [
  [/\brm\s+-[a-z]*[rf][a-z]*/i, "menghapus berkas secara rekursif"],
  [/\bgit\s+reset\s+--hard\b/i, "membuang perubahan lokal yang belum disimpan"],
  [/\bgit\s+clean\s+-[a-z]*[fdx]/i, "menghapus berkas untracked"],
  [/\bgit\s+push\b[^\n]*(--force\b|-f\b)/i, "menulis ulang riwayat remote"],
  [/\bgit\s+branch\s+-D\b/i, "menghapus branch tanpa merge"],
  [/\bdrop\s+(table|database|schema)\b/i, "menghapus objek database"],
  [/\bmigrat(e|ion)\b[^\n]*\b(down|rollback|revert)\b/i, "menjalankan migrasi turun"],
  [/\bmkfs(\.\w+)?\b/i, "memformat filesystem"],
  [/\bdd\b[^\n]*\bof=\/dev\//i, "menulis mentah ke perangkat"],
  [/\b(shutdown|reboot|halt|poweroff)\b/i, "mematikan mesin"],
  [/\bchmod\s+(-R\s+)?777\s+\//i, "membuka izin seluruh filesystem"],
  [/\bwipefs\b/i, "menghapus signature filesystem"],
  [/\bsudo\b/i, "menjalankan perintah dengan hak akses root"]
];

export function destructiveReason(command: string): string | undefined {
  return DESTRUCTIVE_REASONS.find(([pattern]) => pattern.test(command))?.[1];
}

export interface PolicyInput {
  mode: PermissionMode;
  tool: string;
  risk: ToolRisk;
  command?: string;
  allow?: string[];
  deny?: string[];
  approved?: boolean;
  /** Konten sebelumnya berasal dari web atau tool lain yang tidak tepercaya. */
  untrusted?: boolean;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function matchesRule(rule: string, tool: string, command?: string): boolean {
  if (rule === tool || rule === "*") return true;
  const colon = rule.indexOf(":");
  if (colon === -1) return false;
  const ruleTool = rule.slice(0, colon);
  const pattern = rule.slice(colon + 1);
  if (ruleTool !== tool && ruleTool !== "*") return false;
  if (pattern === "*" || pattern === "") return true;
  return command !== undefined && globToRegExp(pattern).test(command);
}

export function decide(input: PolicyInput): PolicyDecision {
  if (input.risk === "exec" && input.command && isDangerousShell(input.command)) return "deny";
  if (input.command && destructiveReason(input.command)) {
    if (input.mode === "read-only") return "deny";
    return input.approved ? "allow" : "ask";
  }
  // Aksi yang mengubah state setelah membaca konten web butuh persetujuan
  // eksplisit, walau mode izinnya trusted (FR-145).
  if (input.untrusted && input.risk !== "read") {
    if (input.mode === "read-only") return "deny";
    return input.approved ? "allow" : "ask";
  }

  const deny = input.deny ?? [];
  const allow = input.allow ?? [];
  if (deny.some((rule) => matchesRule(rule, input.tool, input.command))) return "deny";
  if (allow.some((rule) => matchesRule(rule, input.tool, input.command))) return "allow";

  if (input.mode === "read-only") return input.risk === "read" ? "allow" : "deny";
  if (input.risk === "read") return "allow";
  if (input.mode === "trusted") return "allow";
  if (input.mode === "accept-edits") return input.risk === "write" ? "allow" : "ask";
  if (input.mode === "custom") return "ask";
  return input.approved ? "allow" : "ask";
}

export function assertAllowed(input: PolicyInput): void {
  const decision = decide(input);
  if (decision === "deny") {
    throw new RannError("E_PERMISSION", `Tool ${input.tool} diblokir oleh mode ${input.mode} atau aturan keamanan`, {
      data: { tool: input.tool, mode: input.mode }
    });
  }
  if (decision === "ask") {
    const reason = input.command ? destructiveReason(input.command) : undefined;
    const message = reason
      ? `Operasi destruktif (${reason}) butuh persetujuan eksplisit. Target: ${input.command ?? ""}`
      : `Tool ${input.tool} butuh persetujuan. Setujui lebih dulu atau ubah mode izin.`;
    throw new RannError("E_APPROVAL_REQUIRED", message, {
      data: { tool: input.tool, mode: input.mode, ...(reason ? { reason } : {}) }
    });
  }
}

export interface PathGuardOptions {
  workspaceRoot: string;
  workspaceOnly: boolean;
}

function realish(path: string): string {
  let current = resolve(path);
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missing.unshift(basename(current));
    current = parent;
  }
  const base = existsSync(current) ? realpathSync(current) : current;
  return missing.length > 0 ? resolve(base, ...missing) : base;
}

/**
 * Berkas dengan lebih dari satu hardlink bisa menunjuk ke inode di luar
 * workspace, sehingga realpath tidak cukup. Penulisan ditolak sampai user
 * memutus tautannya.
 */
export function assertNoHardlink(path: string): void {
  try {
    if (existsSync(path) && lstatSync(path).isFile() && lstatSync(path).nlink > 1) {
      throw new RannError("E_PERMISSION", `Berkas ${path} punya hardlink lain; tulis ulang lewat salinan baru`, {
        data: { path, links: lstatSync(path).nlink }
      });
    }
  } catch (error) {
    if (error instanceof RannError) throw error;
  }
}

export function resolveInsideWorkspace(path: string, options: PathGuardOptions): string {
  const root = realish(options.workspaceRoot);
  const target = realish(resolve(options.workspaceRoot, path));
  if (isSensitivePath(target)) {
    throw new RannError("E_PERMISSION", `Path sensitif ditolak: ${path}`, { data: { path } });
  }
  if (options.workspaceOnly && target !== root && !target.startsWith(root + sep)) {
    throw new RannError("E_PERMISSION", `Path keluar workspace ditolak: ${path}`, { data: { path } });
  }
  return resolve(options.workspaceRoot, path);
}
