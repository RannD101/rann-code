import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, globSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { RannError } from "@rann/shared";
import type { PermissionMode } from "@rann/shared";
import type { Db } from "@rann/storage";
import { parseTestSummary } from "../test-summary.js";
import { appendAudit, getActiveGoal, renderGoal, updateGoalProgress, listProcedures, recordProcedureResult, upsertProcedure } from "@rann/storage";
import {
  acquirePathLease,
  heartbeatPathLease,
  createTransaction,
  finishTransaction,
  recordFileChange,
  releasePathLease,
  type TransactionRow
} from "@rann/storage";
import { assertAllowed, resolveInsideWorkspace, type ToolRisk } from "../policy.js";
import { commitMessage, runGit, safeGitPath } from "../git.js";
import {
  createFileCheckpoint,
  listFileCheckpoints,
  restoreFileCheckpoint
} from "../checkpoint-files.js";
import { applyFileTransaction, searchCode, type FileChange, type TransactionFile } from "../code-tools.js";
import { searchSymbols } from "../symbol-index.js";
import { ensureProjectMap, projectMapSummary } from "../project-map.js";
import type { ToolSpec } from "../providers/types.js";
import type { MemoryService } from "../memory.js";
import type { BrowserActionInput } from "../browser.js";
import { httpFetch, webSearch } from "../web.js";
import { detectPackageManager, documentExtract, imageInfo, imageTransform, packageCommand, sqliteQuery, systemInfo } from "../system-tools.js";
import type { SkillStore } from "../skills.js";
import { runCustomTool, type CustomTool } from "../custom-tools.js";

export interface ToolContext {
  workspaceRoot: string;
  workspaceOnly: boolean;
  permissionMode: PermissionMode;
  approved: boolean;
  sessionId?: string;
  agentId?: string;
  turnId?: string;
  db?: Db;
  checkpointsDir?: string;
  artifactsDir?: string;
  allow?: string[];
  deny?: string[];
  signal?: AbortSignal;
  shellTimeoutMs?: number;
  memory?: MemoryService;
  hooks?: { run(event: "MemoryWrite", payload: Record<string, unknown>, options?: { cwd?: string }): Promise<unknown> };
  skills?: SkillStore;
  delegate?: (input: { goal: string; context?: string; label?: string; profile?: string; background?: boolean; maxSteps?: number; acceptance?: string; files?: string[]; timeoutMs?: number; contextMode?: "shared" | "isolated" }) => Promise<unknown>;
  agentMessage?: (input: { to: string; type: "note" | "question" | "answer" | "conflict"; subject: string; body: string; priority?: "low" | "normal" | "high"; refs?: string[] }) => Promise<unknown>;
  planRevise?: (input: {
    reason: string;
    goal?: string;
    tasks: Array<{
      id: string;
      title: string;
      description?: string;
      agent: string;
      dependsOn: string[];
      files: string[];
      risk: "low" | "medium" | "high";
      acceptance: string;
    }>;
  }) => Promise<unknown>;
  mcp?: {
    callTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
    permissionFor?(name: string): "read" | "write" | "exec";
  };
  plugins?: {
    list(): Array<{ name: string; version: string; status: string; permissions: string[] }>;
    invoke(name: string, method: string, params: unknown, timeoutMs?: number): Promise<{ ok: boolean; output?: unknown; error?: string }>;
  };
  browser?: {
    perform(taskKey: string, input: BrowserActionInput, options?: { mutating?: boolean; persistent?: boolean }): Promise<Record<string, unknown>>;
  };
  scheduleTask?: (input: { text: string; priority?: number; delaySeconds?: number; idempotencyKey?: string }) => Promise<unknown>;
  sendMessage?: (chatId: number, text: string, threadId?: number) => Promise<unknown>;
  customTools?: CustomTool[];
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  code?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface ToolDefinition {
  spec: ToolSpec;
  risk: ToolRisk;
  run(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

const MAX_READ_CHARS = 200_000;
const MAX_OUTPUT_CHARS = 100_000;

function textResult(output: unknown): ToolResult {
  return { ok: true, output };
}

function relPath(ctx: ToolContext, absolute: string): string {
  return relative(ctx.workspaceRoot, absolute) || ".";
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

const MAX_SNAPSHOT_CHARS = 200_000;
const MAX_DIFF_DB_CHARS = 100_000;
const MAX_DIFF_OUTPUT_CHARS = 8_000;
const LEASE_TTL_MS = 300_000;

function clipSnapshot(text: string | null): string | null {
  if (text === null || text.length <= MAX_SNAPSHOT_CHARS) return text;
  return `${text.slice(0, MAX_SNAPSHOT_CHARS)}\n...[dipotong ${text.length - MAX_SNAPSHOT_CHARS} karakter]`;
}

function clipDiff(text: string): string {
  if (text.length <= MAX_DIFF_DB_CHARS) return text;
  return `${text.slice(0, MAX_DIFF_DB_CHARS)}\n...[diff dipotong ${text.length - MAX_DIFF_DB_CHARS} karakter]`;
}

function diffForOutput(text: string): { diff: string; diff_truncated: boolean } {
  if (text.length <= MAX_DIFF_OUTPUT_CHARS) return { diff: text, diff_truncated: false };
  return { diff: `${text.slice(0, MAX_DIFF_OUTPUT_CHARS)}\n...[diff dipotong]`, diff_truncated: true };
}

const leaseHeartbeats = new Map<string, NodeJS.Timeout>();

function leaseKey(sessionId: string, path: string): string {
  return `${sessionId}:${path}`;
}

function acquireLeases(ctx: ToolContext, paths: string[]): string[] {
  if (!ctx.db || !ctx.sessionId) return [];
  const acquired: string[] = [];
  for (const path of [...new Set(paths)]) {
    const lease = acquirePathLease(ctx.db, {
      path,
      ...(ctx.agentId ? { ownerAgentId: ctx.agentId } : {}),
      sessionId: ctx.sessionId,
      ttlMs: LEASE_TTL_MS
    });
    if (!lease.ok) {
      for (const held of acquired) releasePathLease(ctx.db, held, ctx.sessionId);
      throw new RannError("E_LEASE_CONFLICT", `Berkas sedang dipegang agen lain: ${relPath(ctx, path)}`, {
        data: {
          path: relPath(ctx, path),
          owner_agent_id: lease.lease.owner_agent_id,
          owner_session_id: lease.lease.session_id,
          expires_at: lease.lease.expires_at
        }
      });
    }
    acquired.push(path);
    if (ctx.sessionId) {
      const key = leaseKey(ctx.sessionId, path);
      const timer = setInterval(() => {
        try {
          heartbeatPathLease(ctx.db!, path, ctx.sessionId!, LEASE_TTL_MS);
        } catch {
          // heartbeat lease bersifat best effort
        }
      }, Math.max(1_000, Math.floor(LEASE_TTL_MS / 3)));
      timer.unref?.();
      leaseHeartbeats.set(key, timer);
    }
  }
  return acquired;
}

function releaseLeases(ctx: ToolContext, paths: string[]): void {
  if (ctx.sessionId) {
    for (const path of paths) {
      const key = leaseKey(ctx.sessionId, path);
      const timer = leaseHeartbeats.get(key);
      if (timer) clearInterval(timer);
      leaseHeartbeats.delete(key);
    }
  }
  if (!ctx.db || !ctx.sessionId) return;
  for (const path of paths) releasePathLease(ctx.db, path, ctx.sessionId, ctx.agentId);
}

function heartbeatLeases(ctx: ToolContext, paths: string[]): void {
  if (!ctx.db || !ctx.sessionId) return;
  for (const path of paths) heartbeatPathLease(ctx.db, path, ctx.sessionId, LEASE_TTL_MS);
}

function beginTransaction(ctx: ToolContext, summary: unknown): TransactionRow | null {
  if (!ctx.db || !ctx.sessionId) return null;
  return createTransaction(ctx.db, {
    sessionId: ctx.sessionId,
    ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
    summary
  });
}

function recordChanges(
  ctx: ToolContext,
  transaction: TransactionRow | null,
  files: TransactionFile[],
  status: "applied" | "reverted" | "failed"
): void {
  if (!ctx.db || !ctx.sessionId || !transaction) return;
  for (const file of files) {
    if (file.status === "unchanged") continue;
    recordFileChange(ctx.db, {
      transactionId: transaction.id,
      sessionId: ctx.sessionId,
      ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
      path: file.path,
      beforeHash: file.before_sha256,
      afterHash: file.after_sha256,
      beforeText: clipSnapshot(file.before_text ?? null),
      afterText: clipSnapshot(file.after_text ?? null),
      diffText: clipDiff(file.diff),
      status
    });
  }
}

function finishTransactionSafe(
  ctx: ToolContext,
  transaction: TransactionRow | null,
  status: "committed" | "rolled_back" | "failed",
  summary: unknown
): void {
  if (!ctx.db || !transaction) return;
  finishTransaction(ctx.db, transaction.id, status, summary);
}

const BINARY_SAMPLE = 8_192;

function assertTextFile(path: string, label: string): void {
  const head = readFileSync(path).subarray(0, BINARY_SAMPLE);
  if (head.includes(0)) throw new RannError("E_TOOL_FAILED", `Berkas biner tidak didukung: ${label}`);
}

const fsReadSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(10_000).optional()
});

const fsListSchema = z.object({
  path: z.string().optional(),
  depth: z.number().int().min(1).max(4).optional(),
  limit: z.number().int().min(1).max(2_000).optional()
});

function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)(\/|$)|[._-](test|spec)\.[a-z0-9]+$/i.test(path);
}

function assertionCount(text: string): number {
  return (text.match(/\b(expect|assert|should)\s*\(/g) ?? []).length;
}

const CODE_RENAME_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".kts", ".cs", ".rb", ".php", ".c", ".h", ".cc", ".cpp", ".hpp", ".md", ".json", ".yaml", ".yml", ".toml"]);
const CODE_RENAME_SKIP = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".rann", "vendor", "target"]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walkRenameFiles(root: string, limit: number): string[] {
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
        if (!CODE_RENAME_SKIP.has(entry.name)) visit(path);
      } else if (entry.isFile() && CODE_RENAME_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) {
        out.push(path);
      }
    }
  };
  visit(root);
  return out;
}

const codeRenameSchema = z.object({
  old_name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, "old_name bukan identifier valid"),
  new_name: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, "new_name bukan identifier valid"),
  path: z.string().min(1).optional(),
  dry_run: z.boolean().optional(),
  max_files: z.number().int().min(1).max(5_000).optional()
});

const MAX_WRITE_BYTES = 5 * 1024 * 1024;

const fsWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(MAX_WRITE_BYTES),
  create_dirs: z.boolean().optional(),
  confirm_large_overwrite: z.boolean().optional(),
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional()
});

const fsEditSchema = z.object({
  path: z.string().min(1),
  old: z.string().min(1).optional(),
  new: z.string().optional(),
  old_string: z.string().min(1).optional(),
  new_string: z.string().optional(),
  all: z.boolean().optional(),
  allow_test_weakening: z.boolean().optional(),
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional()
}).transform((value) => {
  const old = value.old_string ?? value.old;
  const next = value.new_string ?? value.new;
  if (old === undefined || next === undefined) throw new RannError("E_TOOL_INVALID_ARGS", "fs_edit butuh old_string/new_string");
  return { ...value, old, new: next };
});

const fsStatSchema = z.object({
  path: z.string().min(1)
});

const fsGlobSchema = z.object({
  pattern: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(2_000).optional()
});

const fsDeleteSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().optional(),
  hard: z.boolean().optional(),
  allow_test_removal: z.boolean().optional()
});

const shellSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().min(1_000).max(600_000).optional()
});

const gitReadSchema = z.object({
  action: z.enum(["status", "diff", "log", "show", "blame", "branch", "remote"]),
  path: z.string().min(1).optional(),
  staged: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  ref: z.string().min(1).max(200).optional(),
  line_start: z.number().int().min(1).optional(),
  line_end: z.number().int().min(1).optional()
});

const gitWriteSchema = z.object({
  action: z.enum(["stage", "unstage", "commit", "branch_create", "worktree_create", "worktree_remove", "worktree_merge", "push", "pull"]),
  paths: z.array(z.string().min(1)).max(200).optional(),
  all: z.boolean().optional(),
  message: z.string().min(1).max(5_000).optional(),
  name: z.string().min(1).max(200).optional(),
  remote: z.string().min(1).max(120).optional(),
  branch: z.string().min(1).max(200).optional()
});

const checkpointCreateSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  paths: z.array(z.string().min(1)).max(2_000).optional()
});

const checkpointRestoreSchema = z.object({
  id: z.string().min(1).max(120),
  force: z.boolean().optional()
});

const repoMapSchema = z.object({
  refresh: z.boolean().optional(),
  max_age_ms: z.number().int().min(0).optional()
});

const searchCodeSchema = z.object({
  query: z.string().min(1).max(2_000),
  regex: z.boolean().optional(),
  case_sensitive: z.boolean().optional(),
  glob: z.string().min(1).max(500).optional(),
  max_results: z.number().int().min(1).max(500).optional()
});

const transactionSchema = z.object({
  changes: z
    .array(
      z.object({
        path: z.string().min(1).max(4_000),
        content: z.string().max(5_000_000),
        expected_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional()
      })
    )
    .min(1)
    .max(100),
  dry_run: z.boolean().optional()
});

const projectCheckSchema = z.object({
  action: z.enum(["test", "lint", "build", "typecheck"]),
  timeout_ms: z.number().int().min(1_000).max(600_000).optional()
});

const goalUpdateSchema = z.object({
  action: z.string().max(2_000).optional(),
  tool: z.string().max(200).optional(),
  note: z.string().max(4_000).optional(),
  complete: z
    .array(z.object({ id: z.string().min(1).max(40), evidence: z.string().min(1).max(4_000) }))
    .max(50)
    .optional()
});

const memorySchema = z.object({
  action: z.enum(["add", "list", "search", "update", "remove"]),
  text: z.string().min(1).max(4_000).optional(),
  id: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  scope: z.enum(["global", "project", "all"]).optional(),
  kind: z.string().min(1).max(40).optional(),
  tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  limit: z.number().int().min(1).max(100).optional()
});

const procedureSchema = z.object({
  action: z.enum(["list", "save", "result", "promote"]),
  name: z.string().min(3).max(80).optional(),
  trigger: z.string().min(3).max(300).optional(),
  prerequisites: z.array(z.string().max(300)).max(20).optional(),
  steps: z.string().min(10).max(20_000).optional(),
  verification: z.string().min(3).max(2_000).optional(),
  id: z.string().min(1).optional(),
  ok: z.boolean().optional(),
  status: z.enum(["candidate", "active", "stale", "rejected"]).optional()
});

const skillSchema = z.object({
  action: z.enum(["list", "view", "create", "remove", "select", "edit", "history", "rollback", "validate", "run", "reference"]),
  name: z.string().min(1).max(64).optional(),
  description: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(60_000).optional(),
  scope: z.enum(["global", "project"]).optional(),
  overwrite: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  task: z.string().min(3).max(8_000).optional(),
  triggers: z.array(z.string().min(1).max(80)).max(20).optional(),
  dependencies: z.array(z.string().min(1).max(64)).max(20).optional(),
  version: z.string().min(1).max(40).optional(),
  file: z.string().min(1).max(500).optional(),
  reason: z.string().min(1).max(500).optional(),
  script: z.string().min(1).max(200).optional(),
  args: z.array(z.string().max(2_000)).max(50).optional(),
  timeout_ms: z.number().int().min(1_000).max(600_000).optional()
});

const browserSchema = z.object({
  action: z.enum(["navigate", "click", "type", "scroll", "select", "screenshot", "extract", "download", "upload", "evaluate", "wait", "close"]),
  url: z.string().url().optional(),
  selector: z.string().max(2_000).optional(),
  text: z.string().max(20_000).optional(),
  value: z.string().max(20_000).optional(),
  path: z.string().max(4_000).optional(),
  script: z.string().max(8_000).optional(),
  delta_y: z.number().int().min(-20_000).max(20_000).optional(),
  timeout_ms: z.number().int().min(1_000).max(120_000).optional(),
  full_page: z.boolean().optional(),
  persistent: z.boolean().optional()
});

const webSearchSchema = z.object({
  query: z.string().min(2).max(500),
  limit: z.number().int().min(1).max(20).optional()
});

const httpRequestSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "HEAD", "POST"]).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().max(500_000).optional(),
  max_chars: z.number().int().min(100).max(200_000).optional(),
  ignore_robots: z.boolean().optional()
});

const databaseQuerySchema = z.object({
  path: z.string().min(1),
  sql: z.string().min(1).max(50_000),
  params: z.array(z.union([z.string(), z.number(), z.null()])).max(100).optional()
});

const documentSchema = z.object({ path: z.string().min(1) });

const imageInfoSchema = z.object({ path: z.string().min(1), ocr: z.boolean().optional() });

const imageTransformSchema = z.object({
  path: z.string().min(1),
  output: z.string().min(1),
  width: z.number().int().min(1).max(20_000).optional(),
  height: z.number().int().min(1).max(20_000).optional(),
  crop: z.string().regex(/^\d{1,5}x\d{1,5}[+-]\d{1,5}[+-]\d{1,5}$/).optional()
});

const packageSchema = z.object({
  manager: z.enum(["npm", "pnpm", "yarn"]).optional(),
  args: z.array(z.string().max(500)).min(1).max(30),
  cwd: z.string().optional()
});

const scheduleTaskSchema = z.object({
  text: z.string().min(1).max(100_000),
  priority: z.number().int().min(0).max(1_000).optional(),
  delay_seconds: z.number().int().min(0).max(2_592_000).optional(),
  idempotency_key: z.string().min(8).max(200).optional()
});

const messagingSendSchema = z.object({
  chat_id: z.number().int().positive(),
  text: z.string().min(1).max(12_000),
  thread_id: z.number().int().positive().optional()
});

const agentMessageSchema = z.object({
  to: z.string().min(1),
  type: z.enum(["note", "question", "answer", "conflict"]),
  subject: z.string().min(3).max(200),
  body: z.string().min(1).max(8_000),
  priority: z.enum(["low", "normal", "high"]).optional(),
  refs: z.array(z.string()).max(20).optional()
});

const taskSchema = z.object({
  goal: z.string().min(5).max(8_000),
  context: z.string().max(20_000).optional(),
  label: z.string().min(1).max(80).optional(),
  profile: z.string().min(1).max(64).optional(),
  background: z.boolean().optional(),
  max_steps: z.number().int().min(1).max(30).optional(),
  acceptance: z.string().max(8_000).optional(),
  context_mode: z.enum(["shared", "isolated"]).optional(),
  files: z.array(z.string().max(500)).max(100).optional(),
  timeout_ms: z.number().int().min(1_000).max(3_600_000).optional()
});

const planReviseSchema = z.object({
  reason: z.string().min(10).max(2_000),
  goal: z.string().min(5).max(4_000).optional(),
  tasks: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        title: z.string().min(3).max(200),
        description: z.string().max(4_000).optional(),
        agent: z.string().min(1).max(64).default("coder"),
        depends_on: z.array(z.string().min(1).max(80)).max(20).default([]),
        files: z.array(z.string().min(1).max(500)).max(50).default([]),
        risk: z.enum(["low", "medium", "high"]).default("low"),
        acceptance: z.string().min(1).max(2_000)
      })
    )
    .min(1)
    .max(30)
});

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".rann", ".next", "target", "vendor"]);

const SENSITIVE_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;

function sanitizedShellEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || SENSITIVE_ENV.test(name)) continue;
    env[name] = value;
  }
  return { ...env, ...extra };
}

function parse<T extends z.ZodTypeAny>(schema: T, args: unknown, tool: string): z.infer<T> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new RannError("E_TOOL_INVALID_ARGS", `Argumen ${tool} tidak valid: ${parsed.error.issues.map((issue) => issue.path.join(".") + " " + issue.message).join("; ")}`);
  }
  return parsed.data;
}

export const tools: ToolDefinition[] = [
  {
    risk: "read",
    spec: {
      name: "fs_read",
      description: "Baca berkas teks di workspace. offset dan limit dalam satuan baris.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relatif terhadap workspace" },
          offset: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 10000 }
        },
        required: ["path"]
      }
    },
    async run(args, ctx) {
      const input = parse(fsReadSchema, args, "fs_read");
      const target = resolveInsideWorkspace(input.path, ctx);
      if (!existsSync(target)) throw new RannError("E_TOOL_FAILED", `Berkas tidak ditemukan: ${input.path}`);
      const stat = statSync(target);
      if (stat.isDirectory()) throw new RannError("E_TOOL_FAILED", `${input.path} adalah direktori, pakai fs_list`);
      if (stat.size > 5 * 1024 * 1024) throw new RannError("E_TOOL_FAILED", `Berkas terlalu besar: ${stat.size} byte`);
      assertTextFile(target, input.path);
      const raw = readFileSync(target, "utf8");
      const lines = raw.split("\n");
      const offset = input.offset ?? 1;
      const limit = input.limit ?? 2_000;
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      let content = slice.join("\n");
      let truncated = false;
      if (content.length > MAX_READ_CHARS) {
        content = content.slice(0, MAX_READ_CHARS);
        truncated = true;
      }
      return textResult({
        path: relPath(ctx, target),
        offset,
        lines: slice.length,
        total_lines: lines.length,
        truncated,
        sha256: sha256(raw),
        content
      });
    }
  },
  {
    risk: "read",
    spec: {
      name: "fs_list",
      description: "Daftar isi direktori di workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          depth: { type: "integer", minimum: 1, maximum: 4 },
          limit: { type: "integer", minimum: 1, maximum: 2000 }
        }
      }
    },
    async run(args, ctx) {
      const input = parse(fsListSchema, args, "fs_list");
      const target = resolveInsideWorkspace(input.path ?? ".", ctx);
      if (!existsSync(target)) throw new RannError("E_TOOL_FAILED", `Direktori tidak ditemukan: ${input.path ?? "."}`);
      const limit = input.limit ?? 500;
      const maxDepth = input.depth ?? 1;
      const entries: Array<{ path: string; type: "file" | "dir"; size?: number }> = [];
      const walk = (dir: string, depth: number): void => {
        if (entries.length >= limit || depth > maxDepth) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === ".git" || IGNORED_DIRS.has(entry.name)) continue;
          const full = `${dir}/${entry.name}`;
          if (entry.isDirectory()) {
            entries.push({ path: relPath(ctx, full), type: "dir" });
            walk(full, depth + 1);
          } else {
            entries.push({ path: relPath(ctx, full), type: "file", size: statSync(full).size });
          }
          if (entries.length >= limit) return;
        }
      };
      walk(target, 1);
      return textResult({ path: relPath(ctx, target), count: entries.length, truncated: entries.length >= limit, entries });
    }
  },
  {
    risk: "write",
    spec: {
      name: "fs_write",
      description: "Tulis berkas di workspace, menimpa isi lama.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          create_dirs: { type: "boolean" },
          confirm_large_overwrite: { type: "boolean", description: "Wajib bila menimpa berkas lebih dari 1 MB" },
          expected_sha256: { type: "string", description: "Hash isi lama; wajib jika menimpa berkas yang sudah ada" }
        },
        required: ["path", "content"]
      }
    },
    async run(args, ctx) {
      const input = parse(fsWriteSchema, args, "fs_write");
      assertAllowed({ mode: ctx.permissionMode, tool: "fs_write", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      const target = resolveInsideWorkspace(input.path, ctx);
      const largeLimit = 1024 * 1024;
      if (input.confirm_large_overwrite !== true) {
        const existingSize = existsSync(target) && statSync(target).isFile() ? statSync(target).size : 0;
        const nextSize = Buffer.byteLength(input.content, "utf8");
        if (existingSize > largeLimit || nextSize > largeLimit) {
          throw new RannError("E_APPROVAL_REQUIRED", `Menimpa berkas besar (${Math.max(existingSize, nextSize)} byte) butuh confirm_large_overwrite=true.`);
        }
      }
      if (input.create_dirs === false && !existsSync(dirname(target))) {
        throw new RannError("E_TOOL_FAILED", `Folder induk tidak ada: ${input.path}`);
      }
      const leases = acquireLeases(ctx, [target]);
      const transaction = beginTransaction(ctx, { tool: "fs_write", path: input.path });
      heartbeatLeases(ctx, leases);
      try {
        if (existsSync(target)) {
          assertTextFile(target, input.path);
          if (!input.expected_sha256 && statSync(target).size > 1024 * 1024) {
            throw new RannError("E_FILE_CHANGED", `Berkas ${input.path} lebih dari 1 MB. Sertakan expected_sha256 dari fs_read sebelum menimpa.`);
          }
        }
        const applied = applyFileTransaction(
          ctx.workspaceRoot,
          [{
            path: input.path,
            content: input.content,
            ...(input.expected_sha256 ? { expected_sha256: input.expected_sha256 } : {})
          }],
          { workspaceOnly: ctx.workspaceOnly, includeText: true }
        );
        recordChanges(ctx, transaction, applied.files, "applied");
        finishTransactionSafe(ctx, transaction, "committed", {
          tool: "fs_write",
          path: input.path,
          files: applied.files.map((file) => ({ path: file.path, status: file.status, lines_before: file.lines_before, lines_after: file.lines_after, lines_added: file.lines_added, lines_removed: file.lines_removed }))
        });
        const file = applied.files[0]!;
        const visible = diffForOutput(file.diff);
        return textResult({
          path: file.path,
          bytes: Buffer.byteLength(input.content, "utf8"),
          sha256: file.after_sha256,
          status: file.status,
          transaction_id: transaction?.id ?? null,
          ...visible
        });
      } catch (error) {
        finishTransactionSafe(ctx, transaction, "failed", {
          tool: "fs_write",
          path: input.path,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        releaseLeases(ctx, leases);
      }
    }
  },
  {
    risk: "write",
    spec: {
      name: "fs_edit",
      description: "Ganti teks persis di berkas. Gagal kalau teks lama tidak ditemukan atau muncul lebih dari sekali tanpa all=true.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string", description: "Teks lama; wajib unik." },
          new_string: { type: "string", description: "Teks pengganti." },
          old: { type: "string", description: "Alias lama untuk old_string." },
          new: { type: "string", description: "Alias lama untuk new_string." },
          all: { type: "boolean", description: "Diabaikan; edit selalu menolak kemunculan ganda." },
          allow_test_weakening: { type: "boolean", description: "Izinkan penghapusan assertion pada berkas tes; butuh alasan eksplisit." }
        },
        required: ["path"]
      }
    },
    async run(args, ctx) {
      const input = parse(fsEditSchema, args, "fs_edit");
      assertAllowed({ mode: ctx.permissionMode, tool: "fs_edit", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      const target = resolveInsideWorkspace(input.path, ctx);
      const leases = acquireLeases(ctx, [target]);
      const transaction = beginTransaction(ctx, { tool: "fs_edit", path: input.path });
      try {
        if (!existsSync(target)) throw new RannError("E_TOOL_FAILED", `Berkas tidak ditemukan: ${input.path}`);
        assertTextFile(target, input.path);
        const before = readFileSync(target, "utf8");
        if (input.expected_sha256 && sha256(before) !== input.expected_sha256.toLowerCase()) {
          throw new RannError("E_FILE_CHANGED", `Berkas ${input.path} berubah sejak dibaca. Baca ulang sebelum mengedit.`, {
            data: { path: input.path, expected: input.expected_sha256, actual: sha256(before) }
          });
        }
        const occurrences = before.split(input.old).length - 1;
        if (occurrences === 0) throw new RannError("E_TOOL_FAILED", "Teks lama tidak ditemukan");
        if (occurrences > 1) {
          throw new RannError("E_TOOL_FAILED", `Teks lama muncul ${occurrences} kali. Perjelas konteks agar hanya satu kemunculan.`);
        }
        const after = before.replace(input.old, input.new);
        if (isTestPath(input.path) && input.allow_test_weakening !== true && assertionCount(after) < assertionCount(before)) {
          throw new RannError("E_PERMISSION", `Edit mengurangi jumlah assertion di ${input.path}. Set allow_test_weakening=true hanya bila tes lama memang salah.`);
        }
        const applied = applyFileTransaction(
          ctx.workspaceRoot,
          [{ path: input.path, content: after, expected_sha256: sha256(before) }],
          { workspaceOnly: ctx.workspaceOnly, includeText: true }
        );
        recordChanges(ctx, transaction, applied.files, "applied");
        finishTransactionSafe(ctx, transaction, "committed", {
          tool: "fs_edit",
          path: input.path,
          files: applied.files.map((file) => ({ path: file.path, status: file.status, lines_before: file.lines_before, lines_after: file.lines_after, lines_added: file.lines_added, lines_removed: file.lines_removed }))
        });
        const file = applied.files[0]!;
        const visible = diffForOutput(file.diff);
        return textResult({
          path: file.path,
          replacements: input.all === true ? occurrences : 1,
          sha256: file.after_sha256,
          before_sha256: file.before_sha256,
          status: file.status,
          lines_before: file.lines_before,
          lines_after: file.lines_after,
          lines_added: file.lines_added,
          lines_removed: file.lines_removed,
          transaction_id: transaction?.id ?? null,
          ...visible
        });
      } catch (error) {
        finishTransactionSafe(ctx, transaction, "failed", {
          tool: "fs_edit",
          path: input.path,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        releaseLeases(ctx, leases);
      }
    }
  },
  {
    risk: "read",
    spec: {
      name: "fs_stat",
      description: "Statistik berkas atau direktori: ukuran, mtime, mode, dan sha256 untuk berkas teks.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"]
      }
    },
    async run(args, ctx) {
      const input = parse(fsStatSchema, args, "fs_stat");
      const target = resolveInsideWorkspace(input.path, ctx);
      if (!existsSync(target)) throw new RannError("E_TOOL_FAILED", `Path tidak ditemukan: ${input.path}`);
      const stat = statSync(target);
      const base = {
        path: relPath(ctx, target),
        type: stat.isDirectory() ? "dir" : "file",
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        mode: stat.mode.toString(8).slice(-4)
      };
      if (stat.isDirectory()) return textResult(base);
      const head = readFileSync(target).subarray(0, BINARY_SAMPLE);
      const binary = head.includes(0);
      return textResult({ ...base, binary, ...(binary ? {} : { sha256: sha256(readFileSync(target)) }) });
    }
  },
  {
    risk: "read",
    spec: {
      name: "fs_glob",
      description: "Cari berkas dengan pola glob relatif workspace, misalnya src/**/*.ts. Folder build dan .git diabaikan.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 2000 }
        },
        required: ["pattern"]
      }
    },
    async run(args, ctx) {
      const input = parse(fsGlobSchema, args, "fs_glob");
      if (input.pattern.startsWith("/") || input.pattern.includes("..")) {
        throw new RannError("E_TOOL_FAILED", "Pola glob harus relatif dan tidak boleh memuat ..");
      }
      const limit = input.limit ?? 500;
      const found = globSync(input.pattern, { cwd: ctx.workspaceRoot })
        .filter((item) => !item.split(/[\\/]/).some((part) => IGNORED_DIRS.has(part)))
        .slice(0, limit + 1);
      const paths: string[] = [];
      for (const item of found.slice(0, limit)) {
        try {
          resolveInsideWorkspace(item, ctx);
          paths.push(item);
        } catch {
          continue;
        }
      }
      return textResult({ pattern: input.pattern, count: paths.length, truncated: found.length > limit, paths });
    }
  },
  {
    risk: "write",
    spec: {
      name: "fs_delete",
      description: "Pindahkan berkas atau direktori ke .rann/trash, bukan hapus permanen. Direktori tidak kosong butuh recursive=true.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          recursive: { type: "boolean" },
          hard: { type: "boolean", description: "Hapus permanen tanpa trash; hanya dengan izin eksplisit" },
          allow_test_removal: { type: "boolean", description: "Izinkan penghapusan berkas tes; butuh alasan eksplisit" }
        },
        required: ["path"]
      }
    },
    async run(args, ctx) {
      const input = parse(fsDeleteSchema, args, "fs_delete");
      assertAllowed({ mode: ctx.permissionMode, tool: "fs_delete", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      const target = resolveInsideWorkspace(input.path, ctx);
      if (!existsSync(target)) throw new RannError("E_TOOL_FAILED", `Path tidak ditemukan: ${input.path}`);
      if (relative(ctx.workspaceRoot, target) === "") throw new RannError("E_TOOL_FAILED", "Workspace root tidak boleh dihapus");
      const stat = statSync(target);
      if (stat.isDirectory() && readdirSync(target).length > 0 && input.recursive !== true) {
        throw new RannError("E_TOOL_FAILED", "Direktori tidak kosong. Set recursive=true untuk memindahkan seluruh isinya ke trash.");
      }
      const beforeSha = stat.isFile() ? sha256(readFileSync(target)) : null;
      if (ctx.db !== undefined && ctx.sessionId !== undefined) {
        try {
          appendAudit(ctx.db, {
            actor: "agent",
            action: "fs_delete",
            resource: input.path,
            decision: "ok",
            metadata: {
              session_id: ctx.sessionId,
              turn_id: ctx.turnId ?? null,
              hard: input.hard === true,
              recursive: input.recursive === true,
              before_sha256: beforeSha
            }
          });
        } catch {
          // audit tidak boleh menggagalkan operasi berkas
        }
      }
      if (input.hard === true) {
        if (ctx.approved !== true && ctx.permissionMode !== "trusted") {
          throw new RannError("E_APPROVAL_REQUIRED", "Hapus permanen butuh persetujuan eksplisit. Pakai trash atau setujui lebih dulu.");
        }
        rmSync(target, { recursive: true, force: false });
        return textResult({ path: input.path, type: stat.isDirectory() ? "dir" : "file", hard: true, before_sha256: beforeSha });
      }
      const trashDir = resolveInsideWorkspace(".rann/trash", { ...ctx, workspaceOnly: true });
      mkdirSync(trashDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = target.split(/[\\/]/).pop() ?? "berkas";
      const destination = `${trashDir}/${stamp}-${name}`;
      renameSync(target, destination);
      return textResult({ path: input.path, type: stat.isDirectory() ? "dir" : "file", trash_path: relPath(ctx, destination), before_sha256: beforeSha });
    }
  },
  {
    risk: "read",
    spec: {
      name: "git_read",
      description: "Operasi Git baca: status, diff, log, show, blame, branch, remote. Tidak mengubah working tree.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["status", "diff", "log", "show", "blame", "branch", "remote"] },
          path: { type: "string" },
          staged: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          days: { type: "integer", minimum: 1, maximum: 3_650 },
          ref: { type: "string" },
          line_start: { type: "integer", minimum: 1 },
          line_end: { type: "integer", minimum: 1 }
        },
        required: ["action"]
      }
    },
    async run(args, ctx) {
      const input = parse(gitReadSchema, args, "git_read");
      const cwd = resolveInsideWorkspace(".", ctx);
      let argv: string[];
      if (input.action === "status") argv = ["status", "--short", "--branch"];
      else if (input.action === "diff") {
        argv = ["diff", ...(input.staged ? ["--cached"] : []), ...(input.path ? ["--", safeGitPath(input.path)] : [])];
      } else if (input.action === "log") argv = ["log", "--oneline", "--decorate", "-n", String(input.limit ?? 20)];
      else if (input.action === "show") {
        const ref = input.ref ?? "HEAD";
        if (ref.startsWith("-")) throw new RannError("E_TOOL_FAILED", "ref tidak valid");
        argv = ["show", "--stat", "--oneline", ref];
      } else if (input.action === "blame") {
        if (!input.path) throw new RannError("E_TOOL_INVALID_ARGS", "git_read blame butuh path");
        const range = input.line_start && input.line_end ? ["-L", `${input.line_start},${input.line_end}`] : [];
        argv = ["blame", ...range, "--", safeGitPath(input.path)];
      } else if (input.action === "branch") argv = ["branch", "--list", "--verbose", "--no-abbrev"];
      else argv = ["remote", "-v"];

      const result = await runGit(cwd, argv, { signal: ctx.signal });
      return { ok: result.code === 0, output: { action: input.action, ...result }, exitCode: result.code };
    }
  },
  {
    risk: "write",
    spec: {
      name: "git_write",
      description: "Operasi Git yang mengubah state: stage, unstage, commit, branch, worktree per task, merge dengan deteksi konflik, pull fast-forward, push tanpa force. Commit ditolak saat masih ada konflik.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["stage", "unstage", "commit", "branch_create", "worktree_create", "worktree_remove", "worktree_merge", "push", "pull"] },
          paths: { type: "array", items: { type: "string" } },
          all: { type: "boolean" },
          message: { type: "string" },
          name: { type: "string" },
          remote: { type: "string" },
          branch: { type: "string" }
        },
        required: ["action"]
      }
    },
    async run(args, ctx) {
      const input = parse(gitWriteSchema, args, "git_write");
      assertAllowed({ mode: ctx.permissionMode, tool: "git_write", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      const cwd = resolveInsideWorkspace(".", ctx);
      if (input.action === "stage") {
        const paths = (input.paths ?? []).map(safeGitPath);
        if (paths.length === 0 && input.all !== true) throw new RannError("E_TOOL_INVALID_ARGS", "stage butuh paths atau all=true");
        const argv = paths.length > 0 ? ["add", "--", ...paths] : ["add", "-A"];
        const result = await runGit(cwd, argv, { signal: ctx.signal });
        return { ok: result.code === 0, output: result, exitCode: result.code };
      }
      if (input.action === "unstage") {
        const paths = (input.paths ?? []).map(safeGitPath);
        if (paths.length === 0) throw new RannError("E_TOOL_INVALID_ARGS", "unstage butuh paths");
        const result = await runGit(cwd, ["restore", "--staged", "--", ...paths], { signal: ctx.signal });
        return { ok: result.code === 0, output: result, exitCode: result.code };
      }
      if (input.action === "branch_create") {
        if (!input.name || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(input.name)) {
          throw new RannError("E_TOOL_INVALID_ARGS", "Nama branch tidak valid");
        }
        const result = await runGit(cwd, ["switch", "-c", input.name], { signal: ctx.signal });
        return { ok: result.code === 0, output: result, exitCode: result.code };
      }
      if (input.action === "worktree_create") {
        if (!input.name || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.name)) {
          throw new RannError("E_TOOL_INVALID_ARGS", "Nama worktree tidak valid");
        }
        const branch = input.branch ?? `rann/${input.name}`;
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) throw new RannError("E_TOOL_INVALID_ARGS", "Nama branch worktree tidak valid");
        const existing = await runGit(cwd, ["worktree", "list", "--porcelain"], { signal: ctx.signal });
        if (existing.code !== 0) throw new RannError("E_TOOL_FAILED", existing.stderr || "Gagal membaca worktree");
        const path = `.rann/worktrees/${input.name}`;
        if (existing.stdout.includes(`worktree ${resolveInsideWorkspace(path, ctx)}`)) {
          throw new RannError("E_CONFLICT", `Worktree sudah ada: ${path}`);
        }
        const result = await runGit(cwd, ["worktree", "add", "-b", branch, path], { signal: ctx.signal });
        return { ok: result.code === 0, output: result, exitCode: result.code, worktree: path, branch };
      }
      if (input.action === "worktree_remove") {
        if (!input.name) throw new RannError("E_TOOL_INVALID_ARGS", "worktree_remove butuh name");
        const path = `.rann/worktrees/${input.name}`;
        const status = await runGit(resolveInsideWorkspace(path, ctx), ["status", "--porcelain"], { signal: ctx.signal });
        if (status.code !== 0) throw new RannError("E_NOT_FOUND", `Worktree tidak ditemukan atau bukan repo: ${path}`);
        if (status.stdout.trim().length > 0) throw new RannError("E_CONFLICT", `Worktree ${path} masih kotor; commit atau buang perubahan dulu`);
        const result = await runGit(cwd, ["worktree", "remove", path], { signal: ctx.signal });
        return { ok: result.code === 0, output: result, exitCode: result.code, removed: path };
      }
      if (input.action === "worktree_merge") {
        if (!input.name) throw new RannError("E_TOOL_INVALID_ARGS", "worktree_merge butuh name");
        const branch = input.branch ?? `rann/${input.name}`;
        const status = await runGit(cwd, ["status", "--porcelain"], { signal: ctx.signal });
        if (status.stdout.trim().length > 0) throw new RannError("E_CONFLICT", "Workspace utama kotor; commit atau stash dulu sebelum merge");
        const result = await runGit(cwd, ["merge", "--no-ff", "--no-edit", branch], { signal: ctx.signal });
        const conflicts = await runGit(cwd, ["diff", "--name-only", "--diff-filter=U"], { signal: ctx.signal });
        const files = conflicts.stdout.trim().split("\n").filter(Boolean);
        if (result.code !== 0 && files.length > 0) {
          return { ok: false, output: result, exitCode: result.code, conflicts: files, merge_in_progress: true, hint: "Selesaikan konflik manual lalu commit, atau jalankan git merge --abort." };
        }
        return { ok: result.code === 0, output: result, exitCode: result.code, conflicts: files };
      }
      if (input.action === "pull") {
        const remote = input.remote ?? "origin";
        const branch = input.branch ?? (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], { signal: ctx.signal })).stdout.trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote) || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
          throw new RannError("E_TOOL_INVALID_ARGS", "remote atau branch tidak valid");
        }
        const result = await runGit(cwd, ["pull", "--ff-only", remote, branch], { signal: ctx.signal });
        return { ok: result.code === 0, output: result, exitCode: result.code };
      }
      if (input.action === "push") {
        const remote = input.remote ?? "origin";
        const branch = input.branch ?? (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], { signal: ctx.signal })).stdout.trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote) || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) {
          throw new RannError("E_TOOL_INVALID_ARGS", "remote atau branch tidak valid");
        }
        const result = await runGit(cwd, ["push", remote, branch], { signal: ctx.signal });
        return { ok: result.code === 0, output: result, exitCode: result.code };
      }
      if (!input.message) throw new RannError("E_TOOL_INVALID_ARGS", "commit butuh message");
      const conflicts = await runGit(cwd, ["diff", "--name-only", "--diff-filter=U"], { signal: ctx.signal });
      if (conflicts.code !== 0) throw new RannError("E_TOOL_FAILED", conflicts.stderr || "Gagal memeriksa konflik");
      if (conflicts.stdout.trim().length > 0) {
        throw new RannError("E_TOOL_FAILED", `Commit ditolak, masih ada konflik: ${conflicts.stdout.trim().split("\n").join(", ")}`);
      }
      const result = await runGit(cwd, ["commit", ...commitMessage(input.message, ctx.sessionId)], { signal: ctx.signal });
      return { ok: result.code === 0, output: result, exitCode: result.code };
    }
  },
  {
    risk: "read",
    spec: {
      name: "checkpoint_create",
      description: "Buat snapshot berkas workspace sebelum perubahan berisiko. Snapshot disimpan di profil Rann, bukan di repo.",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string" },
          paths: { type: "array", items: { type: "string" } }
        }
      }
    },
    async run(args, ctx) {
      const input = parse(checkpointCreateSchema, args, "checkpoint_create");
      if (!ctx.checkpointsDir) throw new RannError("E_TOOL_FAILED", "Direktori checkpoint tidak tersedia");
      const manifest = createFileCheckpoint(ctx.workspaceRoot, ctx.checkpointsDir, {
        ...(input.label ? { label: input.label } : {}),
        ...(input.paths ? { paths: input.paths } : {})
      });
      return textResult({ id: manifest.id, label: manifest.label, files: manifest.files.length, bytes: manifest.bytes, truncated: manifest.truncated });
    }
  },
  {
    risk: "read",
    spec: {
      name: "checkpoint_list",
      description: "Daftar checkpoint berkas terbaru beserta label dan jumlah berkas.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 100 } }
      }
    },
    async run(args, ctx) {
      const input = parse(z.object({ limit: z.number().int().min(1).max(100).optional() }), args, "checkpoint_list");
      if (!ctx.checkpointsDir) throw new RannError("E_TOOL_FAILED", "Direktori checkpoint tidak tersedia");
      const items = listFileCheckpoints(ctx.checkpointsDir, input.limit ?? 20).map((item) => ({
        id: item.id,
        label: item.label,
        created_at: item.created_at,
        files: item.files.length,
        bytes: item.bytes
      }));
      return textResult({ count: items.length, checkpoints: items });
    }
  },
  {
    risk: "write",
    spec: {
      name: "checkpoint_restore",
      description: "Kembalikan berkas dari checkpoint. Ditolak bila berkas berubah setelah checkpoint, kecuali force=true.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          force: { type: "boolean" }
        },
        required: ["id"]
      }
    },
    async run(args, ctx) {
      const input = parse(checkpointRestoreSchema, args, "checkpoint_restore");
      assertAllowed({ mode: ctx.permissionMode, tool: "checkpoint_restore", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      if (!ctx.checkpointsDir) throw new RannError("E_TOOL_FAILED", "Direktori checkpoint tidak tersedia");
      const result = restoreFileCheckpoint(ctx.workspaceRoot, ctx.checkpointsDir, input.id, { force: input.force });
      return textResult(result);
    }
  },
  {
    risk: "read",
    spec: {
      name: "repo_map",
      description: "Pindai struktur project: bahasa, package manager, framework, entry point, dan perintah build/test/lint. Simpan ke .rann/project-map.json.",
      parameters: {
        type: "object",
        properties: {
          refresh: { type: "boolean" },
          max_age_ms: { type: "integer", minimum: 0 }
        }
      }
    },
    async run(args, ctx) {
      const input = parse(repoMapSchema, args, "repo_map");
      const map = ensureProjectMap(ctx.workspaceRoot, {
        refresh: input.refresh === true,
        ...(input.max_age_ms !== undefined ? { maxAgeMs: input.max_age_ms } : {})
      });
      return textResult({ summary: projectMapSummary(map), map });
    }
  },
  {
    risk: "read",
    spec: {
      name: "search_code",
      description: "Cari teks atau regex di seluruh workspace. Menghormati folder build, node_modules, dan .git.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          regex: { type: "boolean" },
          case_sensitive: { type: "boolean" },
          glob: { type: "string" },
          max_results: { type: "integer", minimum: 1, maximum: 500 }
        },
        required: ["query"]
      }
    },
    async run(args, ctx) {
      const input = parse(searchCodeSchema, args, "search_code");
      return textResult(
        searchCode(ctx.workspaceRoot, input.query, {
          ...(input.regex !== undefined ? { regex: input.regex } : {}),
          ...(input.case_sensitive !== undefined ? { caseSensitive: input.case_sensitive } : {}),
          ...(input.glob ? { glob: input.glob } : {}),
          ...(input.max_results ? { maxResults: input.max_results } : {})
        })
      );
    }
  },
  {
    risk: "write",
    spec: {
      name: "apply_patch",
      description: "Ubah beberapa berkas dalam satu transaksi. Semua berkas diverifikasi hash-nya sebelum ditulis; gagal berarti tidak ada perubahan.",
      parameters: {
        type: "object",
        properties: {
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
                expected_sha256: { type: "string" }
              },
              required: ["path", "content"]
            }
          },
          dry_run: { type: "boolean" }
        },
        required: ["changes"]
      }
    },
    async run(args, ctx) {
      const input = parse(transactionSchema, args, "apply_patch");
      assertAllowed({ mode: ctx.permissionMode, tool: "apply_patch", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      if (input.dry_run === true) {
        const preview = applyFileTransaction(ctx.workspaceRoot, input.changes, {
          workspaceOnly: ctx.workspaceOnly,
          dryRun: true
        });
        return textResult({
          ...preview,
          files: preview.files.map((file) => ({ ...file, ...diffForOutput(file.diff) })),
          transaction_id: null
        });
      }
      const targets = input.changes.map((change) => resolveInsideWorkspace(change.path, ctx));
      const leases = acquireLeases(ctx, targets);
      const transaction = beginTransaction(ctx, {
        tool: "apply_patch",
        files: input.changes.map((change) => change.path)
      });
      try {
        const result = applyFileTransaction(ctx.workspaceRoot, input.changes, {
          workspaceOnly: ctx.workspaceOnly,
          includeText: true
        });
        recordChanges(ctx, transaction, result.files, "applied");
        finishTransactionSafe(ctx, transaction, "committed", {
          tool: "apply_patch",
          files: result.files.map((file) => ({
            path: file.path,
            status: file.status,
            lines_before: file.lines_before,
            lines_after: file.lines_after
          })),
          bytes: result.bytes
        });
        return textResult({
          files: result.files.map((file) => {
            const visible = { ...file };
            delete visible.before_text;
            delete visible.after_text;
            return { ...visible, ...diffForOutput(file.diff) };
          }),
          bytes: result.bytes,
          rolled_back: result.rolled_back,
          transaction_id: transaction?.id ?? null
        });
      } catch (error) {
        finishTransactionSafe(ctx, transaction, "failed", {
          tool: "apply_patch",
          files: input.changes.map((change) => change.path),
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        releaseLeases(ctx, leases);
      }
    }
  },
  {
    risk: "exec",
    spec: {
      name: "project_check",
      description: "Jalankan test, lint, build, atau typecheck memakai perintah yang terdeteksi dari project.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["test", "lint", "build", "typecheck"] },
          timeout_ms: { type: "integer", minimum: 1000, maximum: 600000 }
        },
        required: ["action"]
      }
    },
    async run(args, ctx) {
      const input = parse(projectCheckSchema, args, "project_check");
      const map = ensureProjectMap(ctx.workspaceRoot);
      const command = map.commands[input.action];
      if (!command) {
        throw new RannError("E_TOOL_FAILED", `Perintah ${input.action} tidak terdeteksi`, {
          data: { assumptions: map.assumptions, scripts: map.scripts }
        });
      }
      assertAllowed({ mode: ctx.permissionMode, tool: "project_check", risk: "exec", command, approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      let result = await executeTool(
        "shell_run",
        {
          command,
          ...(input.timeout_ms !== undefined ? { timeout_ms: input.timeout_ms } : {})
        },
        { ...ctx, approved: true }
      );
      let flaky = false;
      let attempts = 1;
      if (input.action === "test" && !result.ok) {
        for (let retry = 1; retry <= 2; retry += 1) {
          attempts += 1;
          result = await executeTool(
            "shell_run",
            {
              command,
              ...(input.timeout_ms !== undefined ? { timeout_ms: input.timeout_ms } : {})
            },
            { ...ctx, approved: true }
          );
          if (result.ok) {
            flaky = true;
            break;
          }
        }
      }
      const output = result.output as Record<string, unknown> | null;
      const text = output && typeof output === "object"
        ? `${String(output.stdout ?? "")}\n${String(output.stderr ?? "")}`
        : String(result.output ?? "");
      return textResult({
        action: input.action,
        command,
        ...result,
        ...(input.action === "test" ? { summary: { ...parseTestSummary(text), flaky, attempts } } : {})
      });
    }
  },
  {
    risk: "read",
    spec: {
      name: "plan_revise",
      description:
        "Ganti rencana aktif dengan versi baru saat task gagal permanen, dependensi berubah, file target hilang, atau goal berubah. Sertakan alasan dan daftar task yang masih relevan. Task yang sudah selesai dipertahankan otomatis.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Alasan revisi, minimal 10 karakter" },
          goal: { type: "string", description: "Goal baru bila berubah" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                description: { type: "string" },
                agent: { type: "string" },
                depends_on: { type: "array", items: { type: "string" } },
                files: { type: "array", items: { type: "string" } },
                risk: { type: "string", enum: ["low", "medium", "high"] },
                acceptance: { type: "string" }
              },
              required: ["id", "title", "acceptance"]
            }
          }
        },
        required: ["reason", "tasks"]
      }
    },
    async run(args, ctx) {
      const input = parse(planReviseSchema, args, "plan_revise");
      if (!ctx.planRevise) throw new RannError("E_TOOL_FAILED", "Tidak ada rencana aktif untuk direvisi");
      return textResult(
        await ctx.planRevise({
          reason: input.reason,
          ...(input.goal !== undefined ? { goal: input.goal } : {}),
          tasks: input.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            ...(task.description !== undefined ? { description: task.description } : {}),
            agent: task.agent,
            dependsOn: task.depends_on,
            files: task.files,
            risk: task.risk,
            acceptance: task.acceptance
          }))
        })
      );
    }
  },
  {
    risk: "read",
    spec: {
      name: "goal_status",
      description: "Baca goal aktif, langkah, dan kriteria yang belum terpenuhi beserta buktinya.",
      parameters: { type: "object", properties: {} }
    },
    async run(_args, ctx) {
      if (!ctx.db || !ctx.sessionId) throw new RannError("E_TOOL_FAILED", "Goal butuh sesi aktif");
      const goal = getActiveGoal(ctx.db, ctx.sessionId);
      if (!goal) return textResult({ goal: null, note: "belum ada goal aktif" });
      return textResult({ goal, summary: renderGoal(goal) });
    }
  },
  {
    risk: "write",
    spec: {
      name: "goal_update",
      description: "Perbarui progres goal aktif. Goal sendiri tidak bisa diubah; hanya kriteria yang bisa ditandai selesai dengan bukti.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string" },
          tool: { type: "string" },
          note: { type: "string" },
          complete: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, evidence: { type: "string" } },
              required: ["id", "evidence"]
            }
          }
        }
      }
    },
    async run(args, ctx) {
      const input = parse(goalUpdateSchema, args, "goal_update");
      if (!ctx.db || !ctx.sessionId) throw new RannError("E_TOOL_FAILED", "Goal butuh sesi aktif");
      assertAllowed({ mode: ctx.permissionMode, tool: "goal_update", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      const goal = updateGoalProgress(ctx.db, ctx.sessionId, {
        ...(input.action !== undefined ? { action: input.action } : {}),
        ...(input.tool !== undefined ? { tool: input.tool } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.complete !== undefined ? { complete: input.complete } : {})
      });
      if (!goal) throw new RannError("E_TOOL_FAILED", "Goal aktif tidak ditemukan");
      return textResult({ goal, summary: renderGoal(goal) });
    }
  },
  {
    risk: "exec",
    spec: {
      name: "shell_run",
      description: "Jalankan perintah shell di workspace. Output dipotong 100.000 karakter.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeout_ms: { type: "integer", minimum: 1000, maximum: 600000 }
        },
        required: ["command"]
      }
    },
    async run(args, ctx) {
      const input = parse(shellSchema, args, "shell_run");
      assertAllowed({
        mode: ctx.permissionMode,
        tool: "shell_run",
        risk: "exec",
        command: input.command,
        approved: ctx.approved,
        allow: ctx.allow,
        deny: ctx.deny
      });
      if (/\bsudo\b|~\/\.ssh|\.ssh\//i.test(input.command)) {
        throw new RannError("E_PERMISSION", "Perintah sudo atau akses direktori kredensial ditolak");
      }
      const cwd = resolveInsideWorkspace(input.cwd ?? ".", ctx);
      const timeoutMs = input.timeout_ms ?? ctx.shellTimeoutMs ?? 120_000;
      const started = Date.now();
      return await new Promise<ToolResult>((resolvePromise) => {
        const child = spawn("bash", ["-lc", input.command], {
          cwd,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          env: sanitizedShellEnv({ RANN_TOOL: "shell_run" })
        });
        let stdout = "";
        let stderr = "";
        let truncated = false;
        const append = (target: "out" | "err", chunk: Buffer): void => {
          const text = chunk.toString("utf8");
          if (target === "out") {
            if (stdout.length < MAX_OUTPUT_CHARS) stdout += text;
            else truncated = true;
          } else if (stderr.length < MAX_OUTPUT_CHARS) stderr += text;
          else truncated = true;
        };
        child.stdout?.on("data", (chunk: Buffer) => append("out", chunk));
        child.stderr?.on("data", (chunk: Buffer) => append("err", chunk));

        let settled = false;
        const finish = (result: ToolResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ctx.signal?.removeEventListener("abort", onAbort);
          resolvePromise({ ...result, durationMs: Date.now() - started });
        };
        const killTree = (): void => {
          if (child.pid === undefined) return;
          try {
            if (process.platform === "win32") child.kill("SIGKILL");
            else process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        };
        const timer = setTimeout(() => {
          killTree();
          finish({ ok: false, output: { error: "timeout", timeout_ms: timeoutMs, stdout: stdout.slice(0, MAX_OUTPUT_CHARS), stderr }, code: "E_TOOL_TIMEOUT", exitCode: 124 });
        }, timeoutMs);
        const onAbort = (): void => {
          killTree();
          finish({ ok: false, output: { error: "cancelled", stdout, stderr }, exitCode: 130 });
        };
        ctx.signal?.addEventListener("abort", onAbort, { once: true });

        child.on("error", (error) => finish({ ok: false, output: { error: error.message }, exitCode: 127 }));
        child.on("close", (code) => {
          finish({
            ok: code === 0,
            output: { stdout: stdout.slice(0, MAX_OUTPUT_CHARS), stderr: stderr.slice(0, MAX_OUTPUT_CHARS), truncated, cwd: relPath(ctx, cwd) },
            exitCode: code ?? 1
          });
        });
      });
    }
  },
  {
    risk: "write",
    spec: {
      name: "memory",
      description:
        "Kelola memori lokal user. Simpan fakta tahan lama (preferensi, konvensi proyek, koreksi) dengan action=add. Cari dengan action=search, lihat dengan action=list, ubah dengan action=update, hapus dengan action=remove.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "list", "search", "update", "remove", "pending", "approve", "reject", "prune"] },
          text: { type: "string", description: "Isi memori, maksimal 4.000 karakter, untuk update atau kandidat yang diedit" },
          id: { type: "string", description: "ID memori untuk update atau remove" },
          query: { type: "string", description: "Kata kunci pencarian" },
          scope: { type: "string", enum: ["global", "project", "all"], description: "Default project untuk add" },
          kind: { type: "string", description: "Jenis: fact, preference, convention, correction" },
          tags: { type: "array", items: { type: "string" }, maxItems: 12 },
          limit: { type: "integer", minimum: 1, maximum: 100 }
        },
        required: ["action"]
      }
    },
    async run(args, ctx) {
      const input = parse(memorySchema, args, "memory");
      if (!ctx.memory) throw new RannError("E_TOOL_NOT_FOUND", "Memori lokal tidak aktif");
      if (input.action === "add") {
        assertAllowed({ mode: ctx.permissionMode, tool: "memory", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
        if (!input.text) throw new RannError("E_TOOL_INVALID_ARGS", "memory add butuh text");
        if (input.scope === "all") throw new RannError("E_TOOL_INVALID_ARGS", "scope add hanya global atau project");
        const entry = ctx.memory.add({ text: input.text, scope: input.scope, kind: input.kind, tags: input.tags });
        await ctx.hooks?.run("MemoryWrite", { memory_id: entry.id, scope: entry.scope, kind: entry.kind }, { cwd: ctx.workspaceRoot });
        return textResult({ saved: entry });
      }
      if (input.action === "search") {
        if (!input.query) throw new RannError("E_TOOL_INVALID_ARGS", "memory search butuh query");
        return textResult({ query: input.query, entries: ctx.memory.search(input.query, input.limit ?? 10) });
      }
      if (input.action === "list") {
        return textResult({ entries: ctx.memory.list(input.scope ?? "all", input.limit ?? 30), count: ctx.memory.count() });
      }
      if (input.action === "update") {
        assertAllowed({ mode: ctx.permissionMode, tool: "memory", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
        if (!input.id) throw new RannError("E_TOOL_INVALID_ARGS", "memory update butuh id");
        const entry = ctx.memory.update(input.id, { text: input.text, tags: input.tags, kind: input.kind });
        if (!entry) throw new RannError("E_TOOL_FAILED", `Memori tidak ditemukan: ${input.id}`);
        return textResult({ updated: entry });
      }
      assertAllowed({ mode: ctx.permissionMode, tool: "memory", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      const target = input.id ?? input.text;
      if (!target) throw new RannError("E_TOOL_INVALID_ARGS", "memory remove butuh id atau text");
      return textResult({ removed: ctx.memory.remove(target) });
    }
  },
  {
    risk: "write",
    spec: {
      name: "procedure",
      description: "Simpan prosedur yang terbukti berulang. save mencatat kandidat, result mencatat keberhasilan atau kegagalan, promote mengaktifkan prosedur setelah minimal tiga keberhasilan atau persetujuan pengguna.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "save", "result", "promote"] },
          name: { type: "string" },
          trigger: { type: "string" },
          prerequisites: { type: "array", items: { type: "string" } },
          steps: { type: "string" },
          verification: { type: "string" },
          id: { type: "string" },
          ok: { type: "boolean" },
          status: { type: "string", enum: ["candidate", "active", "stale", "rejected"] }
        },
        required: ["action"]
      }
    },
    async run(args, ctx) {
      const input = parse(procedureSchema, args, "procedure");
      if (!ctx.db) throw new RannError("E_TOOL_NOT_FOUND", "Database tidak aktif");
      if (input.action === "list") {
        return textResult({ procedures: listProcedures(ctx.db, { projectPath: ctx.workspaceRoot, ...(input.status ? { status: input.status } : {}), limit: 50 }) });
      }
      if (input.action === "save") {
        assertAllowed({ mode: ctx.permissionMode, tool: "procedure", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
        if (!input.name || !input.trigger || !input.steps || !input.verification) {
          throw new RannError("E_TOOL_INVALID_ARGS", "procedure save butuh name, trigger, steps, dan verification");
        }
        return textResult({ procedure: upsertProcedure(ctx.db, { projectPath: ctx.workspaceRoot, name: input.name, trigger: input.trigger, prerequisites: input.prerequisites, steps: input.steps, verification: input.verification }) });
      }
      if (input.action === "result") {
        assertAllowed({ mode: ctx.permissionMode, tool: "procedure", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
        if (!input.id || input.ok === undefined) throw new RannError("E_TOOL_INVALID_ARGS", "procedure result butuh id dan ok");
        const row = recordProcedureResult(ctx.db, input.id, input.ok);
        if (!row) throw new RannError("E_NOT_FOUND", "Prosedur tidak ditemukan");
        return textResult({ procedure: row });
      }
      assertAllowed({ mode: ctx.permissionMode, tool: "procedure", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      if (!input.id) throw new RannError("E_TOOL_INVALID_ARGS", "procedure promote butuh id");
      const rows = listProcedures(ctx.db, { limit: 500 });
      const target = rows.find((row) => row.id === input.id);
      if (!target) throw new RannError("E_NOT_FOUND", "Prosedur tidak ditemukan");
      if (target.successes < 3) throw new RannError("E_PERMISSION", "Prosedur butuh minimal tiga keberhasilan sebelum dipromosikan");
      ctx.db.prepare("UPDATE procedures SET status = 'active', approved_by = 'user', updated_at = ? WHERE id = ?").run(Date.now(), input.id);
      return textResult({ procedure: listProcedures(ctx.db, { limit: 500 }).find((row) => row.id === input.id) });
    }
  },
  {
    risk: "write",
    spec: {
      name: "skill",
      description:
        "Kelola skill lokal. action=list untuk katalog, action=view untuk membaca isi skill sebelum dipakai, action=create untuk menyimpan alur kerja berulang, action=remove untuk menghapus skill project/global.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "view", "create", "remove", "select", "edit", "history", "rollback", "validate", "reference"] },
          name: { type: "string" },
          description: { type: "string", description: "Kapan skill dipakai, minimal 12 karakter" },
          body: { type: "string", description: "Langkah kerja, maksimal 60.000 karakter" },
          scope: { type: "string", enum: ["global", "project"] },
          overwrite: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 200 },
          task: { type: "string", description: "Teks tugas untuk memilih skill" },
          triggers: { type: "array", items: { type: "string" } },
          dependencies: { type: "array", items: { type: "string" } },
          version: { type: "string", description: "Versi target untuk rollback" },
          file: { type: "string", description: "Nama berkas di folder references atau scripts" },
          reason: { type: "string", description: "Alasan perubahan untuk changelog" }
        },
        required: ["action"]
      }
    },
    async run(args, ctx) {
      const input = parse(skillSchema, args, "skill");
      if (!ctx.skills) throw new RannError("E_TOOL_NOT_FOUND", "Skill lokal tidak aktif");
      if (input.action === "list") return textResult({ skills: ctx.skills.list(input.limit ?? 40) });
      if (input.action === "view") {
        if (!input.name) throw new RannError("E_TOOL_INVALID_ARGS", "skill view butuh name");
        const skill = ctx.skills.view(input.name);
        if (!skill) throw new RannError("E_TOOL_FAILED", `Skill tidak ditemukan: ${input.name}`);
        return textResult(skill);
      }
      if (input.action === "select") {
        if (!input.task) throw new RannError("E_TOOL_INVALID_ARGS", "skill select butuh task");
        return textResult(ctx.skills.select(input.task, { max: input.limit ?? 3 }));
      }
      if (input.action === "history") {
        if (!input.name) throw new RannError("E_TOOL_INVALID_ARGS", "skill history butuh name");
        return textResult({ versions: ctx.skills.history(input.name), changelog: ctx.skills.changelog(input.name) });
      }
      if (input.action === "run") {
        if (!input.name) throw new RannError("E_TOOL_INVALID_ARGS", "skill run butuh name");
        if (!input.script) throw new RannError("E_TOOL_INVALID_ARGS", "skill run butuh script");
        const result = await ctx.skills.runScript(input.name, input.script, input.args ?? [], {
          ...(input.timeout_ms ? { timeoutMs: input.timeout_ms } : {}),
          ...(ctx.signal ? { signal: ctx.signal } : {})
        });
        return { ok: result.ok, output: result, ...(result.ok ? {} : { code: "E_TOOL_FAILED", exitCode: result.exitCode }) };
      }
      if (input.action === "validate") {
        if (!input.name || !input.description || !input.body) {
          throw new RannError("E_TOOL_INVALID_ARGS", "skill validate butuh name, description, dan body");
        }
        return textResult(ctx.skills.validate({ name: input.name, description: input.description, body: input.body, triggers: input.triggers, dependencies: input.dependencies }));
      }
      assertAllowed({ mode: ctx.permissionMode, tool: "skill", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      if (input.action === "create") {
        if (!input.name || !input.description || !input.body) {
          throw new RannError("E_TOOL_INVALID_ARGS", "skill create butuh name, description, dan body");
        }
        return textResult({ created: ctx.skills.create({ name: input.name, description: input.description, body: input.body, scope: input.scope, overwrite: input.overwrite, triggers: input.triggers, dependencies: input.dependencies, reason: input.reason }) });
      }
      if (input.action === "edit") {
        if (!input.name) throw new RannError("E_TOOL_INVALID_ARGS", "skill edit butuh name");
        return textResult({ updated: ctx.skills.edit(input.name, { body: input.body, description: input.description, triggers: input.triggers, reason: input.reason }) });
      }
      if (input.action === "rollback") {
        if (!input.name) throw new RannError("E_TOOL_INVALID_ARGS", "skill rollback butuh name");
        return textResult({ restored: ctx.skills.rollback(input.name, input.version) });
      }
      if (input.action === "reference") {
        if (!input.name || !input.file) throw new RannError("E_TOOL_INVALID_ARGS", "skill reference butuh name dan file");
        const content = ctx.skills.readAsset(input.name, input.file, input.file.startsWith("scripts/") ? "scripts" : "references");
        if (content === undefined) throw new RannError("E_NOT_FOUND", `Aset skill tidak ditemukan: ${input.file}`);
        return textResult({ name: input.name, file: input.file, content });
      }
      if (!input.name) throw new RannError("E_TOOL_INVALID_ARGS", "skill remove butuh name");
      const removed = ctx.skills.remove(input.name, input.scope ?? "project");
      if (ctx.db) {
        try {
          appendAudit(ctx.db, {
            actor: "agent",
            action: "skill.remove",
            resource: input.name,
            decision: removed ? "ok" : "not_found",
            metadata: { scope: input.scope ?? "project", session_id: ctx.sessionId ?? null, turn_id: ctx.turnId ?? null }
          });
        } catch {
          // audit skill tidak boleh menggagalkan penghapusan
        }
      }
      return textResult({ removed });
    }
  },
  {
    risk: "read",
    spec: {
      name: "plugin_call",
      description:
        "Panggil plugin terpasang. action=list untuk melihat plugin dan izinnya, action=call untuk menjalankan method plugin di proses anak dengan timeout.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "call"] },
          name: { type: "string", description: "Nama plugin" },
          method: { type: "string", description: "Method yang diekspos plugin" },
          params: { type: "object", description: "Parameter JSON untuk plugin" },
          timeout_ms: { type: "integer", minimum: 1_000, maximum: 120_000 }
        },
        required: ["action"]
      }
    },
    async run(args, ctx) {
      if (!ctx.plugins) throw new RannError("E_TOOL_NOT_FOUND", "Plugin tidak aktif di sesi ini");
      const action = typeof args === "object" && args !== null ? (args as Record<string, unknown>).action : undefined;
      if (action === "list") return textResult({ plugins: ctx.plugins.list() });
      if (action !== "call") throw new RannError("E_TOOL_INVALID_ARGS", "plugin_call action harus list atau call");
      const record = (args ?? {}) as Record<string, unknown>;
      if (typeof record.name !== "string" || record.name.length === 0) throw new RannError("E_TOOL_INVALID_ARGS", "plugin_call butuh name");
      if (typeof record.method !== "string" || record.method.length === 0) throw new RannError("E_TOOL_INVALID_ARGS", "plugin_call butuh method");
      const result = await ctx.plugins.invoke(record.name, record.method, record.params ?? {}, typeof record.timeout_ms === "number" ? record.timeout_ms : undefined);
      if (!result.ok) throw new RannError("E_TOOL_FAILED", result.error ?? `Plugin ${record.name} gagal`);
      return textResult(result.output);
    }
  },
  {
    risk: "write",
    spec: {
      name: "browser",
      description:
        "Kendalikan browser Chromium untuk situs yang butuh JavaScript, login, atau interaksi. Aksi: navigate, click, type, scroll, select, screenshot, extract, download, upload, evaluate, wait, close. Context terpisah per sesi. Aksi yang mengubah data butuh izin.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["navigate", "click", "type", "scroll", "select", "screenshot", "extract", "download", "upload", "evaluate", "wait", "close"] },
          url: { type: "string", description: "URL http atau https untuk navigate" },
          selector: { type: "string", description: "Selector CSS untuk click, type, select, wait, download, upload" },
          text: { type: "string", description: "Teks untuk type" },
          value: { type: "string", description: "Nilai untuk select atau type" },
          path: { type: "string", description: "Path berkas untuk download atau upload" },
          script: { type: "string", description: "JavaScript sinkron untuk evaluate, tanpa jaringan dan tanpa import" },
          delta_y: { type: "number", description: "Piksel scroll vertikal, negatif berarti naik" },
          timeout_ms: { type: "number", description: "Batas waktu aksi, 1000 sampai 120000 ms" },
          full_page: { type: "boolean", description: "Ambil screenshot seluruh halaman" },
          persistent: { type: "boolean", description: "Pakai profil persisten untuk sesi ini, berguna untuk login berulang" }
        },
        required: ["action"]
      }
    },
    async run(args, ctx) {
      const input = parse(browserSchema, args, "browser");
      if (!ctx.browser) throw new RannError("E_TOOL_FAILED", "Browser tidak aktif di sesi ini");
      const mutating = ["click", "type", "select", "upload", "evaluate"].includes(input.action);
      if (mutating && !ctx.approved) {
        throw new RannError("E_APPROVAL_REQUIRED", `Aksi browser ${input.action} mengubah halaman atau data dan butuh izin`, {
          data: { action: input.action, selector: input.selector, url: input.url }
        });
      }
      const taskKey = ctx.sessionId ?? "default";
      const output = await ctx.browser.perform(taskKey, input, { mutating, persistent: input.persistent === true });
      return textResult(output);
    }
  },
  {
    risk: "read",
    spec: {
      name: "web_search",
      description: "Cari di web dan kembalikan judul, URL, dan cuplikan terstruktur. Memakai Tavily atau Brave bila API key tersedia, jika tidak DuckDuckGo HTML.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Kata kunci pencarian" },
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Jumlah hasil, default 5" }
        },
        required: ["query"]
      }
    },
    async run(args) {
      const input = parse(webSearchSchema, args, "web_search");
      return textResult(await webSearch(input.query, input.limit ?? 5));
    }
  },
  {
    risk: "read",
    spec: {
      name: "http_request",
      description: "Ambil URL http atau https dan kembalikan teks, status, dan tipe konten. Menghormati robots.txt, memblokir alamat privat, dan membatasi ukuran 5 MB. POST butuh izin.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string", enum: ["GET", "HEAD", "POST"] },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: { type: "string", description: "Body untuk POST, maksimal 500.000 karakter" },
          max_chars: { type: "integer", minimum: 100, maximum: 200000 },
          ignore_robots: { type: "boolean", description: "Lewati pemeriksaan robots hanya untuk sumber yang kamu miliki" }
        },
        required: ["url"]
      }
    },
    async run(args, ctx) {
      const input = parse(httpRequestSchema, args, "http_request");
      const method = input.method ?? "GET";
      assertAllowed({
        mode: ctx.permissionMode,
        tool: "http_request",
        risk: method === "POST" ? "exec" : "read",
        command: input.url,
        approved: ctx.approved,
        allow: ctx.allow,
        deny: ctx.deny
      });
      if (method === "POST" && !ctx.approved) throw new RannError("E_APPROVAL_REQUIRED", "HTTP POST butuh izin");
      return textResult(await httpFetch(input));
    }
  },
  {
    risk: "read",
    spec: {
      name: "database_query",
      description: "Query read-only ke database SQLite. Hanya SELECT, WITH, EXPLAIN, dan PRAGMA baca. Maksimal 500 baris.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path berkas SQLite" },
          sql: { type: "string", description: "Query read-only" },
          params: { type: "array", items: { type: ["string", "number", "null"] }, description: "Parameter posisional" }
        },
        required: ["path", "sql"]
      }
    },
    async run(args, ctx) {
      const input = parse(databaseQuerySchema, args, "database_query");
      return textResult(sqliteQuery(resolveInsideWorkspace(input.path, ctx), input.sql, input.params ?? []));
    }
  },
  {
    risk: "read",
    spec: {
      name: "document_extract",
      description: "Ekstrak teks dari PDF, DOCX, XLSX, TXT, MD, CSV, atau JSON. PDF butuh pdftotext, DOCX dan XLSX butuh unzip.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path dokumen" } },
        required: ["path"]
      }
    },
    async run(args, ctx) {
      const input = parse(documentSchema, args, "document_extract");
      return textResult(documentExtract(resolveInsideWorkspace(input.path, ctx)));
    }
  },
  {
    risk: "read",
    spec: {
      name: "image_info",
      description: "Baca metadata gambar dan OCR bila RANN_OCR=1 serta tesseract tersedia.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, ocr: { type: "boolean" } },
        required: ["path"]
      }
    },
    async run(args, ctx) {
      const input = parse(imageInfoSchema, args, "image_info");
      return textResult(imageInfo(resolveInsideWorkspace(input.path, ctx), input.ocr === true));
    }
  },
  {
    risk: "write",
    spec: {
      name: "image_transform",
      description: "Ubah ukuran atau crop gambar dengan ImageMagick. Butuh izin karena menulis berkas baru.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          output: { type: "string" },
          width: { type: "integer" },
          height: { type: "integer" },
          crop: { type: "string", description: "Format WxH+X+Y" }
        },
        required: ["path", "output"]
      }
    },
    async run(args, ctx) {
      const input = parse(imageTransformSchema, args, "image_transform");
      assertAllowed({ mode: ctx.permissionMode, tool: "image_transform", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      const output = resolveInsideWorkspace(input.output, ctx);
      return textResult(imageTransform(resolveInsideWorkspace(input.path, ctx), output, input));
    }
  },
  {
    risk: "exec",
    spec: {
      name: "package_run",
      description: "Jalankan npm, pnpm, atau yarn dengan subperintah yang diizinkan: install, add, remove, test, run, ci, update, list, why, outdated, audit. Flag global dan registry ditolak.",
      parameters: {
        type: "object",
        properties: {
          manager: { type: "string", enum: ["npm", "pnpm", "yarn"] },
          args: { type: "array", items: { type: "string" }, description: "Argumen setelah nama package manager" },
          cwd: { type: "string" }
        },
        required: ["args"]
      }
    },
    async run(args, ctx) {
      const input = parse(packageSchema, args, "package_run");
      const cwd = resolveInsideWorkspace(input.cwd ?? ".", ctx);
      const manager = input.manager ?? detectPackageManager(cwd);
      assertAllowed({ mode: ctx.permissionMode, tool: "package_run", risk: "exec", command: `${manager} ${input.args.join(" ")}`, approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      return textResult(packageCommand(manager, input.args, cwd));
    }
  },
  {
    risk: "read",
    spec: {
      name: "system_info",
      description: "Baca informasi platform, CPU, memori, uptime, dan disk.",
      parameters: { type: "object", properties: {} }
    },
    async run() {
      return textResult(systemInfo());
    }
  },
  {
    risk: "exec",
    spec: {
      name: "schedule_task",
      description: "Masukkan prompt ke antrean background dengan prioritas dan jeda opsional. Job bertahan setelah restart dan dijalankan worker.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Prompt yang akan dijalankan" },
          priority: { type: "integer", minimum: 0, maximum: 1000, description: "Prioritas, makin kecil makin cepat" },
          delay_seconds: { type: "integer", minimum: 0, maximum: 2592000, description: "Jeda sebelum dijalankan" },
          idempotency_key: { type: "string", description: "Kunci idempotensi minimal 8 karakter" }
        },
        required: ["text"]
      }
    },
    async run(args, ctx) {
      const input = parse(scheduleTaskSchema, args, "schedule_task");
      if (!ctx.scheduleTask) throw new RannError("E_TOOL_FAILED", "Penjadwalan tidak aktif di sesi ini");
      assertAllowed({ mode: ctx.permissionMode, tool: "schedule_task", risk: "exec", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      return textResult(await ctx.scheduleTask(input));
    }
  },
  {
    risk: "exec",
    spec: {
      name: "messaging_send",
      description: "Kirim pesan lewat adapter messaging yang sama dengan gateway, misalnya Telegram. Butuh izin.",
      parameters: {
        type: "object",
        properties: {
          chat_id: { type: "integer", description: "ID chat tujuan" },
          text: { type: "string", description: "Isi pesan, maksimal 12.000 karakter" },
          thread_id: { type: "integer", description: "ID topik opsional" }
        },
        required: ["chat_id", "text"]
      }
    },
    async run(args, ctx) {
      const input = parse(messagingSendSchema, args, "messaging_send");
      if (!ctx.sendMessage) throw new RannError("E_TOOL_FAILED", "Messaging tidak aktif di sesi ini");
      assertAllowed({ mode: ctx.permissionMode, tool: "messaging_send", risk: "exec", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      return textResult(await ctx.sendMessage(input.chat_id, input.text, input.thread_id));
    }
  },
  {
    risk: "read",
    spec: {
      name: "agent_message",
      description: "Kirim pesan terstruktur ke parent, anak, atau peer dalam tim yang sama. Pesan dicatat dan bisa diaudit; pesan tidak mengubah goal atau izin penerima.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "ID agent tujuan" },
          type: { type: "string", enum: ["note", "question", "answer", "conflict"] },
          subject: { type: "string", description: "Subjek singkat" },
          body: { type: "string", description: "Isi pesan" },
          priority: { type: "string", enum: ["low", "normal", "high"] },
          refs: { type: "array", items: { type: "string" }, description: "Path, ID, atau tautan rujukan" }
        },
        required: ["to", "type", "subject", "body"]
      }
    },
    async run(args, ctx) {
      const input = parse(agentMessageSchema, args, "agent_message");
      if (!ctx.agentMessage) throw new RannError("E_TOOL_FAILED", "Pesan antar agen hanya tersedia di dalam subagent");
      return textResult(await ctx.agentMessage(input));
    }
  },
  {
    risk: "read",
    spec: {
      name: "task",
      description:
        "Jalankan subagent dengan konteks terisolasi untuk satu tujuan. Pilih profil sesuai tugas, atau biarkan dipilih otomatis. Hasil kembali sebagai ringkasan berisi bukti, langkah, biaya, dan berkas yang berubah. Mode background mengembalikan agent_id dan berjalan paralel.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "Tujuan spesifik subagent" },
          context: { type: "string", description: "Konteks yang perlu diketahui subagent" },
          label: { type: "string", description: "Label singkat untuk nama sesi" },
          profile: { type: "string", description: "Profil: explore, planner, coder, debugger, reviewer, tester, researcher, writer, security, atau profil kustom" },
          background: { type: "boolean", description: "Jalankan di latar dan kembalikan agent_id" },
          max_steps: { type: "number", description: "Batas langkah subagent, 1 sampai 30" },
          acceptance: { type: "string", description: "Kriteria selesai yang bisa diperiksa" },
          context_mode: { type: "string", enum: ["shared", "isolated"], description: "shared membagikan goal dan ringkasan keputusan; isolated hanya konteks eksplisit" },
          files: { type: "array", items: { type: "string" }, description: "Berkas yang relevan atau boleh disentuh" },
          timeout_ms: { type: "integer", minimum: 1000, maximum: 3600000, description: "Batas waktu subagent" }
        },
        required: ["goal"]
      }
    },
    async run(args, ctx) {
      const input = parse(taskSchema, args, "task");
      if (!ctx.delegate) throw new RannError("E_TOOL_FAILED", "Subagent tidak aktif di sesi ini");
      const result = await ctx.delegate({
        goal: input.goal,
        context: input.context,
        label: input.label,
        profile: input.profile,
        background: input.background,
        maxSteps: input.max_steps,
        acceptance: input.acceptance,
        files: input.files,
        timeoutMs: input.timeout_ms,
        contextMode: input.context_mode
      });
      return textResult(result);
    }
  },
  {
    risk: "write",
    spec: {
      name: "code_rename",
      description: "Ganti nama simbol di seluruh berkas kode dalam workspace dengan batas kata. Transaksional, mendukung dry_run, dan menghormati folder generated.",
      parameters: {
        type: "object",
        properties: {
          old_name: { type: "string", description: "Nama simbol lama, identifier valid" },
          new_name: { type: "string", description: "Nama simbol baru, identifier valid" },
          path: { type: "string", description: "Berkas atau folder awal; default seluruh workspace" },
          dry_run: { type: "boolean", description: "Hanya tampilkan berkas yang akan berubah" },
          max_files: { type: "integer", minimum: 1, maximum: 5000 }
        },
        required: ["old_name", "new_name"]
      }
    },
    async run(args, ctx) {
      const input = parse(codeRenameSchema, args, "code_rename");
      assertAllowed({ mode: ctx.permissionMode, tool: "code_rename", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      if (input.old_name === input.new_name) throw new RannError("E_TOOL_INVALID_ARGS", "Nama lama dan baru sama");
      const root = input.path ? resolveInsideWorkspace(input.path, ctx) : ctx.workspaceRoot;
      const files = existsSync(root) && statSync(root).isDirectory() ? walkRenameFiles(root, input.max_files ?? 2_000) : [root];
      const pattern = new RegExp(`\\b${escapeRegExp(input.old_name)}\\b`, "g");
      const changes: FileChange[] = [];
      const summary: Array<{ path: string; replacements: number }> = [];
      for (const file of files) {
        if (!existsSync(file) || !statSync(file).isFile()) continue;
        let text: string;
        try {
          text = readFileSync(file, "utf8");
        } catch {
          continue;
        }
        const matches = text.match(pattern);
        if (!matches || matches.length === 0) continue;
        const relPathChange = relative(ctx.workspaceRoot, file).replace(/\\/g, "/");
        changes.push({ path: relPathChange, content: text.replace(pattern, input.new_name) });
        summary.push({ path: relPathChange, replacements: matches.length });
      }
      if (changes.length === 0) return textResult({ changed: 0, files: [] });
      if (input.dry_run === true) return textResult({ dry_run: true, changed: changes.length, files: summary });
      const targets = changes.map((change) => resolve(ctx.workspaceRoot, change.path));
      const leases = acquireLeases(ctx, targets);
      const transaction = beginTransaction(ctx, { tool: "code_rename", old_name: input.old_name, new_name: input.new_name });
      try {
        const applied = applyFileTransaction(ctx.workspaceRoot, changes, { workspaceOnly: ctx.workspaceOnly, includeText: true });
        recordChanges(ctx, transaction, applied.files, "applied");
        finishTransactionSafe(ctx, transaction, "committed", {
          tool: "code_rename",
          old_name: input.old_name,
          new_name: input.new_name,
          files: applied.files.map((file) => ({ path: file.path, lines_added: file.lines_added, lines_removed: file.lines_removed }))
        });
        return textResult({
          changed: applied.files.length,
          replacements: summary.reduce((total, item) => total + item.replacements, 0),
          files: summary
        });
      } catch (error) {
        finishTransactionSafe(ctx, transaction, "failed", { tool: "code_rename", error: String(error) });
        throw error;
      } finally {
        releaseLeases(ctx, leases);
      }
    }
  },
  {
    risk: "read",
    spec: {
      name: "symbol_search",
      description: "Cari simbol kode (fungsi, class, interface, type, method) dari indeks simbol workspace. Hasil memuat path, baris, nama, dan jenis.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Nama simbol atau potongannya" },
          limit: { type: "integer", minimum: 1, maximum: 200 }
        },
        required: ["query"]
      }
    },
    async run(args, ctx) {
      const input = parse(z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(200).optional() }), args, "symbol_search");
      return textResult({ query: input.query, results: searchSymbols(ctx.workspaceRoot, input.query, input.limit ?? 50) });
    }
  },
];

function aliasTool(name: string, target: string, description: string): ToolDefinition {
  const base = tools.find((tool) => tool.spec.name === target);
  if (!base) throw new Error(`Alias target tidak ada: ${target}`);
  return {
    risk: base.risk,
    spec: { name, description, parameters: base.spec.parameters },
    run: (args, ctx) => executeTool(target, args, ctx)
  };
}

const aliasTools: ToolDefinition[] = [
  aliasTool("read_file", "fs_read", "Baca berkas dengan nomor baris dan hash."),
  aliasTool("write_file", "fs_write", "Tulis berkas dengan guard hash opsional."),
  aliasTool("edit_file", "fs_edit", "Edit berkas dengan old_string dan new_string."),
  aliasTool("delete_file", "fs_delete", "Pindahkan berkas ke trash internal."),
  aliasTool("list_dir", "fs_list", "Daftar isi direktori."),
  aliasTool("stat_file", "fs_stat", "Metadata dan hash berkas.")
];

export function toolSpecs(custom: CustomTool[] = []): ToolSpec[] {
  const entries = [...tools, ...aliasTools];
  return [
    ...entries.map((tool) => ({
      ...tool.spec,
      permission: tool.risk === "read" ? "read" as const : tool.risk === "write" ? "write" as const : "exec" as const,
      timeoutMs: tool.risk === "read" ? 30_000 : tool.risk === "write" ? 60_000 : 120_000,
      outputSchema: { type: "object", additionalProperties: true }
    })),
    ...custom.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.schema as ToolSpec["parameters"],
      permission: tool.permission === "read" ? "read" as const : tool.permission === "write" ? "write" as const : "exec" as const,
      timeoutMs: 120_000,
      outputSchema: { type: "object", additionalProperties: true }
    }))
  ];
}

export function findTool(name: string): ToolDefinition | undefined {
  return [...tools, ...aliasTools].find((tool) => tool.spec.name === name);
}

export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const custom = ctx.customTools?.find((item) => item.name === name);
  if (custom) {
    assertAllowed({ mode: ctx.permissionMode, tool: name, risk: custom.permission === "read" ? "read" : custom.permission === "write" ? "write" : "exec", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
    const started = Date.now();
    const result = await runCustomTool(custom, args, { workspaceRoot: ctx.workspaceRoot, ...(ctx.signal ? { signal: ctx.signal } : {}) });
    return { ...result, durationMs: Date.now() - started };
  }
  if (name.startsWith("mcp__")) {
    if (!ctx.mcp) throw new RannError("E_TOOL_NOT_FOUND", `MCP tidak aktif untuk tool ${name}`);
    assertAllowed({
      mode: ctx.permissionMode,
      tool: name,
      risk: ctx.mcp.permissionFor?.(name) ?? "exec",
      approved: ctx.approved,
      allow: ctx.allow,
      deny: ctx.deny
    });
    const started = Date.now();
    const output = await ctx.mcp.callTool(name, args, ctx.signal);
    return { ok: true, output, durationMs: Date.now() - started };
  }
  const tool = findTool(name);
  if (!tool) throw new RannError("E_TOOL_NOT_FOUND", `Tool tidak dikenal: ${name}`, { data: { tool: name } });
  return tool.run(args, ctx);
}
