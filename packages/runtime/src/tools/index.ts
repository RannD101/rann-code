import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, globSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { z } from "zod";
import { RannError } from "@rann/shared";
import type { PermissionMode } from "@rann/shared";
import { assertAllowed, resolveInsideWorkspace, type ToolRisk } from "../policy.js";
import { commitMessage, runGit, safeGitPath } from "../git.js";
import {
  createFileCheckpoint,
  listFileCheckpoints,
  restoreFileCheckpoint
} from "../checkpoint-files.js";
import { applyFileTransaction, searchCode } from "../code-tools.js";
import { ensureProjectMap, projectMapSummary } from "../project-map.js";
import type { ToolSpec } from "../providers/types.js";
import type { MemoryService } from "../memory.js";
import type { SkillStore } from "../skills.js";

export interface ToolContext {
  workspaceRoot: string;
  workspaceOnly: boolean;
  permissionMode: PermissionMode;
  approved: boolean;
  sessionId?: string;
  turnId?: string;
  checkpointsDir?: string;
  allow?: string[];
  deny?: string[];
  signal?: AbortSignal;
  shellTimeoutMs?: number;
  memory?: MemoryService;
  skills?: SkillStore;
  delegate?: (input: { goal: string; context?: string; label?: string }) => Promise<unknown>;
  mcp?: {
    callTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
  };
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
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

const fsWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  create_dirs: z.boolean().optional(),
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional()
});

const fsEditSchema = z.object({
  path: z.string().min(1),
  old: z.string().min(1),
  new: z.string(),
  all: z.boolean().optional(),
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional()
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
  recursive: z.boolean().optional()
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
  action: z.enum(["stage", "unstage", "commit", "branch_create"]),
  paths: z.array(z.string().min(1)).max(200).optional(),
  all: z.boolean().optional(),
  message: z.string().min(1).max(5_000).optional(),
  name: z.string().min(1).max(200).optional()
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

const skillSchema = z.object({
  action: z.enum(["list", "view", "create", "remove"]),
  name: z.string().min(1).max(64).optional(),
  description: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(60_000).optional(),
  scope: z.enum(["global", "project"]).optional(),
  overwrite: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional()
});

const taskSchema = z.object({
  goal: z.string().min(5).max(8_000),
  context: z.string().max(20_000).optional(),
  label: z.string().min(1).max(80).optional()
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
          create_dirs: { type: "boolean" }
        },
        required: ["path", "content"]
      }
    },
    async run(args, ctx) {
      const input = parse(fsWriteSchema, args, "fs_write");
      assertAllowed({ mode: ctx.permissionMode, tool: "fs_write", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      const target = resolveInsideWorkspace(input.path, ctx);
      if (existsSync(target)) {
        assertTextFile(target, input.path);
        if (input.expected_sha256) {
          const actual = sha256(readFileSync(target));
          if (actual !== input.expected_sha256.toLowerCase()) {
            throw new RannError("E_FILE_CHANGED", `Berkas ${input.path} berubah sejak dibaca. Baca ulang sebelum menulis.`, {
              data: { path: input.path, expected: input.expected_sha256, actual }
            });
          }
        }
      } else if (input.expected_sha256) {
        throw new RannError("E_FILE_CHANGED", `Berkas ${input.path} tidak ada, hash yang diharapkan tidak cocok`);
      }
      if (input.create_dirs !== false) mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, input.content, "utf8");
      return textResult({ path: relPath(ctx, target), bytes: Buffer.byteLength(input.content, "utf8"), sha256: sha256(input.content) });
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
          old: { type: "string" },
          new: { type: "string" },
          all: { type: "boolean" }
        },
        required: ["path", "old", "new"]
      }
    },
    async run(args, ctx) {
      const input = parse(fsEditSchema, args, "fs_edit");
      assertAllowed({ mode: ctx.permissionMode, tool: "fs_edit", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      const target = resolveInsideWorkspace(input.path, ctx);
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
      if (occurrences > 1 && input.all !== true) {
        throw new RannError("E_TOOL_FAILED", `Teks lama muncul ${occurrences} kali. Set all=true atau perjelas konteks.`);
      }
      const after = input.all === true ? before.split(input.old).join(input.new) : before.replace(input.old, input.new);
      writeFileSync(target, after, "utf8");
      return textResult({ path: relPath(ctx, target), replacements: input.all === true ? occurrences : 1, sha256: sha256(after) });
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
          recursive: { type: "boolean" }
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
      const trashDir = resolveInsideWorkspace(".rann/trash", { ...ctx, workspaceOnly: true });
      mkdirSync(trashDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = target.split(/[\\/]/).pop() ?? "berkas";
      const destination = `${trashDir}/${stamp}-${name}`;
      renameSync(target, destination);
      return textResult({ path: input.path, type: stat.isDirectory() ? "dir" : "file", trash_path: relPath(ctx, destination) });
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
      description: "Operasi Git yang mengubah state: stage, unstage, commit dengan trailer Rann-Code-Session, atau buat branch. Commit ditolak saat masih ada konflik.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["stage", "unstage", "commit", "branch_create"] },
          paths: { type: "array", items: { type: "string" } },
          all: { type: "boolean" },
          message: { type: "string" },
          name: { type: "string" }
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
      const result = applyFileTransaction(ctx.workspaceRoot, input.changes, {
        workspaceOnly: ctx.workspaceOnly,
        ...(input.dry_run !== undefined ? { dryRun: input.dry_run } : {})
      });
      return textResult(result);
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
      const result = await executeTool(
        "shell_run",
        {
          command,
          ...(input.timeout_ms !== undefined ? { timeout_ms: input.timeout_ms } : {})
        },
        { ...ctx, approved: true }
      );
      return textResult({ action: input.action, command, ...result });
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
          finish({ ok: false, output: { error: "timeout", timeout_ms: timeoutMs, stdout: stdout.slice(0, MAX_OUTPUT_CHARS), stderr }, exitCode: 124 });
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
            output: { stdout: stdout.slice(0, MAX_OUTPUT_CHARS), stderr: stderr.slice(0, MAX_OUTPUT_CHARS), truncated },
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
          action: { type: "string", enum: ["add", "list", "search", "update", "remove"] },
          text: { type: "string", description: "Isi memori, maksimal 4.000 karakter" },
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
      name: "skill",
      description:
        "Kelola skill lokal. action=list untuk katalog, action=view untuk membaca isi skill sebelum dipakai, action=create untuk menyimpan alur kerja berulang, action=remove untuk menghapus skill project/global.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "view", "create", "remove"] },
          name: { type: "string" },
          description: { type: "string", description: "Kapan skill dipakai, minimal 12 karakter" },
          body: { type: "string", description: "Langkah kerja, maksimal 60.000 karakter" },
          scope: { type: "string", enum: ["global", "project"] },
          overwrite: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 200 }
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
      assertAllowed({ mode: ctx.permissionMode, tool: "skill", risk: "write", approved: ctx.approved, allow: ctx.allow, deny: ctx.deny });
      if (input.action === "create") {
        if (!input.name || !input.description || !input.body) {
          throw new RannError("E_TOOL_INVALID_ARGS", "skill create butuh name, description, dan body");
        }
        return textResult({ created: ctx.skills.create({ name: input.name, description: input.description, body: input.body, scope: input.scope, overwrite: input.overwrite }) });
      }
      if (!input.name) throw new RannError("E_TOOL_INVALID_ARGS", "skill remove butuh name");
      return textResult({ removed: ctx.skills.remove(input.name, input.scope ?? "project") });
    }
  },
  {
    risk: "read",
    spec: {
      name: "task",
      description:
        "Jalankan subagent lokal dengan konteks terisolasi untuk satu tujuan. Subagent memakai provider yang sama, izin default read-only, dan hasilnya kembali sebagai ringkasan. Cocok untuk riset, pembacaan banyak berkas, atau verifikasi terpisah.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "Tujuan spesifik subagent" },
          context: { type: "string", description: "Konteks yang perlu diketahui subagent" },
          label: { type: "string", description: "Label singkat untuk nama sesi" }
        },
        required: ["goal"]
      }
    },
    async run(args, ctx) {
      const input = parse(taskSchema, args, "task");
      if (!ctx.delegate) throw new RannError("E_TOOL_FAILED", "Subagent tidak aktif di sesi ini");
      const result = await ctx.delegate({ goal: input.goal, context: input.context, label: input.label });
      return textResult(result);
    }
  }
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

export function toolSpecs(): ToolSpec[] {
  return [...tools, ...aliasTools].map((tool) => tool.spec);
}

export function findTool(name: string): ToolDefinition | undefined {
  return [...tools, ...aliasTools].find((tool) => tool.spec.name === name);
}

export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (name.startsWith("mcp__")) {
    if (!ctx.mcp) throw new RannError("E_TOOL_NOT_FOUND", `MCP tidak aktif untuk tool ${name}`);
    assertAllowed({
      mode: ctx.permissionMode,
      tool: name,
      risk: "exec",
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
