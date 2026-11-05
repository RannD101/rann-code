import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { z } from "zod";
import { RannError } from "@rann/shared";
import type { PermissionMode } from "@rann/shared";
import { assertAllowed, resolveInsideWorkspace, type ToolRisk } from "../policy.js";
import type { ToolSpec } from "../providers/types.js";

export interface ToolContext {
  workspaceRoot: string;
  workspaceOnly: boolean;
  permissionMode: PermissionMode;
  approved: boolean;
  allow?: string[];
  deny?: string[];
  signal?: AbortSignal;
  shellTimeoutMs?: number;
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
  create_dirs: z.boolean().optional()
});

const fsEditSchema = z.object({
  path: z.string().min(1),
  old: z.string().min(1),
  new: z.string(),
  all: z.boolean().optional()
});

const shellSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().min(1_000).max(600_000).optional()
});

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
      return textResult({ path: relPath(ctx, target), offset, lines: slice.length, total_lines: lines.length, truncated, content });
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
          if (entry.name === ".git" || entry.name === "node_modules") continue;
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
      if (input.create_dirs !== false) mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, input.content, "utf8");
      return textResult({ path: relPath(ctx, target), bytes: Buffer.byteLength(input.content, "utf8") });
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
      const before = readFileSync(target, "utf8");
      const occurrences = before.split(input.old).length - 1;
      if (occurrences === 0) throw new RannError("E_TOOL_FAILED", "Teks lama tidak ditemukan");
      if (occurrences > 1 && input.all !== true) {
        throw new RannError("E_TOOL_FAILED", `Teks lama muncul ${occurrences} kali. Set all=true atau perjelas konteks.`);
      }
      const after = input.all === true ? before.split(input.old).join(input.new) : before.replace(input.old, input.new);
      writeFileSync(target, after, "utf8");
      return textResult({ path: relPath(ctx, target), replacements: input.all === true ? occurrences : 1 });
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
          env: { ...process.env, RANN_TOOL: "shell_run" }
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
  }
];

export function toolSpecs(): ToolSpec[] {
  return tools.map((tool) => tool.spec);
}

export function findTool(name: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.spec.name === name);
}

export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) throw new RannError("E_TOOL_NOT_FOUND", `Tool tidak dikenal: ${name}`, { data: { tool: name } });
  return tool.run(args, ctx);
}
