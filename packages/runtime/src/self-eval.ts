export interface TaskOutcome {
  title: string;
  status: "done" | "failed" | "cancelled" | "paused";
  errorCode?: string;
  skill?: string;
  skillSucceeded?: boolean;
}

export interface SelfEvaluation {
  total: number;
  failurePatterns: Array<{ code: string; count: number }>;
  skillEffectiveness: Array<{ skill: string; uses: number; successRate: number }>;
  suggestions: string[];
}

/** Ringkas 20 hasil task menjadi pola kegagalan, efektivitas skill, dan saran (AC-151). */
export function evaluateOutcomes(outcomes: TaskOutcome[]): SelfEvaluation {
  const failures = new Map<string, number>();
  const skills = new Map<string, { uses: number; success: number }>();
  for (const outcome of outcomes) {
    if (outcome.status !== "done") failures.set(outcome.errorCode ?? outcome.status, (failures.get(outcome.errorCode ?? outcome.status) ?? 0) + 1);
    if (outcome.skill) {
      const record = skills.get(outcome.skill) ?? { uses: 0, success: 0 };
      record.uses += 1;
      if (outcome.skillSucceeded) record.success += 1;
      skills.set(outcome.skill, record);
    }
  }
  const failurePatterns = [...failures.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
  const skillEffectiveness = [...skills.entries()].map(([skill, record]) => ({
    skill,
    uses: record.uses,
    successRate: record.uses > 0 ? record.success / record.uses : 0
  }));
  const suggestions = failurePatterns.slice(0, 3).map((pattern) => `Perbaiki pola ${pattern.code} (${pattern.count} kali)`);
  if (skillEffectiveness.some((skill) => skill.successRate < 0.5)) suggestions.push("Tinjau skill dengan tingkat keberhasilan di bawah 50 persen");
  return { total: outcomes.length, failurePatterns, skillEffectiveness, suggestions };
}
