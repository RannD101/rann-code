import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RannError } from "@rann/shared";
import type { ChatMessage, Provider } from "./providers/types.js";

export type TaskClass = "answer" | "inspect" | "modify" | "operate" | "research" | "incident";
export type RiskLevel = "low" | "medium" | "high";
export type CriterionType = "test" | "build" | "runtime" | "file" | "diff" | "manual";

export interface PlanCriterion {
  id: string;
  type: CriterionType;
  command?: string;
  path?: string;
  expect?: string;
  description?: string;
}

export interface PlanTask {
  id: string;
  title: string;
  description?: string;
  agent: string;
  dependsOn: string[];
  files: string[];
  risk: RiskLevel;
  riskReason?: string;
  acceptance: string;
}

export interface PlanRisk {
  taskId: string;
  level: RiskLevel;
  reason: string;
}

export interface PlanEstimate {
  minutes: [number, number];
  costUsd: [number, number];
  source: "historical" | "heuristic" | "unavailable";
}

export interface PlanDraft {
  goal: string;
  assumptions: string[];
  criteria: PlanCriterion[];
  tasks: PlanTask[];
  estimate: PlanEstimate;
  risks: PlanRisk[];
}

export interface PlanValidation {
  ok: boolean;
  errors: string[];
  order: string[];
  highRisk: boolean;
  fileCount: number;
}

const MODIFY = /\b(buat|tambah|tambahkan|ubah|perbaiki|implementasi|implement|refactor|hapus|tulis|rename|ganti|migrasi|pasang)\b/i;
const OPERATE = /\b(deploy|jalankan|server|daemon|gateway|systemctl|docker|pm2|service|restart|install)\b/i;
const RESEARCH = /\b(cari|bandingkan|riset|penelitian|sumber|paper|artikel|referensi)\b/i;
const INCIDENT = /\b(error|gagal|crash|bug|rusak|down|panic|exception|traceback)\b/i;
const INSPECT = /\b(baca|lihat|cek|periksa|audit|analisis|telusuri|jelaskan|review)\b/i;
const ANSWER = /^(apa|siapa|kapan|di mana|dimana|kenapa|mengapa|bagaimana|berapa|boleh|bisakah)\b/i;

export function classifyTask(text: string): TaskClass {
  const clean = text.trim();
  if (INCIDENT.test(clean)) return "incident";
  if (OPERATE.test(clean)) return "operate";
  if (MODIFY.test(clean)) return "modify";
  if (RESEARCH.test(clean)) return "research";
  if (INSPECT.test(clean)) return "inspect";
  if (ANSWER.test(clean)) return "answer";
  return clean.length > 280 ? "inspect" : "answer";
}

export interface PlanDecision {
  needed: boolean;
  reasons: string[];
}

export function planDecision(taskClass: TaskClass, prompt: string): PlanDecision {
  const reasons: string[] = [];
  const stepMarkers = prompt.match(/(^|\n)\s*(\d+[.)]|[-*])\s+/g)?.length ?? 0;
  if (stepMarkers >= 3) reasons.push(`${stepMarkers} langkah eksplisit`);
  const transitions = prompt.match(/\b(lalu|kemudian|setelah itu|selanjutnya|terakhir)\b/gi)?.length ?? 0;
  if (transitions >= 2) reasons.push(`${transitions} penanda urutan`);
  const paths = new Set(prompt.match(/[A-Za-z0-9_.@/-]+\.[A-Za-z0-9]{1,8}\b/g) ?? []);
  if (paths.size >= 3) reasons.push(`${paths.size} file disebut`);
  if (/\b(migrasi|migration|deploy|rilis|release|upgrade|refactor)\b/i.test(prompt)) reasons.push("operasi besar");
  if (!/^tool:/.test(prompt.trim()) && /\b(api|endpoint|webhook|oauth|database|redis|docker|service|layanan|install|pasang)\b/i.test(prompt)) reasons.push("dependensi eksternal");
  if (taskClass === "modify" || taskClass === "operate" || taskClass === "research" || taskClass === "incident") {
    reasons.push(`task class ${taskClass}`);
  }
  return { needed: reasons.length > 0, reasons };
}

export function needsPlan(taskClass: TaskClass, prompt = ""): boolean {
  return planDecision(taskClass, prompt).needed;
}

export function workspaceBrief(root: string, limit = 80): string {
  const lines: string[] = [];
  try {
    const pkgPath = join(root, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; scripts?: Record<string, string> };
      lines.push(`package.json: ${pkg.name ?? "(tanpa nama)"}`);
      const scripts = Object.keys(pkg.scripts ?? {}).slice(0, 12);
      if (scripts.length > 0) lines.push(`scripts: ${scripts.join(", ")}`);
    }
    const entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules")
      .slice(0, limit)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    if (entries.length > 0) lines.push(`isi: ${entries.join(", ")}`);
  } catch {
    lines.push("(struktur workspace tidak bisa dibaca)");
  }
  return lines.join("\n");
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function asNumberPair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const a = Number(value[0]);
  const b = Number(value[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return undefined;
  return [Math.min(a, b), Math.max(a, b)];
}

function normalizeRisk(value: unknown): RiskLevel {
  return value === "high" || value === "medium" ? value : "low";
}

export function normalizePlan(raw: unknown, goal: string): PlanDraft | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const criteriaRaw = Array.isArray(obj.criteria) ? obj.criteria : [];
  const criteria: PlanCriterion[] = [];
  for (const [index, item] of criteriaRaw.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const type = asString(c.type);
    if (!type || !["test", "build", "runtime", "file", "diff", "manual"].includes(type)) continue;
    criteria.push({
      id: asString(c.id) ?? `c${index + 1}`,
      type: type as CriterionType,
      command: asString(c.command),
      path: asString(c.path),
      expect: asString(c.expect),
      description: asString(c.description)
    });
  }

  const tasksRaw = Array.isArray(obj.tasks) ? obj.tasks : [];
  const tasks: PlanTask[] = [];
  for (const [index, item] of tasksRaw.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const t = item as Record<string, unknown>;
    const title = asString(t.title);
    if (!title) continue;
    const acceptance = asString(t.acceptance) ?? "";
    tasks.push({
      id: asString(t.id) ?? `t${index + 1}`,
      title,
      description: asString(t.description),
      agent: asString(t.agent) ?? "coding",
      dependsOn: asStringArray(t.dependsOn),
      files: asStringArray(t.files),
      ...(() => {
        const detected = detectRisk(`${title} ${asString(t.description) ?? ""}`);
        const risk = RISK_ORDER[detected.level] > RISK_ORDER[normalizeRisk(t.risk)] ? detected.level : normalizeRisk(t.risk);
        const reason = asStringArray(t.files).length > 20 ? "menyentuh lebih dari 20 file" : detected.reason;
        return reason ? { risk, riskReason: reason } : { risk };
      })(),
      acceptance
    });
  }

  const fileOwner = new Map<string, string>();
  for (const task of tasks) {
    for (const file of task.files) {
      const owner = fileOwner.get(file);
      if (owner && owner !== task.id && !task.dependsOn.includes(owner)) task.dependsOn.push(owner);
    }
    for (const file of task.files) {
      if (!fileOwner.has(file)) fileOwner.set(file, task.id);
    }
  }

  const estimateRaw = typeof obj.estimate === "object" && obj.estimate !== null ? (obj.estimate as Record<string, unknown>) : {};
  const minutesPair = asNumberPair(estimateRaw.minutes);
  const costPair = asNumberPair(estimateRaw.costUsd);
  const suppliedSource = asString(estimateRaw.source);
  const estimateSource: PlanEstimate["source"] =
    suppliedSource === "historical" || suppliedSource === "heuristic"
      ? suppliedSource
      : minutesPair || costPair
        ? "heuristic"
        : "unavailable";
  const minutes = minutesPair ?? [0, 0];
  const cost = costPair ?? [0, 0];

  const risksRaw = Array.isArray(obj.risks) ? obj.risks : [];
  const risks: PlanRisk[] = [];
  for (const item of risksRaw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const taskId = asString(r.taskId);
    const reason = asString(r.reason);
    if (taskId && reason) risks.push({ taskId, level: normalizeRisk(r.level), reason });
  }

  return {
    goal: asString(obj.goal) ?? goal,
    assumptions: asStringArray(obj.assumptions),
    criteria,
    tasks,
    estimate: { minutes, costUsd: cost, source: estimateSource },
    risks
  };
}

const HIGH_RISK = /\b(migrasi|migration|schema|drop|truncate|hapus data|hapus file|delete data|delete file|rm -rf|auth|kredensial|credential|secret|deploy|rilis|release|force push|production|produksi)\b/i;
const MEDIUM_RISK = /\b(ubah|refactor|hapus|rename|ganti|install|pasang|dependensi|dependency|konfigurasi|config)\b/i;

export function detectRisk(text: string): { level: RiskLevel; reason?: string } {
  const high = HIGH_RISK.exec(text);
  if (high) return { level: "high", reason: `menyentuh area berisiko: ${high[1]}` };
  const medium = MEDIUM_RISK.exec(text);
  if (medium) return { level: "medium", reason: `mengubah area yang ada: ${medium[1]}` };
  return { level: "low" };
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function validatePlan(plan: PlanDraft): PlanValidation {
  const errors: string[] = [];
  if (plan.tasks.length === 0) errors.push("plan tidak punya task");
  if (plan.criteria.length === 0) errors.push("plan tidak punya kriteria selesai");
  const ids = new Set<string>();
  for (const task of plan.tasks) {
    if (ids.has(task.id)) errors.push(`id task duplikat: ${task.id}`);
    ids.add(task.id);
    if (task.acceptance.trim().length === 0) errors.push(`task ${task.id} tanpa acceptance`);
    if (task.agent.trim().length === 0) errors.push(`task ${task.id} tanpa agen`);
    if ((task.description ?? "").trim().length === 0) errors.push(`task ${task.id} tanpa deskripsi`);
    if (task.files.length === 0) errors.push(`task ${task.id} tanpa file area`);
    if (task.title.trim().length === 0) errors.push(`task ${task.id} tanpa judul`);
    const files = task.files.length;
    if (files > 20) errors.push(`task ${task.id} menyentuh ${files} file, melebihi batas 20`);
  }
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) errors.push(`task ${task.id} bergantung pada task yang tidak ada: ${dep}`);
      if (dep === task.id) errors.push(`task ${task.id} bergantung pada dirinya sendiri`);
    }
  }

  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const visit = (id: string, trail: string[]): void => {
    const current = state.get(id);
    if (current === "done") return;
    if (current === "visiting") {
      errors.push(`siklus dependensi: ${[...trail, id].join(" -> ")}`);
      return;
    }
    state.set(id, "visiting");
    const task = byId.get(id);
    if (task) {
      for (const dep of [...task.dependsOn].sort()) visit(dep, [...trail, id]);
    }
    state.set(id, "done");
    order.push(id);
  };
  for (const id of [...byId.keys()].sort()) visit(id, []);

  const fileOwners = new Map<string, string[]>();
  for (const task of plan.tasks) {
    for (const file of task.files) {
      const owners = fileOwners.get(file) ?? [];
      owners.push(task.id);
      fileOwners.set(file, owners);
    }
  }
  for (const [file, owners] of fileOwners) {
    if (owners.length > 1 && new Set(owners).size > 1) {
      const parallel = owners.every((id) => {
        const a = byId.get(id);
        const b = byId.get(owners[0] ?? "");
        return a !== undefined && b !== undefined && !a.dependsOn.includes(b.id) && !b.dependsOn.includes(a.id);
      });
      if (parallel) errors.push(`file ${file} dipakai beberapa task paralel: ${owners.join(", ")}`);
    }
  }

  const fileCount = new Set(plan.tasks.flatMap((task) => task.files)).size;
  const highRisk = plan.tasks.some((task) => task.risk === "high") || plan.risks.some((risk) => risk.level === "high") || fileCount > 20;
  return { ok: errors.length === 0, errors, order, highRisk, fileCount };
}

export function planPrompt(goal: string, taskClass: TaskClass, brief: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "Kamu planner untuk agent coding. Hasilkan rencana sebagai JSON murni, tanpa prosa dan tanpa fence.",
        "Skema:",
        '{"goal":"...","assumptions":["..."],"criteria":[{"id":"c1","type":"test|build|runtime|file|diff|manual","command":"...","path":"...","expect":"..."}],"tasks":[{"id":"t1","title":"...","description":"...","agent":"coding|testing|research","dependsOn":[],"files":["..."],"risk":"low|medium|high","acceptance":"..."}],"estimate":{"minutes":[5,20],"costUsd":[0,0]},"risks":[{"taskId":"t1","level":"low","reason":"..."}]}',
        "Aturan: setiap task punya minimal satu acceptance yang bisa diuji. dependsOn hanya berisi id task lain. estimate wajib rentang dua angka, bukan angka tunggal. Maksimal 20 file per task. Jangan mengarang isi file."
      ].join("\n")
    },
    {
      role: "user",
      content: [`Tujuan: ${goal}`, `Kelas tugas: ${taskClass}`, "Konteks workspace:", brief || "(kosong)"].join("\n")
    }
  ];
}

export async function generatePlan(
  provider: Provider,
  model: string,
  goal: string,
  taskClass: TaskClass,
  brief: string,
  signal?: AbortSignal
): Promise<{ plan: PlanDraft; validation: PlanValidation }> {
  let text = "";
  for await (const chunk of provider.chat({
    model,
    messages: planPrompt(goal, taskClass, brief),
    maxTokens: 2000,
    temperature: 0.1,
    signal
  })) {
    if (chunk.type === "text") text += chunk.text;
  }
  const parsed = normalizePlan(extractJson(text), goal);
  if (!parsed) throw new RannError("E_PLAN_INVALID", "Planner tidak mengembalikan JSON rencana yang valid");
  let plan = parsed;
  let validation = validatePlan(plan);

  if (!validation.ok) {
    const repairMessages: ChatMessage[] = [
      ...planPrompt(goal, taskClass, brief),
      { role: "assistant", content: text },
      {
        role: "user",
        content: `Rencana ditolak: ${validation.errors.join("; ")}. Perbaiki dan kirim ulang JSON lengkap.`
      }
    ];
    let repaired = "";
    for await (const chunk of provider.chat({ model, messages: repairMessages, maxTokens: 2000, temperature: 0.1, signal })) {
      if (chunk.type === "text") repaired += chunk.text;
    }
    const second = normalizePlan(extractJson(repaired), goal);
    if (second) {
      plan = second;
      validation = validatePlan(plan);
    }
  }

  if (!validation.ok) {
    throw new RannError("E_PLAN_INVALID", `Rencana tidak valid: ${validation.errors.join("; ")}`);
  }
  return { plan, validation };
}

export function estimateFromHistory(db: import("@rann/storage").Db): PlanEstimate | null {
  const row = db
    .prepare("SELECT COUNT(*) AS n, AVG(ended_at - started_at) AS avg_ms FROM tasks WHERE status = 'done' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at > started_at")
    .get() as { n?: number; avg_ms?: number } | undefined;
  if (!row || (row.n ?? 0) < 3 || !row.avg_ms || row.avg_ms <= 0) return null;
  const minutes = Math.max(1, Math.round(row.avg_ms / 60_000));
  return {
    minutes: [Math.max(1, Math.round(minutes * 0.8)), Math.max(1, Math.round(minutes * 1.2))],
    costUsd: [0, 0],
    source: "historical"
  };
}

export function planToMarkdown(plan: PlanDraft, validation: PlanValidation): string {
  const lines = [
    `Rencana: ${plan.goal}`,
    `Task: ${plan.tasks.length}, file: ${validation.fileCount}, risiko tinggi: ${validation.highRisk ? "ya" : "tidak"}`,
    plan.estimate.source === "unavailable"
      ? "Estimasi: tidak tersedia"
      : `Estimasi: ${plan.estimate.minutes[0]}-${plan.estimate.minutes[1]} menit, $${plan.estimate.costUsd[0]}-${plan.estimate.costUsd[1]} (${plan.estimate.source})`
  ];
  for (const id of validation.order) {
    const task = plan.tasks.find((item) => item.id === id);
    if (!task) continue;
    lines.push(`- ${task.id} [${task.risk}] ${task.title}; acceptance: ${task.acceptance}; file: ${task.files.join(", ") || "-"}`);
  }
  if (plan.criteria.length > 0) {
    lines.push("Kriteria:");
    for (const criterion of plan.criteria) {
      lines.push(`- ${criterion.id} ${criterion.type}${criterion.command ? ` ${criterion.command}` : ""}${criterion.expect ? ` => ${criterion.expect}` : ""}`);
    }
  }
  return lines.join("\n");
}
