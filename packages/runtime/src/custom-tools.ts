import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import type { ToolSpec } from "./providers/types.js";

export type CustomToolPermission = "read" | "write" | "exec";

export interface CustomTool {
  name: string;
  description: string;
  permission: CustomToolPermission;
  timeoutMs: number;
  schema: Record<string, unknown>;
  source: string;
  kind: "command" | "module";
  command?: string;
  args?: string[];
  run?: (input: unknown, context: { workspaceRoot: string; signal?: AbortSignal; permission: CustomToolPermission }) => Promise<unknown>;
}

export interface CustomToolLoadResult {
  tools: CustomTool[];
  errors: Array<{ file: string; message: string }>;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]{2,40}$/;
const PERMISSIONS = new Set(["read", "write", "exec"]);
const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 600_000;

function validateSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("schema harus objek JSON");
  const schema = value as Record<string, unknown>;
  if (schema.type !== "object") throw new Error("schema.type harus \"object\"");
  if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
    throw new Error("schema.properties wajib objek");
  }
  return schema;
}

function normalizeMeta(input: Record<string, unknown>): Omit<CustomTool, "source" | "kind" | "run"> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!NAME_PATTERN.test(name)) throw new Error("nama tool harus huruf kecil, angka, atau garis bawah (3-41 karakter)");
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length < 3) throw new Error("deskripsi tool wajib diisi");
  const permission = String(input.permission ?? "read") as CustomToolPermission;
  if (!PERMISSIONS.has(permission)) throw new Error("permission harus read, write, atau exec");
  const timeout = Number(input.timeout_ms ?? DEFAULT_TIMEOUT);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > MAX_TIMEOUT) {
    throw new Error(`timeout_ms harus bilangan bulat 1000-${MAX_TIMEOUT}`);
  }
  return { name, description, permission, timeoutMs: timeout, schema: validateSchema(input.schema) };
}

function manifestFiles(root: string): string[] {
  const dir = join(root, ".rann", "tools");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.(json|mjs|js|ts)$/.test(name) && !name.endsWith(".d.ts"))
    .sort()
    .map((name) => join(dir, name));
}

function parseManifest(file: string): CustomTool {
  const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const meta = normalizeMeta(data);
  const command = typeof data.command === "string" ? data.command.trim() : "";
  if (command.length === 0) throw new Error("command wajib diisi");
  const args = Array.isArray(data.args) ? data.args.map((item) => String(item)) : [];
  return { ...meta, source: file, kind: "command", command, args };
}

async function importModule(file: string): Promise<CustomTool> {
  const stat = statSync(file);
  const url = file.endsWith(".ts")
    ? `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" })).toString("base64")}`
    : `${pathToFileURL(file).href}?v=${stat.mtimeMs}`;
  let module: Record<string, unknown>;
  try {
    module = (await import(url)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : JSON.stringify(error));
  }
  const metaInput = (module.meta ?? module.tool ?? module) as Record<string, unknown>;
  const meta = normalizeMeta({ ...metaInput, schema: module.schema ?? metaInput.schema });
  const runner = module.default ?? module.run;
  if (typeof runner !== "function") throw new Error("modul harus mengekspor default function atau run()");
  return { ...meta, source: file, kind: "module", run: runner as CustomTool["run"] };
}

export async function loadCustomTools(workspaceRoot: string): Promise<CustomToolLoadResult> {
  const tools: CustomTool[] = [];
  const errors: CustomToolLoadResult["errors"] = [];
  const seen = new Set<string>();
  for (const file of manifestFiles(resolve(workspaceRoot))) {
    try {
      const tool = file.endsWith(".json") ? parseManifest(file) : await importModule(file);
      if (seen.has(tool.name)) throw new Error(`nama tool duplikat: ${tool.name}`);
      seen.add(tool.name);
      tools.push(tool);
    } catch (error) {
      errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { tools, errors };
}

export function customToolSpecs(tools: CustomTool[]): ToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.schema as ToolSpec["parameters"]
  }));
}

export async function runCustomTool(tool: CustomTool, input: unknown, context: { workspaceRoot: string; signal?: AbortSignal }): Promise<{ ok: boolean; output: unknown; code?: string; exitCode?: number }> {
  if (tool.kind === "module") {
    const output = await tool.run!(input, { workspaceRoot: context.workspaceRoot, signal: context.signal, permission: tool.permission });
    return { ok: true, output };
  }
  return await new Promise((resolvePromise) => {
    const child = spawn(tool.command!, tool.args ?? [], {
      cwd: context.workspaceRoot,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "" },
      stdio: ["pipe", "pipe", "pipe"],
      signal: context.signal
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: { ok: boolean; output: unknown; code?: string; exitCode?: number }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, output: "", code: "E_TOOL_TIMEOUT", exitCode: 124 });
    }, tool.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 1_000_000) {
        child.kill("SIGKILL");
        finish({ ok: false, output: "", code: "E_TOOL_FAILED", exitCode: 1 });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 200_000) stderr = stderr.slice(0, 200_000);
    });
    child.on("error", (error) => finish({ ok: false, output: { error: error.message }, code: "E_TOOL_FAILED", exitCode: 1 }));
    child.on("close", (code) => {
      const trimmed = stdout.trim();
      if (code !== 0) {
        finish({ ok: false, output: { error: stderr.trim() || trimmed, exit_code: code }, code: "E_TOOL_FAILED", exitCode: code ?? 1 });
        return;
      }
      try {
        finish({ ok: true, output: trimmed.length === 0 ? null : JSON.parse(trimmed) });
      } catch {
        finish({ ok: false, output: { error: "output tool bukan JSON valid", output: trimmed.slice(0, 2_000) }, code: "E_TOOL_FAILED", exitCode: 1 });
      }
    });
    child.stdin.end(JSON.stringify(input ?? {}));
  });
}
