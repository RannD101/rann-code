import { resolve, sep } from "node:path";
import { RannError, type PermissionMode } from "@rann/shared";

export type ToolRisk = "read" | "write" | "exec";
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
  /\bgit\s+push\b/i
];

export function isDangerousShell(command: string): boolean {
  return DANGEROUS_SHELL.some((pattern) => pattern.test(command));
}

export interface PolicyInput {
  mode: PermissionMode;
  tool: string;
  risk: ToolRisk;
  command?: string;
  allow?: string[];
  deny?: string[];
  approved?: boolean;
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
    throw new RannError("E_APPROVAL_REQUIRED", `Tool ${input.tool} butuh persetujuan. Setujui lebih dulu atau ubah mode izin.`, {
      data: { tool: input.tool, mode: input.mode }
    });
  }
}

export interface PathGuardOptions {
  workspaceRoot: string;
  workspaceOnly: boolean;
}

export function resolveInsideWorkspace(path: string, options: PathGuardOptions): string {
  const root = resolve(options.workspaceRoot);
  const target = resolve(root, path);
  if (options.workspaceOnly && target !== root && !target.startsWith(root + sep)) {
    throw new RannError("E_PERMISSION", `Path keluar workspace ditolak: ${path}`, { data: { path } });
  }
  return target;
}
