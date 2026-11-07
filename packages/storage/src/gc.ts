import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import type { Db } from "./db.js";

export interface GcResult {
  memories: number;
  artifacts: number;
  files: number;
  events: number;
}

export function gcStorage(db: Db, retentionDays = 30, artifactsDir?: string): GcResult {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000;
  const result: GcResult = { memories: 0, artifacts: 0, files: 0, events: 0 };
  const tx = db.transaction(() => {
    result.memories = db.prepare("DELETE FROM memories WHERE scope != 'global' AND updated_at < ? AND (expires_at IS NULL OR expires_at < ?)").run(cutoff, Date.now()).changes;
    const stale = db.prepare("SELECT id, path FROM artifacts WHERE created_at < ?").all(cutoff) as Array<{ id: string; path: string }>;
    for (const row of stale) {
      if (artifactsDir && row.path.startsWith(artifactsDir) && existsSync(row.path)) {
        try {
          rmSync(row.path, { force: true });
          result.files += 1;
        } catch {
          continue;
        }
      }
      db.prepare("DELETE FROM artifacts WHERE id = ?").run(row.id);
      result.artifacts += 1;
    }
    result.events = db.prepare("DELETE FROM events WHERE created_at < ?").run(cutoff).changes;
  });
  tx();
  return result;
}

export function gcReport(artifactsDir: string): { files: number; bytes: number } {
  if (!existsSync(artifactsDir)) return { files: 0, bytes: 0 };
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(artifactsDir)) {
    const path = `${artifactsDir}/${entry}`;
    try {
      const stat = statSync(path);
      if (stat.isFile()) {
        files += 1;
        bytes += stat.size;
      }
    } catch {
      // berkas hilang di tengah pemindaian
    }
  }
  return { files, bytes };
}
