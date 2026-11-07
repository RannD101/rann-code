import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import { RannError } from "@rann/shared";

export interface BackupInfo {
  path: string;
  size: number;
  created_at: string;
}

function openReadonly(path: string): Database.Database {
  if (!existsSync(path)) throw new RannError("E_NOT_FOUND", `Database tidak ditemukan: ${path}`);
  return new Database(path, { readonly: true, fileMustExist: true });
}

export function verifyBackup(path: string): { ok: boolean; integrity: string; foreign_keys: number } {
  const db = openReadonly(path);
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const foreign = db.pragma("foreign_key_check") as unknown[];
    return { ok: integrity === "ok" && foreign.length === 0, integrity: String(integrity), foreign_keys: foreign.length };
  } finally {
    db.close();
  }
}

export function createBackup(dbPath: string, backupDir = join(dirname(dbPath), "backups"), retentionDays = 30): BackupInfo {
  if (!existsSync(dbPath)) throw new RannError("E_NOT_FOUND", `Database tidak ditemukan: ${dbPath}`);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const target = join(backupDir, `rann-${stamp}.db`);
  const db = openReadonly(dbPath);
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new RannError("E_DB", `Database sumber gagal integrity_check: ${String(integrity)}`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  chmodSync(target, 0o600);
  const check = verifyBackup(target);
  if (!check.ok) {
    rmSync(target, { force: true });
    throw new RannError("E_DB", `Backup gagal diverifikasi: integrity=${check.integrity} foreign_keys=${check.foreign_keys}`);
  }
  pruneBackups(backupDir, retentionDays);
  return { path: target, size: statSync(target).size, created_at: new Date().toISOString() };
}

export function listBackups(backupDir: string): BackupInfo[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((name) => /^rann-\d{8}T\d{6}\.db$/.test(name))
    .map((name) => {
      const path = join(backupDir, name);
      const stat = statSync(path);
      return { path, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function pruneBackups(backupDir: string, retentionDays: number): string[] {
  if (retentionDays <= 0) return [];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000;
  const removed: string[] = [];
  for (const item of listBackups(backupDir)) {
    if (statSync(item.path).mtimeMs < cutoff) {
      rmSync(item.path, { force: true });
      removed.push(item.path);
    }
  }
  return removed;
}

export function restoreBackup(backupPath: string, dbPath: string): { restored: string; safety_copy: string } {
  const check = verifyBackup(backupPath);
  if (!check.ok) throw new RannError("E_DB", `Backup tidak valid: integrity=${check.integrity} foreign_keys=${check.foreign_keys}`);
  let safety = "";
  if (existsSync(dbPath)) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
    safety = join(dirname(dbPath), `pre-restore-${stamp}.db`);
    copyFileSync(dbPath, safety);
    chmodSync(safety, 0o600);
  }
  copyFileSync(backupPath, dbPath);
  chmodSync(dbPath, 0o600);
  const after = verifyBackup(dbPath);
  if (!after.ok) throw new RannError("E_DB", `Restore gagal diverifikasi, salinan lama ada di ${safety}`);
  return { restored: basename(backupPath), safety_copy: safety };
}
