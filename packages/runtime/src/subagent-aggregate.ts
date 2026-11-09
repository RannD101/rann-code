export interface SubagentResult {
  id: string;
  profile: string;
  status: "done" | "failed" | "cancelled";
  evidence?: string;
  costUsd: number;
  conflicts?: string[];
}

export interface AggregatedSubagents {
  total: number;
  done: number;
  failed: number;
  cancelled: number;
  costUsd: number;
  evidence: Array<{ id: string; profile: string; evidence: string }>;
  conflicts: string[];
}

/** Gabungkan hasil beberapa subagent untuk laporan induk (AC-056). */
export function aggregateSubagentResults(results: SubagentResult[]): AggregatedSubagents {
  return {
    total: results.length,
    done: results.filter((result) => result.status === "done").length,
    failed: results.filter((result) => result.status === "failed").length,
    cancelled: results.filter((result) => result.status === "cancelled").length,
    costUsd: results.reduce((sum, result) => sum + result.costUsd, 0),
    evidence: results
      .filter((result) => typeof result.evidence === "string" && result.evidence.length > 0)
      .map((result) => ({ id: result.id, profile: result.profile, evidence: result.evidence! })),
    conflicts: results.flatMap((result) => result.conflicts ?? [])
  };
}
