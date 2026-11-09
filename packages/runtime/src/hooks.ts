import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { RannError } from "@rann/shared";

export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "ToolError",
  "PreTask",
  "PostTask",
  "AgentSpawn",
  "AgentComplete",
  "MemoryWrite",
  "SkillLoad",
  "ContextCompact",
  "Stop",
  "PreCompact",
  "Notification"
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];
export type HookKind = "command" | "http" | "script" | "plugin";
export type HookDecision = "allow" | "deny" | "modify";

export interface HookConfig {
  event: HookEvent;
  kind: HookKind;
  command?: string;
  url?: string;
  path?: string;
  plugin?: string;
  timeout_ms?: number;
  on_error?: "block" | "warn" | "ignore";
  priority?: number;
  enabled?: boolean;
  permissions?: string[];
}

export interface HookPayload {
  event: HookEvent;
  session_id?: string;
  turn_id?: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  [key: string]: unknown;
}

export interface HookOutcome {
  event: HookEvent;
  hook: string;
  decision: HookDecision;
  reason?: string;
  modified?: unknown;
  duration_ms: number;
  error?: string;
  skipped?: boolean;
  payload?: unknown;
}

export interface HookResult {
  allowed: boolean;
  outcomes: HookOutcome[];
  modified?: unknown;
}

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
  signal?: AbortSignal;
}

const MAX_OUTPUT = 64_000;
const DEFAULT_TIMEOUT = 10_000;

function clip(value: string): string {
  return value.length > MAX_OUTPUT ? value.slice(0, MAX_OUTPUT) : value;
}

function parseDecision(text: string): { decision: HookDecision; reason?: string; modified?: unknown } {
  const trimmed = text.trim();
  if (!trimmed) return { decision: "allow" };
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const decision = parsed.decision;
    if (decision === "deny") return { decision: "deny", reason: typeof parsed.reason === "string" ? parsed.reason : "ditolak hook" };
    if (decision === "modify") return { decision: "modify", modified: parsed.modified ?? parsed.args ?? parsed, ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}) };
    return { decision: "allow", ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}) };
  } catch {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("deny") || lower === "block") return { decision: "deny", reason: trimmed.slice(0, 200) };
    return { decision: "allow" };
  }
}

function sanitizedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const blocked = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  for (const [key, value] of Object.entries(extra)) {
    if (!blocked.test(key) && value !== undefined) env[key] = value;
  }
  return env;
}

async function runProcess(
  command: string,
  args: string[],
  payload: string,
  options: RunOptions,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: sanitizedEnv(options.env),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new RannError("E_TIMEOUT", `Hook melewati batas ${timeoutMs} ms`));
    }, timeoutMs);
    const abort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new RannError("E_CANCELLED", "Hook dibatalkan"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolvePromise({ stdout: clip(stdout), stderr: clip(stderr), code: code ?? 1 });
    });
    child.stdin.on("error", () => {
      // Hook boleh menutup stdin tanpa membacanya; EPIPE bukan kegagalan.
    });
    child.stdin.end(payload);
  });
}

function scriptCommand(path: string): { command: string; args: string[] } {
  const ext = extname(path).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return { command: process.execPath, args: [path] };
  if (ext === ".py") return { command: process.platform === "win32" ? "python" : "python3", args: [path] };
  if (ext === ".sh") return { command: process.platform === "win32" ? "bash" : "sh", args: [path] };
  return { command: path, args: [] };
}

export class HookRunner {
  constructor(
    private readonly hooks: HookConfig[],
    private readonly options: { projectRoot: string; pluginRoot?: string; env?: NodeJS.ProcessEnv } = { projectRoot: process.cwd() }
  ) {}

  list(): HookConfig[] {
    return [...this.hooks].filter((hook) => hook.enabled !== false).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  validate(): Array<{ index: number; errors: string[] }> {
    const results: Array<{ index: number; errors: string[] }> = [];
    this.hooks.forEach((hook, index) => {
      const errors: string[] = [];
      if (!HOOK_EVENTS.includes(hook.event)) errors.push(`event tidak dikenal: ${hook.event}`);
      if (!["command", "http", "script", "plugin"].includes(hook.kind)) errors.push(`kind tidak dikenal: ${hook.kind}`);
      if (hook.kind === "command" && !hook.command) errors.push("command kosong");
      if (hook.kind === "http" && !hook.url) errors.push("url kosong");
      if (hook.kind === "script" && !hook.path) errors.push("path kosong");
      if (hook.kind === "plugin" && !hook.plugin) errors.push("plugin kosong");
      if ((hook.timeout_ms ?? DEFAULT_TIMEOUT) < 100 || (hook.timeout_ms ?? DEFAULT_TIMEOUT) > 120_000) errors.push("timeout harus 100-120000 ms");
      if (errors.length > 0) results.push({ index, errors });
    });
    return results;
  }

  async run(event: HookEvent, payload: Omit<HookPayload, "event">, options: RunOptions = {}): Promise<HookResult> {
    const outcomes: HookOutcome[] = [];
    let modified: unknown;
    let allowed = true;
    for (const hook of this.list().filter((item) => item.event === event)) {
      const started = Date.now();
      const label = hook.kind === "http" ? (hook.url ?? "http") : hook.kind === "plugin" ? (hook.plugin ?? "plugin") : (hook.command ?? hook.path ?? "hook");
      if (options.dryRun === true) {
        outcomes.push({ event, hook: label, decision: "allow", duration_ms: 0, skipped: true, payload: { ...payload, event } });
        continue;
      }
      const body = JSON.stringify({ ...payload, event, ...(modified !== undefined ? { modified } : {}) });
      try {
        let output = "";
        if (hook.kind === "http") {
          const response = await fetch(hook.url!, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            signal: AbortSignal.timeout(hook.timeout_ms ?? DEFAULT_TIMEOUT)
          });
          output = await response.text();
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${output.slice(0, 200)}`);
        } else if (hook.kind === "script") {
          const path = resolve(this.options.projectRoot, hook.path!);
          if (!existsSync(path)) throw new Error(`skrip tidak ditemukan: ${path}`);
          const { command, args } = scriptCommand(path);
          const result = await runProcess(command, args, body, { ...options, cwd: options.cwd ?? this.options.projectRoot }, hook.timeout_ms ?? DEFAULT_TIMEOUT);
          if (result.code !== 0) throw new Error(`skrip keluar ${result.code}: ${result.stderr.slice(0, 200)}`);
          output = result.stdout;
        } else if (hook.kind === "plugin") {
          const manifestPath = join(this.options.pluginRoot ?? join(this.options.projectRoot, ".rann", "plugins"), hook.plugin!, "manifest.json");
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { entry?: string; hooks?: Record<string, string> };
          const command = manifest.hooks?.[event];
          if (!command) {
            outcomes.push({ event, hook: label, decision: "allow", duration_ms: Date.now() - started, skipped: true });
            continue;
          }
          const entry = resolve(join(manifestPath, ".."), manifest.entry ?? "index.js");
          const result = await runProcess(process.execPath, [entry, command], body, { ...options, cwd: options.cwd ?? this.options.projectRoot }, hook.timeout_ms ?? DEFAULT_TIMEOUT);
          if (result.code !== 0) throw new Error(`plugin keluar ${result.code}: ${result.stderr.slice(0, 200)}`);
          output = result.stdout;
        } else {
          const command = hook.command!;
          const shell = process.platform === "win32" ? "cmd" : "sh";
          const args = process.platform === "win32" ? ["/c", command] : ["-c", command];
          const result = await runProcess(shell, args, body, { ...options, cwd: options.cwd ?? this.options.projectRoot }, hook.timeout_ms ?? DEFAULT_TIMEOUT);
          if (result.code !== 0) throw new Error(`command keluar ${result.code}: ${result.stderr.slice(0, 200)}`);
          output = result.stdout;
        }
        const parsed = parseDecision(output);
        if (parsed.decision === "deny") allowed = false;
        if (parsed.decision === "modify") modified = parsed.modified;
        outcomes.push({ event, hook: label, ...parsed, duration_ms: Date.now() - started });
        if (parsed.decision === "deny") break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const mode = hook.on_error ?? "warn";
        outcomes.push({ event, hook: label, decision: mode === "block" ? "deny" : "allow", reason: message, error: message, duration_ms: Date.now() - started });
        if (mode === "block") {
          allowed = false;
          break;
        }
      }
    }
    return { allowed, outcomes, ...(modified !== undefined ? { modified } : {}) };
  }
}

export { parseDecision };
