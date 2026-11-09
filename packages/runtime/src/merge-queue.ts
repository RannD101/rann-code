export interface MergeChange {
  agent: string;
  path: string;
  hash: string;
}

export interface MergeConflict {
  path: string;
  agents: string[];
  hashes: string[];
}

/** Deteksi dua agen mengubah path yang sama dengan isi berbeda (AC-117). */
export function detectMergeConflicts(changes: MergeChange[]): MergeConflict[] {
  const byPath = new Map<string, MergeChange[]>();
  for (const change of changes) {
    byPath.set(change.path, [...(byPath.get(change.path) ?? []), change]);
  }
  const conflicts: MergeConflict[] = [];
  for (const [path, items] of byPath) {
    const agents = [...new Set(items.map((item) => item.agent))];
    const hashes = [...new Set(items.map((item) => item.hash))];
    if (agents.length > 1 && hashes.length > 1) conflicts.push({ path, agents, hashes });
  }
  return conflicts;
}
