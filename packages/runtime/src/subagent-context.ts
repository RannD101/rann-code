export interface SharedContextInput {
  goal?: { text: string; done: number; total: number };
  plan?: { goal: string; version: number; status: string };
  decisionSummary?: string;
}

/** Hanya goal, kriteria, plan, dan ringkasan keputusan yang dibagikan ke anak (AC-058). */
export function buildSharedContext(input: SharedContextInput): string {
  const lines: string[] = [];
  if (input.goal) {
    lines.push(`Goal induk: ${input.goal.text}`);
    lines.push(`Kriteria induk: ${input.goal.done}/${input.goal.total} selesai`);
  }
  if (input.plan) lines.push(`Plan induk: ${input.plan.goal} (versi ${input.plan.version}, status ${input.plan.status})`);
  if (input.decisionSummary && input.decisionSummary.trim().length > 0) {
    lines.push(`Ringkasan keputusan induk: ${input.decisionSummary.trim().slice(0, 3_000)}`);
  }
  return lines.join("\n");
}
