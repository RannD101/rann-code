import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
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
      validation,
      snapshots: [{ version: 1, at: Date.now(), reason: "rencana awal", draft }]
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
        title: planTask.title,
        description: planTask.description ?? "",
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
  const rows = db
    .prepare("SELECT id, metadata_json FROM tasks WHERE plan_id = ? AND status = 'queued' ORDER BY priority DESC, created_at ASC")
    .all(plan.id) as { id: string; metadata_json: string }[];
  for (const row of rows) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const deps = Array.isArray(meta.dependsOn) ? (meta.dependsOn as string[]) : [];
    if (deps.length > 0) continue;
    updateTaskStatus(db, row.id, "running");
    publish("task.update", {
      task_id: row.id,
      plan_task_id: String(meta.planTaskId ?? ""),
      status: "running",
      title: String(meta.title ?? "")
    });
    return;
  }
}


export interface PlanTaskView {
  plan_task_id: string;
  task_id: string;
  title: string;
  description: string;
  acceptance: string;
  agent: string;
  risk: string;
  index: number;
  total: number;
}

export function currentPlanTask(db: Db, plan: ActivePlan): PlanTaskView | undefined {
  const rows = db
    .prepare("SELECT id, status, priority, metadata_json FROM tasks WHERE plan_id = ? ORDER BY priority DESC, created_at")
    .all(plan.id) as { id: string; status: string; priority: number; metadata_json: string }[];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.status !== "running") continue;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
    } catch {
      meta = {};
    }
    return {
      plan_task_id: String(meta.planTaskId ?? ""),
      task_id: row.id,
      title: String(meta.title ?? plan.draft.tasks[index]?.title ?? "task"),
      description: String(meta.description ?? plan.draft.tasks[index]?.description ?? ""),
      acceptance: String(meta.acceptance ?? plan.draft.tasks[index]?.acceptance ?? ""),
      agent: String(meta.agent ?? plan.draft.tasks[index]?.agent ?? "coder"),
      risk: String(meta.risk ?? plan.draft.tasks[index]?.risk ?? "low"),
      index: index + 1,
      total: rows.length
    };
  }
  return undefined;
}

export function blockRunningTask(
  db: Db,
  plan: ActivePlan,
  reason: string,
  publish: (type: "task.update", data: Record<string, unknown>) => void
): string | undefined {
  const running = db.prepare("SELECT id, metadata_json FROM tasks WHERE plan_id = ? AND status = 'running'").get(plan.id) as
    | { id: string; metadata_json: string }
    | undefined;
  if (!running) return undefined;
  updateTaskStatus(db, running.id, "blocked");
  let blockedPlanTaskId = "";
  try {
    blockedPlanTaskId = String((JSON.parse(running.metadata_json) as { planTaskId?: unknown }).planTaskId ?? "");
  } catch {
    // metadata rusak tetap ditandai blocked
  }
  publish("task.update", { task_id: running.id, plan_task_id: blockedPlanTaskId, status: "blocked", reason });
  for (const row of db.prepare("SELECT id, metadata_json FROM tasks WHERE plan_id = ? AND status = 'queued'").all(plan.id) as { id: string; metadata_json: string }[]) {
    let deps: string[] = [];
    try {
      const meta = JSON.parse(row.metadata_json) as { dependsOn?: unknown };
      deps = Array.isArray(meta.dependsOn) ? (meta.dependsOn as string[]) : [];
    } catch {
      deps = [];
    }
    if (!deps.includes(blockedPlanTaskId)) continue;
    updateTaskStatus(db, row.id, "blocked");
    publish("task.update", { task_id: row.id, status: "blocked", reason: `menunggu task ${blockedPlanTaskId}` });
  }
  return blockedPlanTaskId;
}

export function advancePlanTask(
  db: Db,
  plan: ActivePlan,
  publish: (type: "task.update", data: Record<string, unknown>) => void
): { next?: PlanTaskView; remaining: number; allDone: boolean } {
  const rows = db
    .prepare("SELECT id, status, metadata_json FROM tasks WHERE plan_id = ? ORDER BY priority DESC, created_at")
    .all(plan.id) as { id: string; status: string; metadata_json: string }[];
  const done = new Set<string>();
  for (const row of rows) {
    if (row.status === "done") {
      try {
        done.add(String((JSON.parse(row.metadata_json) as { planTaskId?: unknown }).planTaskId ?? ""));
      } catch {
        // metadata rusak tidak menghalangi task lain
      }
    }
  }
  const running = rows.find((row) => row.status === "running");
  if (running) {
    updateTaskStatus(db, running.id, "done");
    running.status = "done";
    publish("task.update", { task_id: running.id, status: "done" });
    try {
      done.add(String((JSON.parse(running.metadata_json) as { planTaskId?: unknown }).planTaskId ?? ""));
    } catch {
      // abaikan
    }
  }
  for (const row of rows) {
    if (row.status !== "queued") continue;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
    } catch {
      meta = {};
    }
    const deps = Array.isArray(meta.dependsOn) ? (meta.dependsOn as string[]) : [];
    if (!deps.every((dep) => done.has(dep))) continue;
    updateTaskStatus(db, row.id, "running");
    publish("task.update", { task_id: row.id, status: "running", title: String(meta.title ?? "") });
    const total = rows.length;
    const index = rows.findIndex((item) => item.id === row.id) + 1;
    return {
      next: {
        plan_task_id: String(meta.planTaskId ?? ""),
        task_id: row.id,
        title: String(meta.title ?? ""),
        description: String(meta.description ?? ""),
        acceptance: String(meta.acceptance ?? ""),
        agent: String(meta.agent ?? "coder"),
        risk: String(meta.risk ?? "low"),
        index,
        total
      },
      remaining: rows.filter((item) => item.status !== "done").length,
      allDone: false
    };
  }
  const remaining = rows.filter((item) => item.status !== "done").length;
  if (remaining > 0) {
    for (const row of rows) {
      if (row.status === "queued") {
        updateTaskStatus(db, row.id, "blocked");
        publish("task.update", { task_id: row.id, status: "blocked" });
      }
    }
  }
  return { remaining, allDone: remaining === 0 };
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
    revisions: [...history, { version, reason: revision.reason, at: Date.now(), carried_tasks: [...completed] }],
    snapshots: [
      ...(Array.isArray(previous.snapshots) ? previous.snapshots : []),
      { version, at: Date.now(), reason: revision.reason, draft }
    ]
  };
  const newRow = createPlan(db, {
    sessionId: row.session_id,
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    goal,
    metadata: {}
  });
  updatePlan(db, newRow.id, { version, metadata });
  updatePlanStatus(db, plan.id, "cancelled");
  updatePlan(db, plan.id, {
    metadata: {
      ...previous,
      superseded: true,
      superseded_by: newRow.id,
      superseded_at: Date.now(),
      reason: revision.reason
    }
  });
  cancelOpenTasks(db, plan.id);
  const taskIds = new Map<string, string>();
  for (const planTask of tasks) {
    const task = createTask(db, {
      sessionId: row.session_id,
      planId: newRow.id,
      title: planTask.title,
      description: planTask.description ?? "",
      priority: planTask.risk === "high" ? 3 : planTask.risk === "medium" ? 2 : 1,
      metadata: {
        planTaskId: planTask.id,
        title: planTask.title,
        description: planTask.description ?? "",
        agent: planTask.agent,
        files: planTask.files,
        risk: planTask.risk,
        acceptance: planTask.acceptance,
        dependsOn: planTask.dependsOn,
        revision: version
      }
    });
    addPlanNode(db, {
      planId: newRow.id,
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
  updatePlanStatus(db, newRow.id, "active");
  publish("plan.update", {
    plan_id: newRow.id,
    previous_plan_id: plan.id,
    status: "active",
    version,
    reason: revision.reason,
    tasks: tasks.length,
    carried: [...completed],
    high_risk: validation.highRisk
  });
  return { id: newRow.id, version, draft, validation, taskIds, text: plan.text };
}

function evaluatePlan(db: Db, plan: ActivePlan): Record<string, unknown> {
  const row = db.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, MIN(created_at) AS started_at, MAX(ended_at) AS ended_at FROM tasks WHERE plan_id = ?"
  ).get(plan.id) as { total?: number; done?: number; failed?: number; started_at?: number | null; ended_at?: number | null } | undefined;
  const total = row?.total ?? 0;
  const done = row?.done ?? 0;
  const failed = row?.failed ?? 0;
  const minutes = row?.started_at && row?.ended_at ? Math.max(0, Math.round((row.ended_at - row.started_at) / 60_000)) : null;
  const planRow = getPlan(db, plan.id);
  const interventions = planRow?.turn_id
    ? (db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE turn_id = ?").get(planRow.turn_id) as { n?: number } | undefined)?.n ?? 0
    : 0;
  return {
    total,
    done,
    failed,
    success_rate: total > 0 ? Number((done / total).toFixed(3)) : 0,
    actual_minutes: minutes,
    estimated_minutes: plan.draft.estimate.minutes,
    estimate_source: plan.draft.estimate.source,
    interventions,
    cost_usd: null,
    cost_known: false,
    evaluated_at: Date.now()
  };
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
  const evaluation = evaluatePlan(db, plan);
  const row = getPlan(db, plan.id);
  if (row) {
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    updatePlan(db, plan.id, { metadata: { ...metadata, evaluation } });
  }
  updatePlanStatus(db, plan.id, status);
  publish("plan.update", { plan_id: plan.id, status, evaluation });
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


interface LiveVerifyOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

function runVerificationCommand(command: string, cwd: string, options: LiveVerifyOptions): Promise<{ ok: boolean; code: number | null; output: string; timedOut: boolean }> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  return new Promise((resolvePromise) => {
    const shell = process.platform === "win32" ? "cmd" : "sh";
    const args = process.platform === "win32" ? ["/c", command] : ["-c", command];
    const child = spawn(shell, args, {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let output = "";
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const abort = (): void => {
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const collect = (chunk: Buffer): void => {
      if (output.length < 200_000) output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ok: false, code: null, output: error.message, timedOut: false });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolvePromise({ ok: code === 0 && !timedOut, code, output: output.slice(0, 20_000), timedOut });
    });
  });
}

export interface TestFailure {
  name: string;
  file?: string;
  line?: number;
  message?: string;
}

/** Ambil kegagalan dari keluaran Vitest/Jest, pytest, atau go test. */
export function parseTestFailures(output: string): TestFailure[] {
  const failures: TestFailure[] = [];
  const seen = new Set<string>();
  const add = (failure: TestFailure): void => {
    const key = `${failure.file ?? ""}:${failure.line ?? ""}:${failure.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    failures.push(failure);
  };
  for (const match of output.matchAll(/^\s*(?:FAIL|×|✗)\s+(.+?)(?:\s+>\s+(.+?):(\d+):\d+)?$/gm)) {
    add({ name: match[1]?.trim() ?? "tes gagal", ...(match[2] ? { file: match[2] } : {}), ...(match[3] ? { line: Number(match[3]) } : {}) });
  }
  for (const match of output.matchAll(/^\s*(?:FAILED|ERROR)\s+([^\s:]+(?:::[^\s]+)?)\s*(?:-\s*(.*))?$/gm)) {
    add({ name: match[1] ?? "tes gagal", ...(match[2] ? { message: match[2].trim().slice(0, 200) } : {}) });
  }
  for (const match of output.matchAll(/^--- FAIL: (\S+)(?:\s+\(([^)]+)\))?/gm)) {
    add({ name: match[1] ?? "tes gagal", ...(match[2] ? { message: match[2] } : {}) });
  }
  for (const match of output.matchAll(/(?:AssertionError|Error):\s*([^\n]{5,200})/g)) {
    if (failures.length >= 20) break;
    add({ name: match[1]?.trim() ?? "assertion gagal" });
  }
  return failures.slice(0, 20);
}

export async function verifyPlanLive(
  db: Db,
  turnId: string,
  plan: PlanDraft,
  workspaceRoot: string,
  options: LiveVerifyOptions = {}
): Promise<VerificationResult> {
  const gaps: string[] = [];
  let checked = 0;
  const changes = db
    .prepare("SELECT path, diff_text FROM file_changes WHERE turn_id = ?")
    .all(turnId) as { path: string; diff_text: string | null }[];
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
      checked += 1;
      if (!criterion.path) {
        gaps.push(`${criterion.id}: kriteria diff tanpa path`);
        continue;
      }
      const match = changes.find((change) => change.path === criterion.path || change.path.endsWith(`/${criterion.path}`));
      if (!match || !match.diff_text) gaps.push(`${criterion.id}: belum ada diff untuk ${criterion.path}`);
      continue;
    }
    const command = criterion.command;
    if (!command) {
      gaps.push(`${criterion.id}: kriteria ${criterion.type} tanpa command`);
      continue;
    }
    checked += 1;
    const result = await runVerificationCommand(command, workspaceRoot, options);
    if (!result.ok) {
      const reason = result.timedOut ? `timeout ${options.timeoutMs ?? 120_000} ms` : `exit ${result.code}`;
      const failures = parseTestFailures(result.output);
      const detail = failures.length > 0
        ? failures.slice(0, 5).map((failure) => `${failure.name}${failure.file ? ` (${failure.file}${failure.line ? `:${failure.line}` : ""})` : ""}`).join("; ")
        : result.output.replace(/\s+/g, " ").slice(0, 300);
      gaps.push(`${criterion.id}: ${command} gagal (${reason}): ${detail}`);
    }
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
