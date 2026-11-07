import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Db } from "@rann/storage";
import {
  addPlanNode,
  cancelOpenTasks,
  createPlan,
  createTask,
  getPlan,
  updatePlan,
  updatePlanStatus,
  updateTaskStatus
} from "@rann/storage";
import { validatePlan, type PlanDraft, type PlanValidation } from "./planner.js";

export interface ActivePlan {
  id: string;
  version: number;
  draft: PlanDraft;
  validation: PlanValidation;
  taskIds: Map<string, string>;
  text: string;
}

export interface VerificationResult {
  passed: boolean;
  gaps: string[];
  checked: number;
}

export function persistPlan(
  db: Db,
  sessionId: string,
  turnId: string,
  draft: PlanDraft,
  validation: PlanValidation,
  text: string,
  publish: (type: "plan.update" | "task.update", data: Record<string, unknown>) => void
): ActivePlan {
  const row = createPlan(db, {
    sessionId,
    turnId,
    goal: draft.goal,
    metadata: {
      assumptions: draft.assumptions,
      criteria: draft.criteria,
      estimate: draft.estimate,
      risks: draft.risks,
      validation
    }
  });
  const taskIds = new Map<string, string>();
  for (const planTask of draft.tasks) {
    const task = createTask(db, {
      sessionId,
      planId: row.id,
      title: planTask.title,
      description: planTask.description ?? "",
      priority: planTask.risk === "high" ? 3 : planTask.risk === "medium" ? 2 : 1,
      metadata: {
        planTaskId: planTask.id,
        agent: planTask.agent,
        files: planTask.files,
        risk: planTask.risk,
        acceptance: planTask.acceptance,
        dependsOn: planTask.dependsOn
      }
    });
    addPlanNode(db, {
      planId: row.id,
      taskId: task.id,
      title: planTask.title,
      kind: "task",
      dependsOn: planTask.dependsOn,
      metadata: { planTaskId: planTask.id, risk: planTask.risk, files: planTask.files }
    });
    taskIds.set(planTask.id, task.id);
    publish("task.update", { task_id: task.id, plan_task_id: planTask.id, status: "queued", title: planTask.title });
  }
  updatePlanStatus(db, row.id, "active");
  publish("plan.update", {
    plan_id: row.id,
    status: "active",
    version: row.version,
    tasks: draft.tasks.length,
    high_risk: validation.highRisk
  });
  return { id: row.id, version: row.version, draft, validation, taskIds, text };
}

export function startFirstTask(db: Db, plan: ActivePlan, publish: (type: "task.update", data: Record<string, unknown>) => void): void {
  const first = plan.draft.tasks.find((task) => task.dependsOn.length === 0);
  if (!first) return;
  const id = plan.taskIds.get(first.id);
  if (!id) return;
  updateTaskStatus(db, id, "running");
  publish("task.update", { task_id: id, plan_task_id: first.id, status: "running", title: first.title });
}

export function revisePlan(
  db: Db,
  plan: ActivePlan,
  revision: {
    reason: string;
    goal?: string;
    assumptions?: string[];
    criteria?: PlanDraft["criteria"];
    estimate?: PlanDraft["estimate"];
    tasks: PlanDraft["tasks"];
  },
  publish: (type: "plan.update" | "task.update", data: Record<string, unknown>) => void
): ActivePlan {
  const row = getPlan(db, plan.id);
  if (!row) throw new Error("plan tidak ditemukan");
  const previous = JSON.parse(row.metadata_json) as Record<string, unknown>;
  const completed = new Set(
    (
      db
        .prepare("SELECT metadata_json FROM tasks WHERE plan_id = ? AND status = 'done'")
        .all(plan.id) as { metadata_json: string }[]
    )
      .map((task) => {
        try {
          return String((JSON.parse(task.metadata_json) as { planTaskId?: unknown }).planTaskId ?? "");
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );
  const tasks = revision.tasks
    .filter((task) => !completed.has(task.id))
    .map((task) => ({ ...task, dependsOn: task.dependsOn.filter((dep) => !completed.has(dep)) }));
  const goal = revision.goal ?? plan.draft.goal;
  const criteria = revision.criteria ?? plan.draft.criteria;
  const draft: PlanDraft = {
    goal,
    assumptions: revision.assumptions ?? plan.draft.assumptions,
    criteria,
    tasks,
    estimate: revision.estimate ?? plan.draft.estimate,
    risks: tasks
      .filter((task) => task.risk !== "low")
      .map((task) => ({ taskId: task.id, level: task.risk, reason: revision.reason }))
  };
  const validation = validatePlan(draft);
  if (!validation.ok) {
    const error = new Error(`rencana revisi tidak valid: ${validation.errors.join("; ")}`);
    (error as Error & { code?: string }).code = "E_PLAN_INVALID";
    throw error;
  }
  const version = row.version + 1;
  const history = Array.isArray(previous.revisions) ? previous.revisions : [];
  const metadata = {
    ...previous,
    assumptions: draft.assumptions,
    criteria: draft.criteria,
    estimate: draft.estimate,
    risks: draft.risks,
    validation,
    revisions: [...history, { version, reason: revision.reason, at: Date.now(), carried_tasks: [...completed] }]
  };
  updatePlan(db, plan.id, { goal, version, metadata });
  cancelOpenTasks(db, plan.id);
  const taskIds = new Map<string, string>();
  for (const planTask of tasks) {
    const task = createTask(db, {
      sessionId: row.session_id,
      planId: plan.id,
      title: planTask.title,
      description: planTask.description ?? "",
      priority: planTask.risk === "high" ? 3 : planTask.risk === "medium" ? 2 : 1,
      metadata: {
        planTaskId: planTask.id,
        agent: planTask.agent,
        files: planTask.files,
        risk: planTask.risk,
        acceptance: planTask.acceptance,
        dependsOn: planTask.dependsOn,
        revision: version
      }
    });
    addPlanNode(db, {
      planId: plan.id,
      taskId: task.id,
      title: planTask.title,
      kind: "task",
      dependsOn: planTask.dependsOn,
      metadata: { planTaskId: planTask.id, risk: planTask.risk, files: planTask.files, revision: version }
    });
    taskIds.set(planTask.id, task.id);
    publish("task.update", {
      task_id: task.id,
      plan_task_id: planTask.id,
      status: "queued",
      title: planTask.title,
      revision: version
    });
  }
  updatePlanStatus(db, plan.id, "active");
  publish("plan.update", {
    plan_id: plan.id,
    status: "active",
    version,
    reason: revision.reason,
    tasks: tasks.length,
    carried: [...completed],
    high_risk: validation.highRisk
  });
  return { id: plan.id, version, draft, validation, taskIds, text: plan.text };
}

export function finishPlan(
  db: Db,
  plan: ActivePlan,
  status: "done" | "failed" | "cancelled",
  publish: (type: "plan.update" | "task.update", data: Record<string, unknown>) => void
): void {
  const tasks = db.prepare("SELECT * FROM tasks WHERE plan_id = ?").all(plan.id) as { id: string; status: string; title: string }[];
  for (const task of tasks) {
    if (task.status === "queued" || task.status === "running" || task.status === "blocked") {
      updateTaskStatus(db, task.id, status);
      publish("task.update", { task_id: task.id, status, title: task.title });
    }
  }
  updatePlanStatus(db, plan.id, status);
  publish("plan.update", { plan_id: plan.id, status });
}

function commandMatches(argsJson: string, command: string): boolean {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const actual = typeof args.command === "string" ? args.command : "";
    return actual.trim() === command.trim();
  } catch {
    return argsJson.includes(command);
  }
}

export function verifyPlan(
  db: Db,
  turnId: string,
  plan: PlanDraft,
  workspaceRoot: string
): VerificationResult {
  const gaps: string[] = [];
  const tools = db
    .prepare("SELECT tool_name, args_json, status, exit_code FROM tool_calls WHERE turn_id = ? ORDER BY created_at")
    .all(turnId) as { tool_name: string; args_json: string; status: string; exit_code: number | null }[];
  let checked = 0;
  for (const criterion of plan.criteria) {
    if (criterion.type === "manual") continue;
    if (criterion.type === "file") {
      if (!criterion.path) {
        gaps.push(`${criterion.id}: kriteria file tanpa path`);
        continue;
      }
      const target = isAbsolute(criterion.path) ? criterion.path : join(workspaceRoot, criterion.path);
      checked += 1;
      if (!existsSync(target)) gaps.push(`${criterion.id}: file tidak ada: ${criterion.path}`);
      continue;
    }
    if (criterion.type === "diff") {
      gaps.push(`${criterion.id}: verifikasi diff belum tersedia`);
      continue;
    }
    const command = criterion.command;
    if (!command) {
      gaps.push(`${criterion.id}: kriteria ${criterion.type} tanpa command`);
      continue;
    }
    checked += 1;
    const match = tools.find(
      (tool) =>
        (tool.tool_name === "shell_run" || tool.tool_name === "shell") &&
        commandMatches(tool.args_json, command) &&
        tool.status === "ok" &&
        (tool.exit_code ?? 0) === 0
    );
    if (!match) gaps.push(`${criterion.id}: perintah verifikasi belum berhasil: ${command}`);
  }
  return { passed: gaps.length === 0, gaps, checked };
}

export function planVerificationGapPrompt(result: VerificationResult): string {
  return [
    "Verifikasi belum lulus. Jangan menyatakan selesai.",
    "Jalankan perintah atau perbaiki bukti berikut, lalu jawab lagi:",
    ...result.gaps.map((gap) => `- ${gap}`)
  ].join("\n");
}
