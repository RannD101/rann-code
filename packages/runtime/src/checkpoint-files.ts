import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { RannError } from "@rann/shared";

const IGNORED = new Set([".git", "node_modules", "dist", "build", "coverage", ".rann", ".next", "target", "vendor"]);
const MAX_FILES = 5_000;
const MAX_BYTES = 50 * 1024 * 1024;

export interface SnapshotFile {
  path: string;
  sha256: string;
  size: number;
  backup: string;
}

export interface CheckpointManifest {
  id: string;
  label: string;
  created_at: string;
  created_ms: number;
  workspace: string;
  files: SnapshotFile[];
  bytes: number;
  truncated: boolean;
  git_ref?: string;
  task_state?: unknown;
}

let sequence = 0;

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      if (entry.isDirectory()) {
        if (IGNORED.has(entry.name)) continue;
        walk(resolve(dir, entry.name));
      } else if (entry.isFile()) {
        files.push(resolve(dir, entry.name));
      }
    }
  };
  walk(root);
  return files;
}

export function createFileCheckpoint(
  workspaceRoot: string,
  checkpointsDir: string,
  options: { label?: string; paths?: string[]; gitRef?: string; taskState?: unknown } = {}
): CheckpointManifest {
  const createdMs = Date.now();
  sequence += 1;
  const id = `cp_${createdMs}_${String(sequence).padStart(4, "0")}_${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(checkpointsDir, id);
  const filesDir = resolve(dir, "files");
  mkdirSync(filesDir, { recursive: true, mode: 0o700 });

  const candidates = options.paths && options.paths.length > 0
    ? options.paths.map((path) => resolve(workspaceRoot, path))
    : listFiles(workspaceRoot);

  const files: SnapshotFile[] = [];
  let bytes = 0;
  let truncated = false;
  for (const absolute of candidates) {
    if (!existsSync(absolute)) continue;
    if (!absolute.startsWith(resolve(workspaceRoot) + sep)) continue;
    const stat = statSync(absolute);
    if (!stat.isFile()) continue;
    if (bytes + stat.size > MAX_BYTES) {
      truncated = true;
      break;
    }
    const rel = relative(workspaceRoot, absolute);
    const backup = resolve(filesDir, rel);
    mkdirSync(resolve(backup, ".."), { recursive: true, mode: 0o700 });
    copyFileSync(absolute, backup);
    files.push({ path: rel, sha256: hashFile(absolute), size: stat.size, backup });
    bytes += stat.size;
  }

  const manifest: CheckpointManifest = {
    id,
    label: options.label ?? "checkpoint",
    created_at: new Date(createdMs).toISOString(),
    created_ms: createdMs,
    workspace: resolve(workspaceRoot),
    files,
    bytes,
    truncated,
    ...(options.gitRef ? { git_ref: options.gitRef } : {}),
    ...(options.taskState !== undefined ? { task_state: options.taskState } : {})
  };
  writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
}

export function listFileCheckpoints(checkpointsDir: string, limit = 20, workspace?: string): CheckpointManifest[] {
  if (!existsSync(checkpointsDir)) return [];
  const out: CheckpointManifest[] = [];
  for (const name of readdirSync(checkpointsDir)) {
    const path = resolve(checkpointsDir, name, "manifest.json");
    if (!existsSync(path)) continue;
    try {
      const item = JSON.parse(readFileSync(path, "utf8")) as CheckpointManifest;
      if (workspace && item.workspace !== resolve(workspace)) continue;
      out.push(item);
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => b.created_ms - a.created_ms || b.id.localeCompare(a.id)).slice(0, limit);
}

export function readFileCheckpoint(checkpointsDir: string, id: string): CheckpointManifest {
  if (!/^cp_[a-z0-9_]+$/.test(id)) throw new RannError("E_TOOL_INVALID_ARGS", "ID checkpoint tidak valid");
  const path = resolve(checkpointsDir, id, "manifest.json");
  if (!existsSync(path)) throw new RannError("E_TOOL_FAILED", `Checkpoint tidak ditemukan: ${id}`);
  return JSON.parse(readFileSync(path, "utf8")) as CheckpointManifest;
}

export function restoreFileCheckpoint(
  workspaceRoot: string,
  checkpointsDir: string,
  id: string,
  options: { force?: boolean } = {}
): { id: string; restored: string[]; conflicts: string[] } {
  const manifest = readFileCheckpoint(checkpointsDir, id);
  if (manifest.workspace !== resolve(workspaceRoot)) {
    throw new RannError("E_PERMISSION", `Checkpoint milik workspace lain: ${manifest.workspace}`);
  }
  const conflicts: string[] = [];
  for (const file of manifest.files) {
    const target = resolve(workspaceRoot, file.path);
    if (!target.startsWith(resolve(workspaceRoot) + sep)) {
      throw new RannError("E_PERMISSION", `Path checkpoint keluar workspace: ${file.path}`);
    }
    if (existsSync(target) && hashFile(target) !== file.sha256 && options.force !== true) {
      conflicts.push(file.path);
    }
  }
  if (conflicts.length > 0) {
    throw new RannError("E_FILE_CHANGED", `Rollback ditolak, berkas berubah setelah checkpoint: ${conflicts.join(", ")}`, {
      data: { conflicts }
    });
  }
  const restored: string[] = [];
  const backupsRoot = resolve(checkpointsDir, id);
  for (const file of manifest.files) {
    const backupPath = resolve(file.backup);
    if (!backupPath.startsWith(backupsRoot + sep)) {
      throw new RannError("E_PERMISSION", `Berkas backup keluar direktori checkpoint: ${file.path}`);
    }
    const target = resolve(workspaceRoot, file.path);
    mkdirSync(resolve(target, ".."), { recursive: true });
    copyFileSync(backupPath, target);
    restored.push(file.path);
  }
  return { id, restored, conflicts };
}

export function pruneFileCheckpoints(checkpointsDir: string, keep = 20): number {
  const all = listFileCheckpoints(checkpointsDir, Number.MAX_SAFE_INTEGER);
  let removed = 0;
  for (const item of all.slice(keep)) {
    rmSync(resolve(checkpointsDir, item.id), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}
