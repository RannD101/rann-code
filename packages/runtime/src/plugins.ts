import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RannError } from "@rann/shared";

export const PLUGIN_API_VERSION = "1.0.0";
export type PluginStatus = "installed" | "enabled" | "disabled" | "error";

export interface PluginManifest {
  name: string;
  version: string;
  apiVersion: string;
  entry: string;
  permissions: string[];
  dependencies?: string[];
  hooks?: Record<string, string>;
  tools?: Array<{ name: string; description?: string; command?: string }>;
  commands?: Array<{ name: string; description?: string }>;
  changelog?: string;
}

export interface PluginInfo {
  name: string;
  version: string;
  apiVersion: string;
  status: PluginStatus;
  permissions: string[];
  dependencies: string[];
  path: string;
  stale: boolean;
  last_error?: string;
  installed_at?: number;
  updated_at?: number;
}

export interface InstallOptions {
  scope?: "global" | "project";
  name?: string;
  approve?: boolean;
  checksum?: string;
  allowUnsigned?: boolean;
  sourceType?: "folder" | "tarball";
  overwrite?: boolean;
}

type ChildResult = { ok: boolean; output?: unknown; error?: string };

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_PLUGIN_BYTES = 20_000_000;
const MAX_FILES = 2_000;
const STALE_MS = 90 * 24 * 60 * 60 * 1_000;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => value.split(/[.+-]/).slice(0, 3).map((item) => Number.parseInt(item, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function satisfiesApiRange(range: string, version = PLUGIN_API_VERSION): boolean {
  const text = range.trim();
  if (!text || text === "*") return true;
  for (const part of text.split("||")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    let matched = true;
    for (const token of tokens) {
      let ok = false;
      if (token.startsWith("^")) {
        const base = token.slice(1);
        const major = Number.parseInt(base.split(".")[0] ?? "0", 10);
        ok = compareVersions(version, base) >= 0 && compareVersions(version, `${major + 1}.0.0`) < 0;
      } else if (token.startsWith("~")) {
        const base = token.slice(1);
        const major = Number.parseInt(base.split(".")[0] ?? "0", 10);
        const minor = Number.parseInt(base.split(".")[1] ?? "0", 10);
        ok = compareVersions(version, base) >= 0 && compareVersions(version, `${major}.${minor + 1}.0`) < 0;
      } else if (token.startsWith(">=")) {
        ok = compareVersions(version, token.slice(2)) >= 0;
      } else if (token.startsWith(">")) {
        ok = compareVersions(version, token.slice(1)) > 0;
      } else if (token.startsWith("<=")) {
        ok = compareVersions(version, token.slice(2)) <= 0;
      } else if (token.startsWith("<")) {
        ok = compareVersions(version, token.slice(1)) < 0;
      } else if (token.startsWith("=")) {
        ok = compareVersions(version, token.slice(1)) === 0;
      } else {
        ok = compareVersions(version, token) === 0;
      }
      if (!ok) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

export function validateManifest(raw: unknown): PluginManifest {
  if (typeof raw !== "object" || raw === null) throw new RannError("E_CONFIG_INVALID", "Manifest plugin harus objek JSON");
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!NAME_RE.test(name)) throw new RannError("E_CONFIG_INVALID", "Nama plugin harus huruf kecil, angka, titik, garis bawah, atau strip");
  const version = typeof record.version === "string" ? record.version.trim() : "";
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new RannError("E_CONFIG_INVALID", `Versi plugin tidak valid: ${version || "(kosong)"}`);
  const apiVersion = typeof record.apiVersion === "string" ? record.apiVersion.trim() : "";
  if (!apiVersion) throw new RannError("E_CONFIG_INVALID", "Manifest harus menyebut apiVersion");
  if (!satisfiesApiRange(apiVersion)) {
    throw new RannError("E_CONFIG_INVALID", `Plugin butuh API ${apiVersion}; API tersedia ${PLUGIN_API_VERSION}`);
  }
  const entry = typeof record.entry === "string" ? record.entry.trim() : "";
  if (!entry || entry.startsWith("/") || entry.includes("..")) throw new RannError("E_CONFIG_INVALID", "entry plugin harus path relatif tanpa ..");
  const permissions = Array.isArray(record.permissions) ? record.permissions.filter((item): item is string => typeof item === "string") : [];
  const dependencies = Array.isArray(record.dependencies) ? record.dependencies.filter((item): item is string => typeof item === "string") : [];
  const hooks = typeof record.hooks === "object" && record.hooks !== null ? (record.hooks as Record<string, string>) : undefined;
  const tools = Array.isArray(record.tools) ? (record.tools as PluginManifest["tools"]) : undefined;
  const commands = Array.isArray(record.commands) ? (record.commands as PluginManifest["commands"]) : undefined;
  return {
    name,
    version,
    apiVersion,
    entry,
    permissions,
    dependencies,
    ...(hooks ? { hooks } : {}),
    ...(tools ? { tools } : {}),
    ...(commands ? { commands } : {}),
    ...(typeof record.changelog === "string" ? { changelog: record.changelog } : {})
  };
}

function countFiles(root: string): number {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else count += 1;
      if (count > MAX_FILES) return count;
    }
  }
  return count;
}

export class PluginManager {
  private readonly globalRoot: string;
  private readonly projectRoot?: string;

  constructor(
    profileDir: string,
    projectPath?: string
  ) {
    this.globalRoot = join(profileDir, "plugins");
    this.projectRoot = projectPath ? join(projectPath, ".rann", "plugins") : undefined;
  }

  private root(scope: "global" | "project"): string {
    if (scope === "project") {
      if (!this.projectRoot) throw new RannError("E_CONFIG_INVALID", "Tidak ada project path untuk plugin scope project");
      return this.projectRoot;
    }
    return this.globalRoot;
  }

  private readManifest(path: string): PluginManifest {
    const file = join(path, "manifest.json");
    if (!existsSync(file)) throw new RannError("E_CONFIG_INVALID", `manifest.json tidak ditemukan di ${path}`);
    return validateManifest(JSON.parse(readFileSync(file, "utf8")));
  }

  private statePath(scope: "global" | "project"): string {
    return join(this.root(scope), "plugins-state.json");
  }

  private readState(scope: "global" | "project"): Record<string, { status?: PluginStatus; error?: string; installed_at?: number; updated_at?: number; previous?: string }> {
    const path = this.statePath(scope);
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, { status?: PluginStatus; error?: string; installed_at?: number; updated_at?: number; previous?: string }>;
    } catch {
      return {};
    }
  }

  private writeState(scope: "global" | "project", state: Record<string, { status?: PluginStatus; error?: string; installed_at?: number; updated_at?: number; previous?: string }>): void {
    const path = this.statePath(scope);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  }

  private findScope(name: string): "global" | "project" | undefined {
    if (this.projectRoot && existsSync(join(this.projectRoot, name, "manifest.json"))) return "project";
    if (existsSync(join(this.globalRoot, name, "manifest.json"))) return "global";
    return undefined;
  }

  list(): PluginInfo[] {
    const items: PluginInfo[] = [];
    for (const scope of ["project", "global"] as const) {
      if (scope === "project" && !this.projectRoot) continue;
      const root = this.root(scope);
      if (!existsSync(root)) continue;
      const state = this.readState(scope);
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        const path = join(root, entry.name);
        try {
          const manifest = this.readManifest(path);
          const status = state[manifest.name]?.status ?? "installed";
          const updated = statSync(join(path, "manifest.json")).mtimeMs;
          items.push({
            name: manifest.name,
            version: manifest.version,
            apiVersion: manifest.apiVersion,
            status,
            permissions: manifest.permissions,
            dependencies: manifest.dependencies ?? [],
            path,
            stale: Date.now() - updated > STALE_MS,
            ...(state[manifest.name]?.error ? { last_error: state[manifest.name]!.error } : {}),
            ...(state[manifest.name]?.installed_at ? { installed_at: state[manifest.name]!.installed_at } : {}),
            updated_at: updated
          });
        } catch (error) {
          items.push({
            name: entry.name,
            version: "0.0.0",
            apiVersion: "unknown",
            status: "error",
            permissions: [],
            dependencies: [],
            path,
            stale: false,
            last_error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    return items;
  }

  get(name: string): PluginInfo | undefined {
    return this.list().find((item) => item.name === name);
  }

  private checkConflict(name: string, scope: "global" | "project", overwrite: boolean): void {
    const existing = this.findScope(name);
    if (existing && !overwrite) throw new RannError("E_TOOL_FAILED", `Plugin ${name} sudah terdaftar (${existing}); pakai overwrite untuk memperbarui`);
    if (existing === "project" && scope === "global") {
      throw new RannError("E_TOOL_FAILED", `Plugin ${name} sudah ada di scope project; tidak boleh ditimpa dari global`);
    }
  }

  installFolder(source: string, options: InstallOptions = {}): PluginInfo {
    const resolved = resolve(source);
    if (!existsSync(resolved)) throw new RannError("E_TOOL_FAILED", `Sumber plugin tidak ditemukan: ${resolved}`);
    if (!statSync(resolved).isDirectory()) throw new RannError("E_TOOL_FAILED", `Sumber plugin bukan folder: ${resolved}`);
    if (countFiles(resolved) > MAX_FILES) throw new RannError("E_TOOL_FAILED", `Plugin melebihi ${MAX_FILES} berkas`);
    const manifest = this.readManifest(resolved);
    const scope = options.scope ?? "project";
    this.checkConflict(manifest.name, scope, options.overwrite === true);
    const target = join(this.root(scope), options.name ?? manifest.name);
    mkdirSync(join(target, ".."), { recursive: true });
    const temp = `${target}.tmp-${process.pid}`;
    rmSync(temp, { recursive: true, force: true });
    cpSync(resolved, temp, { recursive: true, filter: (path) => !path.includes(`${join(resolved, "node_modules")}`) && !path.includes(`${join(resolved, ".git")}`) });
    rmSync(target, { recursive: true, force: true });
    renameSync(temp, target);
    const state = this.readState(scope);
    state[manifest.name] = {
      ...(state[manifest.name]?.previous ? { previous: state[manifest.name]!.previous } : {}),
      status: "installed",
      installed_at: state[manifest.name]?.installed_at ?? Date.now(),
      updated_at: Date.now()
    };
    this.writeState(scope, state);
    return this.get(manifest.name)!;
  }

  async installTarball(url: string, options: InstallOptions = {}): Promise<PluginInfo> {
    if (!/^https:\/\//i.test(url)) throw new RannError("E_TOOL_FAILED", "Tarball plugin hanya boleh dari HTTPS");
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new RannError("E_TOOL_FAILED", `Unduh plugin gagal: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PLUGIN_BYTES) throw new RannError("E_TOOL_FAILED", `Ukuran plugin melebihi ${MAX_PLUGIN_BYTES} byte`);
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (options.checksum && digest !== options.checksum.toLowerCase()) {
      throw new RannError("E_TOOL_FAILED", `Checksum plugin tidak cocok: ${digest}`);
    }
    if (!options.checksum && options.allowUnsigned !== true) {
      throw new RannError("E_TOOL_FAILED", "Tarball plugin butuh checksum sha256; set allowUnsigned untuk menerima risiko");
    }
    const tempDir = join(this.globalRoot, `.tmp-${process.pid}-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const archive = join(tempDir, "plugin.tgz");
    writeFileSync(archive, buffer, { mode: 0o600 });
    const extract = join(tempDir, "extract");
    mkdirSync(extract, { recursive: true });
    try {
      const { execFileSync } = await import("node:child_process");
      const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 4_000_000 });
      for (const line of listing.split("\n").filter(Boolean)) {
        if (line.startsWith("/") || line.split("/").includes("..")) throw new RannError("E_TOOL_FAILED", `Arsip plugin berisi path tidak aman: ${line}`);
      }
      execFileSync("tar", ["-xzf", archive, "-C", extract], { maxBuffer: 4_000_000 });
      const entries = readdirSync(extract, { withFileTypes: true }).filter((entry) => entry.isDirectory());
      const root = entries.length === 1 ? join(extract, entries[0]!.name) : extract;
      return this.installFolder(root, options);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  async install(source: string, options: InstallOptions = {}): Promise<PluginInfo> {
    if (/^https:\/\//i.test(source)) return this.installTarball(source, options);
    return this.installFolder(source, options);
  }

  private setStatus(name: string, status: PluginStatus, error?: string): PluginInfo {
    const scope = this.findScope(name);
    if (!scope) throw new RannError("E_TOOL_FAILED", `Plugin tidak ditemukan: ${name}`);
    const state = this.readState(scope);
    state[name] = { ...state[name], status, ...(error ? { error } : {}) };
    if (!error) delete state[name]!.error;
    this.writeState(scope, state);
    return this.get(name)!;
  }

  enable(name: string): PluginInfo {
    const plugin = this.get(name);
    if (!plugin) throw new RannError("E_TOOL_FAILED", `Plugin tidak ditemukan: ${name}`);
    const manifest = this.readManifest(plugin.path);
    if (!satisfiesApiRange(manifest.apiVersion)) {
      throw new RannError("E_CONFIG_INVALID", `Plugin ${name} butuh API ${manifest.apiVersion}; tersedia ${PLUGIN_API_VERSION}`);
    }
    for (const dependency of manifest.dependencies ?? []) {
      const found = this.get(dependency);
      if (!found) throw new RannError("E_TOOL_FAILED", `Dependensi plugin hilang: ${dependency}`);
      if (found.status !== "enabled" && found.status !== "installed") throw new RannError("E_TOOL_FAILED", `Dependensi ${dependency} berstatus ${found.status}`);
    }
    if (plugin.status === "error") this.setStatus(name, "installed");
    return this.setStatus(name, "enabled");
  }

  disable(name: string): PluginInfo {
    return this.setStatus(name, "disabled");
  }

  markError(name: string, error: string): PluginInfo {
    return this.setStatus(name, "error", error);
  }

  remove(name: string): { removed: boolean } {
    const scope = this.findScope(name);
    if (!scope) return { removed: false };
    rmSync(join(this.root(scope), name), { recursive: true, force: true });
    const state = this.readState(scope);
    delete state[name];
    this.writeState(scope, state);
    return { removed: true };
  }

  update(name: string, source?: string): PluginInfo {
    const plugin = this.get(name);
    if (!plugin) throw new RannError("E_TOOL_FAILED", `Plugin tidak ditemukan: ${name}`);
    const manifest = this.readManifest(source ? resolve(source) : plugin.path);
    if (!satisfiesApiRange(manifest.apiVersion)) throw new RannError("E_CONFIG_INVALID", `Versi API plugin tidak kompatibel: ${manifest.apiVersion}`);
    const scope = this.findScope(name);
    if (!scope) throw new RannError("E_TOOL_FAILED", `Plugin tidak ditemukan: ${name}`);
    const state = this.readState(scope);
    const previous = join(this.root(scope), `.previous-${name}-${Date.now()}`);
    cpSync(plugin.path, previous, { recursive: true });
    state[name] = { ...state[name], previous, updated_at: Date.now() };
    this.writeState(scope, state);
    if (!source) return this.get(name)!;
    return this.installFolder(source, { scope, name, overwrite: true, allowUnsigned: true });
  }

  rollback(name: string): PluginInfo {
    const scope = this.findScope(name);
    if (!scope) throw new RannError("E_TOOL_FAILED", `Plugin tidak ditemukan: ${name}`);
    const state = this.readState(scope);
    const previous = state[name]?.previous;
    if (!previous || !existsSync(previous)) throw new RannError("E_TOOL_FAILED", `Tidak ada versi sebelumnya untuk ${name}`);
    const target = join(this.root(scope), name);
    rmSync(target, { recursive: true, force: true });
    cpSync(previous, target, { recursive: true });
    delete state[name]!.previous;
    state[name]!.updated_at = Date.now();
    this.writeState(scope, state);
    return this.get(name)!;
  }

  async invoke(name: string, method: string, params: unknown, timeoutMs = 30_000): Promise<ChildResult> {
    const plugin = this.get(name);
    if (!plugin) return { ok: false, error: `Plugin tidak ditemukan: ${name}` };
    if (plugin.status !== "enabled") return { ok: false, error: `Plugin ${name} belum aktif (status ${plugin.status}); jalankan plugin enable` };
    const manifest = this.readManifest(plugin.path);
    const entry = resolve(plugin.path, manifest.entry);
    if (!existsSync(entry)) return { ok: false, error: `Entry plugin tidak ditemukan: ${entry}` };
    const { spawn } = await import("node:child_process");
    return await new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [entry], {
        cwd: plugin.path,
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", RANN_PLUGIN_API: PLUGIN_API_VERSION },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      let stdout = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        this.markError(name, `Timeout ${timeoutMs} ms`);
        resolvePromise({ ok: false, error: `Timeout ${timeoutMs} ms` });
      }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({ ok: false, error: error.message });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          this.markError(name, `Plugin keluar dengan kode ${code}`);
          resolvePromise({ ok: false, error: stdout.slice(-2_000) || `kode ${code}` });
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as { result?: unknown; error?: string };
          if (parsed.error) resolvePromise({ ok: false, error: parsed.error });
          else resolvePromise({ ok: true, output: parsed.result ?? parsed });
        } catch {
          resolvePromise({ ok: true, output: stdout.slice(0, 20_000) });
        }
      });
      child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`);
    });
  }
}

export { sha256File, compareVersions, NAME_RE, MAX_PLUGIN_BYTES, MAX_FILES, STALE_MS };
