import { createServer, type Server, type Socket } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { persistPlan } from "./plan-runtime.js";
import { loadCustomTools, runCustomTool } from "./custom-tools.js";
import { toolSpecs } from "./tools/index.js";
import { validatePlan, type PlanDraft } from "./planner.js";
import { RannError, PROTOCOL_VERSION, explainKey, toRannError, methodParamsSchema, newId, redactSecrets, toRpcError, type EventEnvelope, type RpcRequest } from "@rann/shared";
import {
  appendAudit,
  appendEvent,
  appendJobEvent,
  cancelJob,
  createScheduler,
  createSession,
  createTurn,
  dueSchedulers,
  enqueueJob,
  eventsForTurn,
  finishSchedulerRun,
  finishTurn,
  finishTurnRuntime,
  finishGoal,
  getJob,
  getScheduler,
  heartbeatTurnRuntime,
  listJobEvents,
  listJobs,
  listSchedulerRuns,
  listSchedulers,
  removeScheduler,
  retryJob,
  startSchedulerRun,
  startTurnRuntime,
  markStalledTurns,
  getActiveGoal,
  getSession,
  getTurn,
  getTurnRuntime,
  listGoals,
  listMessages,
  renameSession,
  forkSession,
  listProjects,
  listPlans,
  getPlan,
  listSessions,
  listTasks,
  updateTaskPriority,
  openDatabase,
  recordRoutingLog,
  recoverInterruptedTurns,
  schemaVersion,
  setTurnModel,
  setGoal,
  summarizeUsage,
  sumCostSince,
  sumTokensSince,
  touchSession,
  updateGoalProgress,
  updateScheduler,
  SecretStore,
  subagentForest,
  cancelSubagentTree,
  countSubagentChildren,
  countSubagentsForTurn,
  createSubagent,
  finishSubagent,
  getSubagent,
  getSubagentByTurn,
  heartbeatSubagent,
  listSubagents,
  listSubagentMessages,
  markOrphanedSubagents,
  recordSubagentMessage,
  releaseAgentLeases,
  updateSubagent,
  type Db,
  type JobRow,
  type SessionRow,
  latestCheckpoint,
  createBackup,
  gcStorage,
  listBackups
} from "@rann/storage";
import { providerFor, type LoadedConfig } from "@rann/shared";
import type { Layout } from "./paths.js";
import { routeModel, type HealthState } from "./router.js";
import { runTurn, type AgentConfig, type ApprovalDecision, type DelegateInput, type RunTurnOptions } from "./agent.js";
import { analyzeFailure } from "./failure-analysis.js";
import { prepareAttachments, type RawAttachment } from "./attachments.js";
import { listFileCheckpoints, restoreFileCheckpoint } from "./checkpoint-files.js";
import { createProvider, resolveModel } from "./providers/index.js";
import { costFor, registrySnapshot, resolveDescriptor, seedRegistry } from "./models.js";
import { providerHealth } from "./providers/retry.js";
import { MemoryService } from "./memory.js";
import { HookRunner, type HookEvent } from "./hooks.js";
import { BrowserManager } from "./browser.js";
import { PluginManager } from "./plugins.js";
import { SkillStore } from "./skills.js";
import { McpManager } from "./mcp.js";
import { BackgroundQueue, type JobContext } from "./background.js";
import { SchedulerEngine, nextRunFor } from "./scheduler.js";
import { GatewayServer } from "./gateway.js";
import { MessagingService } from "./messaging.js";
import { loadProfiles, pickProfile, type SubagentProfile } from "./subagent-profiles.js";
import { dashboardData } from "./dashboard-data.js";

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export interface RpcServerOptions {
  layout: Layout;
  config: LoadedConfig;
  version: string;
  shutdown: () => void;
}

interface PendingApproval {
  settle: (approved: boolean, remember?: boolean) => void;
  timer: NodeJS.Timeout;
  onAbort: () => void;
  signal?: AbortSignal;
  sessionId: string;
  turnId: string;
  tool: string;
  args: unknown;
}

const MAX_LINE = 8 * 1024 * 1024;
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const SENSITIVE_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || SENSITIVE_ENV.test(name)) continue;
    env[name] = value;
  }
  return env;
}

export class RpcServer {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly activeTurns = new Map<string, AbortController>();
  private readonly agentControllers = new Map<string, AbortController>();
  private readonly backgroundAgents = new Set<Promise<unknown>>();
  private readonly subagentSlots = new Map<string, { running: number; waiters: Array<() => void> }>();
  private readonly browser: BrowserManager;
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly sessionApprovals = new Map<string, Set<string>>();
  private readonly sessionApprovalPatterns = new Map<string, Set<string>>();
  private readonly db: Db;
  private readonly secrets: SecretStore;
  private readonly mcp: McpManager;
  private readonly background: BackgroundQueue;
  private readonly scheduler: SchedulerEngine;
  private readonly gateway: GatewayServer;
  private readonly messaging: MessagingService;
  private readonly eventListeners = new Set<(event: EventEnvelope) => void>();
  private readonly startedAt = Date.now();
  private watchdog?: NodeJS.Timeout;
  private healthTimer?: NodeJS.Timeout;
  private dailyBackupTimer?: NodeJS.Timeout;
  recoveredTurns: ReturnType<typeof recoverInterruptedTurns> = [];
  private closing = false;

  constructor(private readonly options: RpcServerOptions) {
    const opened = openDatabase({
      path: options.layout.dbPath,
      backupBeforeMigrate: options.config.config.storage.backup_before_migrate,
      backupDir: options.layout.backupsDir
    });
    this.db = opened.db;
    this.recoveredTurns = recoverInterruptedTurns(this.db);
    this.secrets = new SecretStore({
      dir: options.layout.secretsDir,
      ...(process.env.RANN_SECRET_PASSPHRASE ? { passphrase: process.env.RANN_SECRET_PASSPHRASE } : {})
    });
    this.mcp = new McpManager(options.config.config.mcp.servers, options.version);
    this.browser = new BrowserManager(process.cwd(), {
      ...options.config.config.browser,
      artifacts_dir: join(options.layout.artifactsDir, "browser")
    }, options.layout.profileDir);
    this.background = new BackgroundQueue({
      db: this.db,
      concurrency: options.config.config.background.concurrency,
      pollMs: options.config.config.background.poll_ms,
      leaseMs: options.config.config.background.lease_ms,
      maxRuntimeMs: options.config.config.background.max_runtime_ms,
      runner: (context) => this.runBackgroundJob(context),
      onEvent: (type, job, data) => {
        if (job) this.broadcastJob(type, job, data);
      }
    });
    this.scheduler = new SchedulerEngine({
      db: this.db,
      pollMs: options.config.config.scheduler.poll_ms,
      onError: (error, row) => {
        appendJobEvent(this.db, row?.id ?? "scheduler", "scheduler_error", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });
    this.server = createServer((socket) => this.attach(socket));
    this.gateway = new GatewayServer({
      db: this.db,
      config: options.config.config,
      version: options.version,
      profile: options.layout.profile,
      artifactsDir: options.layout.artifactsDir,
      invoke: (method, params) =>
        this.handleRequest({ jsonrpc: "2.0", id: `gw-${Date.now()}`, method, params }),
      subscribe: (listener) => {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
      }
    });
    this.startHealthProbes();
    this.startDailyBackup();
    this.messaging = new MessagingService({
      db: this.db,
      config: options.config.config,
      invoke: (method, params) =>
        this.handleRequest({ jsonrpc: "2.0", id: `msg-${Date.now()}`, method, params }),
      subscribe: (listener) => {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
      }
    });
  }

  get database(): Db {
    return this.db;
  }

  private startDailyBackup(): void {
    if (!this.options.config.config.storage.daily_backup) return;
    const run = (): void => {
      const latest = listBackups(this.options.layout.backupsDir)[0];
      if (latest && Date.now() - Date.parse(latest.created_at) < 20 * 60 * 60 * 1_000) return;
      try {
        const info = createBackup(this.options.layout.dbPath, this.options.layout.backupsDir, this.options.config.config.storage.retention_days);
        const gc = gcStorage(this.db, this.options.config.config.storage.retention_days, this.options.layout.artifactsDir);
        appendAudit(this.db, { actor: "system", action: "backup.daily", resource: info.path, decision: "allow", metadata: { size: info.size, gc } });
      } catch (error) {
        process.stderr.write(`backup harian gagal: ${(error as Error).message}\n`);
      }
    };
    run();
    this.dailyBackupTimer = setInterval(run, 60 * 60 * 1_000);
    this.dailyBackupTimer.unref();
  }

  private startHealthProbes(): void {
    const tick = async (): Promise<void> => {
      const config = this.options.config.config;
      const names = Object.keys(config.providers).filter((name) => name !== "mock");
      await Promise.allSettled(names.map(async (name) => {
        const providerConfig = config.providers[name];
        if (!providerConfig) return;
        const hasKey = Boolean(
          providerConfig.api_key_ref ||
          (providerConfig.api_key_env && process.env[providerConfig.api_key_env]) ||
          (providerConfig.api_key_file && existsSync(providerConfig.api_key_file))
        );
        if (!hasKey) {
          providerHealth.recordProbe(name, false, 0, new RannError("E_PROVIDER_AUTH", "Kredensial belum tersedia"));
          return;
        }
        const started = Date.now();
        try {
          const provider = createProvider(name, providerConfig, process.env, this.secrets);
          for await (const _chunk of provider.chat({
            model: resolveModel(providerConfig),
            messages: [{ role: "user", content: "OK" }],
            maxTokens: 4,
            signal: AbortSignal.timeout(15_000)
          })) {
            // cukup satu probe; stream ditutup setelah chunk pertama oleh provider
            break;
          }
          providerHealth.recordProbe(name, true, Date.now() - started);
        } catch (error) {
          const err = error instanceof RannError ? error : new RannError("E_PROVIDER_UNAVAILABLE", (error as Error).message);
          providerHealth.recordProbe(name, false, Date.now() - started, err);
        }
      }));
    };
    this.healthTimer = setInterval(() => { void tick(); }, 60_000);
    this.healthTimer.unref();
    void tick();
  }

  async listen(): Promise<void> {
    const path = this.options.layout.socketPath;
    if (process.platform !== "win32" && existsSync(path)) {
      try {
        unlinkSync(path);
      } catch {
        // biarkan listen yang melaporkan error
      }
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.server.once("error", onError);
      this.server.listen(path, () => {
        this.server.off("error", onError);
        resolve();
      });
    });
    if (process.platform !== "win32") {
      const { chmodSync } = await import("node:fs");
      try {
        chmodSync(path, 0o600);
      } catch {
        // abaikan
      }
    }
    this.watchdog = setInterval(() => this.sweepStalledTurns(), 15_000);
    this.watchdog.unref();
    this.background.start();
    this.scheduler.start();
    if (this.options.config.config.gateway.enabled) {
      await this.gateway.start();
    }
    await this.messaging.start();
  }

  private sweepStalledTurns(): void {
    try {
      const stalled = markStalledTurns(this.db);
      for (const item of stalled) {
        const turn = getTurn(this.db, item.turn_id);
        if (!turn) continue;
        const event = appendEvent(this.db, {
          type: "heartbeat",
          sessionId: turn.session_id,
          turnId: item.turn_id,
          data: {
            state: "stalled",
            reason: item.reason,
            silence_ms: item.silence_ms
          }
        });
        this.broadcast(event);
      }
    } catch {
      // watchdog tidak boleh mematikan daemon
    }
  }

  broadcast(event: EventEnvelope): void {
    const line = JSON.stringify({ jsonrpc: "2.0", method: "event", params: event }) + "\n";
    for (const socket of this.sockets) {
      if (!socket.destroyed) socket.write(line);
    }
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // listener gateway tidak boleh memutus broadcast RPC
      }
    }
  }

  private attach(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE) {
        socket.destroy();
        return;
      }
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.length > 0) void this.handleLine(socket, line);
        index = buffer.indexOf("\n");
      }
    });
    socket.on("close", () => this.sockets.delete(socket));
    socket.on("error", () => this.sockets.delete(socket));
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let parsed: RpcRequest;
    try {
      parsed = JSON.parse(line) as RpcRequest;
    } catch {
      socket.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: "E_INVALID_PARAMS", message: "JSON tidak valid" } }) + "\n");
      return;
    }
    const id = parsed.id ?? null;
    try {
      const result = await this.handleRequest(parsed);
      const response = JSON.stringify({ jsonrpc: "2.0", id, result });
      if (!socket.destroyed) socket.write(response + "\n");
    } catch (error) {
      const rpcError = toRpcError(error, newId("req"));
      if (!socket.destroyed) socket.write(JSON.stringify({ jsonrpc: "2.0", id, error: rpcError }) + "\n");
    }
  }

  private async handleRequest(request: RpcRequest): Promise<unknown> {
    if (request.jsonrpc !== "2.0") throw new RannError("E_INVALID_PARAMS", "jsonrpc harus 2.0");
    const schema = methodParamsSchema(request.method);
    if (!schema) throw new RannError("E_METHOD_NOT_FOUND", `Method tidak dikenal: ${request.method}`, { data: { method: request.method } });
    const params = schema.safeParse(request.params ?? {});
    if (!params.success) {
      throw new RannError("E_INVALID_PARAMS", `Params ${request.method} tidak valid`, {
        data: { issues: params.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }
      });
    }
    const input = params.data as Record<string, unknown>;
    switch (request.method) {
      case "health":
        return this.health();
      case "shutdown":
        setTimeout(() => this.options.shutdown(), 25);
        return { ok: true };
      case "session.create":
        return this.sessionCreate(input);
      case "project.list":
        return listProjects(this.db);
      case "session.list":
        return listSessions(this.db, {
          status: input.status as string | undefined,
          projectPath: input.projectPath as string | undefined,
          limit: input.limit as number
        });
      case "session.get": {
        const session = getSession(this.db, input.sessionId as string);
        if (!session) throw new RannError("E_SESSION_NOT_FOUND", `Sesi tidak ditemukan: ${input.sessionId}`);
        const project = session.project_id
          ? (this.db.prepare("SELECT path FROM projects WHERE id = ?").get(session.project_id) as { path: string } | undefined)
          : undefined;
        return { ...session, project_path: project?.path ?? null, messages: listMessages(this.db, session.id, 200) };
      }
      case "session.rename":
        return renameSession(this.db, input.sessionId as string, input.title as string);
      case "session.fork":
        return forkSession(this.db, input.sessionId as string, input.title as string | undefined, input.uptoMessageId as string | undefined);
      case "session.send":
        return this.sessionSend(input);
      case "turn.get":
        return this.turnGet(input);
      case "turn.runtime":
        return getTurnRuntime(this.db, input.turnId as string) ?? null;
      case "session.cancel": {
        const sessionId = input.sessionId as string;
        const controller = this.activeTurns.get(sessionId);
        if (!controller) return { cancelled: false, reason: "tidak ada turn berjalan" };
        controller.abort();
        return { cancelled: true };
      }
      case "turn.events":
        return eventsForTurn(this.db, input.turnId as string, (input.afterSeq as number) ?? 0);
      case "model.list":
        return this.modelList();
      case "provider.list":
        return this.providerList();
      case "provider.test":
        return await this.providerTest(input);
      case "route.explain": {
        const config = this.options.config.config;
        const descriptors = registrySnapshot(this.db, config);
        const snapshot = providerHealth.snapshot();
        const health: Record<string, HealthState> = {};
        for (const [name, entry] of Object.entries(snapshot)) health[name] = entry.status;
        return routeModel({
          prompt: input.prompt as string,
          descriptors,
          health,
          policy: (input.policy as string | undefined) ?? config.routing.policy,
          ...(config.routing.pinned ? { pinned: config.routing.pinned } : {}),
          prefer: config.routing.prefer,
          ...(config.routing.min_quality !== undefined ? { minQuality: config.routing.min_quality } : {}),
          ...(config.routing.max_cost_per_task !== undefined ? { maxCostPerTask: config.routing.max_cost_per_task } : {}),
          strictBudget: config.routing.strict_budget
        });
      }
      case "task.list":
        return listTasks(this.db, input.sessionId as string);
      case "task.priority": {
        const task = updateTaskPriority(this.db, input.taskId as string, input.priority as number);
        if (!task) throw new RannError("E_NOT_FOUND", "Task tidak ditemukan");
        appendAudit(this.db, {
          actor: "user",
          action: "task.priority",
          resource: task.id,
          decision: "ok",
          metadata: { session_id: task.session_id, priority: task.priority }
        });
        return task;
      }
      case "goal.get": {
        const session = getSession(this.db, input.sessionId as string);
        if (!session) throw new RannError("E_SESSION_NOT_FOUND", "Sesi tidak ditemukan");
        return getActiveGoal(this.db, session.id) ?? null;
      }
      case "goal.list": {
        const session = getSession(this.db, input.sessionId as string);
        if (!session) throw new RannError("E_SESSION_NOT_FOUND", "Sesi tidak ditemukan");
        return listGoals(this.db, session.id, (input.limit as number | undefined) ?? 20);
      }
      case "goal.set": {
        const session = getSession(this.db, input.sessionId as string);
        if (!session) throw new RannError("E_SESSION_NOT_FOUND", "Sesi tidak ditemukan");
        const goal = setGoal(this.db, {
          sessionId: session.id,
          goal: input.goal as string,
          criteria: input.criteria as Array<string | { id?: string; text: string }> | undefined,
          assumptions: input.assumptions as string[] | undefined,
          createdBy: input.createdBy as "user" | "replan"
        });
        appendAudit(this.db, {
          action: "goal.set",
          actor: input.createdBy as string,
          decision: "ok",
          resource: goal.id,
          metadata: { session_id: session.id, version: goal.version, criteria: goal.criteria.length }
        });
        return goal;
      }
      case "goal.update": {
        const goal = updateGoalProgress(this.db, input.sessionId as string, {
          ...(input.action !== undefined ? { action: input.action as string } : {}),
          ...(input.tool !== undefined ? { tool: input.tool as string } : {}),
          ...(input.note !== undefined ? { note: input.note as string } : {}),
          ...(input.complete !== undefined ? { complete: input.complete as Array<{ id: string; evidence: string }> } : {})
        });
        if (!goal) throw new RannError("E_NOT_FOUND", "Goal aktif tidak ditemukan");
        return goal;
      }
      case "goal.finish": {
        const goal = finishGoal(
          this.db,
          input.sessionId as string,
          input.status as "done" | "failed" | "cancelled",
          input.note as string | undefined
        );
        if (!goal) throw new RannError("E_NOT_FOUND", "Goal aktif tidak ditemukan");
        appendAudit(this.db, {
          action: "goal.finish",
          actor: "user",
          decision: "ok",
          resource: goal.id,
          metadata: { session_id: goal.session_id, status: goal.status }
        });
        return goal;
      }
      case "background.enqueue": {
        const kind = input.kind as "prompt" | "shell";
        let sessionId = input.sessionId as string | undefined;
        if (kind === "prompt") {
          if (sessionId) {
            const session = getSession(this.db, sessionId);
            if (!session) throw new RannError("E_SESSION_NOT_FOUND", `Sesi tidak ditemukan: ${sessionId}`);
          } else {
            const created = createSession(this.db, {
              projectPath: this.options.config.projectPath,
              title: `Background: ${(input.text as string).slice(0, 60)}`,
              model: this.options.config.config.model.default,
              permissionMode: this.options.config.config.permissions.mode
            });
            sessionId = created.id;
          }
        }
        const job = enqueueJob(this.db, {
          kind,
          queue: input.queue as string,
          priority: input.priority as number,
          maxAttempts: input.maxAttempts as number,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey as string } : {}),
          ...(input.nextRunAt !== undefined ? { nextRunAt: input.nextRunAt as number } : {}),
          payload: { text: input.text as string, ...(sessionId ? { sessionId } : {}) }
        });
        appendAudit(this.db, {
          actor: "user",
          action: "background.enqueue",
          resource: job.id,
          decision: "ok",
          metadata: { kind, queue: job.queue, priority: job.priority, session_id: sessionId ?? null }
        });
        this.broadcastJob("queued", job);
        return job;
      }
      case "background.list":
        return listJobs(this.db, {
          ...(input.status ? { status: input.status as never } : {}),
          ...(input.queue ? { queue: input.queue as string } : {}),
          limit: input.limit as number
        });
      case "background.get": {
        const job = getJob(this.db, input.id as string);
        if (!job) throw new RannError("E_NOT_FOUND", `Job tidak ditemukan: ${input.id}`);
        return job;
      }
      case "background.cancel": {
        const aborted = this.background.cancel(input.id as string);
        const cancelled = cancelJob(this.db, input.id as string);
        if (!cancelled && !aborted) throw new RannError("E_CONFLICT", `Job ${input.id} tidak bisa dibatalkan pada status ini`);
        appendAudit(this.db, { actor: "user", action: "background.cancel", resource: input.id as string, decision: "ok", metadata: {} });
        const job = getJob(this.db, input.id as string);
        if (job) this.broadcastJob("cancelled", job);
        return { cancelled };
      }
      case "background.retry": {
        const retried = retryJob(this.db, input.id as string);
        if (!retried) throw new RannError("E_CONFLICT", `Job ${input.id} tidak bisa diulang pada status ini`);
        appendAudit(this.db, { actor: "user", action: "background.retry", resource: input.id as string, decision: "ok", metadata: {} });
        const job = getJob(this.db, input.id as string);
        if (job) this.broadcastJob("queued", job);
        return { retried };
      }
      case "background.logs":
        return listJobEvents(this.db, input.id as string, input.limit as number);
      case "scheduler.add": {
        const schedule = input.schedule as string;
        const timezone = (input.timezone as string | undefined) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
        const nextRunAt = nextRunFor(schedule, timezone);
        const row = createScheduler(this.db, {
          name: input.name as string,
          schedule,
          command: input.command as string,
          timezone,
          ...(input.payload ? { payload: input.payload as Record<string, unknown> } : {}),
          overlapPolicy: input.overlapPolicy as "skip" | "queue" | "replace",
          catchUp: input.catchUp as boolean,
          maxAttempts: input.maxAttempts as number,
          nextRunAt
        });
        appendAudit(this.db, {
          actor: "user",
          action: "scheduler.add",
          resource: row.id,
          decision: "ok",
          metadata: { name: row.name, schedule, timezone, next_run_at: nextRunAt }
        });
        return row;
      }
      case "scheduler.list":
        return listSchedulers(this.db).map((row) => ({ ...row, running: listSchedulerRuns(this.db, row.id, 1)[0] ?? null }));
      case "scheduler.run": {
        const row = getScheduler(this.db, input.id as string);
        if (!row) throw new RannError("E_NOT_FOUND", `Jadwal tidak ditemukan: ${input.id}`);
        const run = startSchedulerRun(this.db, row, Date.now());
        const job = enqueueJob(this.db, {
          kind: "scheduler.run",
          queue: "scheduler",
          priority: 120,
          maxAttempts: row.max_attempts,
          payload: {
            schedulerId: row.id,
            schedulerName: row.name,
            runId: run.id,
            command: row.command,
            data: JSON.parse(row.payload_json) as unknown,
            timezone: row.timezone
          }
        });
        appendAudit(this.db, { actor: "user", action: "scheduler.run", resource: row.id, decision: "ok", metadata: { job_id: job.id, run_id: run.id } });
        return { run, job };
      }
      case "scheduler.update": {
        const row = getScheduler(this.db, input.id as string);
        if (!row) throw new RannError("E_NOT_FOUND", `Jadwal tidak ditemukan: ${input.id}`);
        const schedule = (input.schedule as string | undefined) ?? row.schedule;
        const timezone = (input.timezone as string | undefined) ?? row.timezone;
        const recompute = input.schedule !== undefined || input.timezone !== undefined || (input.enabled === true && row.next_run_at === null);
        const nextRunAt = recompute ? nextRunFor(schedule, timezone) : row.next_run_at;
        const updated = updateScheduler(this.db, row.id, {
          ...(input.schedule !== undefined ? { schedule } : {}),
          ...(input.command !== undefined ? { command: input.command as string } : {}),
          ...(input.timezone !== undefined ? { timezone } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled ? 1 : 0 } : {}),
          ...(input.overlapPolicy !== undefined ? { overlap_policy: input.overlapPolicy as "skip" | "queue" | "replace" } : {}),
          ...(input.catchUp !== undefined ? { catch_up: input.catchUp ? 1 : 0 } : {}),
          ...(input.maxAttempts !== undefined ? { max_attempts: input.maxAttempts as number } : {}),
          next_run_at: nextRunAt
        });
        appendAudit(this.db, { actor: "user", action: "scheduler.update", resource: row.id, decision: "ok", metadata: { enabled: input.enabled ?? null } });
        return updated;
      }
      case "scheduler.remove": {
        const removed = removeScheduler(this.db, input.id as string);
        if (!removed) throw new RannError("E_NOT_FOUND", `Jadwal tidak ditemukan: ${input.id}`);
        appendAudit(this.db, { actor: "user", action: "scheduler.remove", resource: input.id as string, decision: "ok", metadata: {} });
        return { removed };
      }
      case "scheduler.history": {
        const row = getScheduler(this.db, input.id as string);
        if (!row) throw new RannError("E_NOT_FOUND", `Jadwal tidak ditemukan: ${input.id}`);
        return listSchedulerRuns(this.db, row.id, input.limit as number);
      }
      case "dashboard.data": {
        const result = dashboardData(this.db, this.options.config, this.options.layout, input.page as string, {
          ...(input.sessionId ? { sessionId: input.sessionId as string } : {}),
          limit: input.limit as number
        });
        return input.page === "gateway" ? { ...result, status: this.gateway.status() } : result;
      }
      case "mcp.list":
        return Object.entries(this.options.config.config.mcp.servers).map(([name, server]) => ({
          name,
          transport: server.transport ?? (server.url ? "http" : "stdio"),
          target: server.url ?? [server.command, ...(server.args ?? [])].join(" "),
          enabled: server.enabled,
          timeout_ms: server.timeout_ms
        }));
      case "mcp.test": {
        const tools = await this.mcp.listTools();
        const name = typeof input.name === "string" ? input.name : undefined;
        return tools
          .filter((tool) => !name || tool.name.startsWith(`mcp__${name}__`))
          .map((tool) => ({ name: tool.name, description: tool.description }));
      }
      case "mcp.reload":
        await this.mcp.close();
        return { reloaded: true };
      case "gateway.status":
        return this.gateway.status();
      case "gateway.start":
        await this.gateway.start();
        return this.gateway.status();
      case "gateway.stop":
        await this.gateway.stop();
        return this.gateway.status();
      case "gateway.pair": {
        const result = this.gateway.pairCode();
        return { ...result, expires_in_ms: result.expiresAt - Date.now() };
      }
      case "gateway.devices":
        return this.gateway.devices();
      case "gateway.revoke":
        return { revoked: this.gateway.revoke(input.id as string) };
      case "gateway.role":
        return (
          this.gateway.setRole(input.id as string, input.role as "owner" | "operator" | "viewer" | "approver") ?? null
        );
      case "gateway.stats":
        return this.gateway.stats();
      case "messaging.status":
        return this.messaging.status();
      case "messaging.send":
        return await this.messaging.send(
          input.chat_id as number,
          input.text as string,
          input.thread_id as number | undefined
        );
      case "agent.list": {
        markOrphanedSubagents(this.db);
        if (input.tree === true) return subagentForest(this.db, (input.limit as number | undefined) ?? 200);
        return listSubagents(this.db, {
          ...(input.status ? { status: input.status as never } : {}),
          ...(input.parent_id ? { parentId: input.parent_id as string } : {}),
          limit: (input.limit as number | undefined) ?? 100
        }).map((row) => {
          const { result_json, ...rest } = row;
          return { ...rest, ...(result_json ? { result: safeJson(result_json) } : {}) };
        });
      }
      case "agent.get": {
        const agent = getSubagent(this.db, input.id as string);
        if (!agent) throw new RannError("E_NOT_FOUND", `Agent tidak ditemukan: ${String(input.id)}`);
        const { result_json, ...rest } = agent;
        return {
          ...rest,
          ...(result_json ? { result: safeJson(result_json) } : {}),
          messages: listSubagentMessages(this.db, agent.id)
        };
      }
      case "agent.cancel": {
        const agent = getSubagent(this.db, input.id as string);
        if (!agent) throw new RannError("E_NOT_FOUND", `Agent tidak ditemukan: ${String(input.id)}`);
        const ids = cancelSubagentTree(this.db, agent.id);
        for (const id of ids) this.agentControllers.get(id)?.abort();
        return { cancelled: ids };
      }
      case "agent.message": {
        const result = this.recordAgentMessage({
          from: input.from as string,
          to: input.to as string,
          type: ((input.type as string | undefined) ?? "note") as "note" | "question" | "answer" | "conflict",
          subject: input.subject as string,
          body: input.body as string,
          priority: (input.priority as "low" | "normal" | "high" | undefined) ?? "normal",
          ...(input.refs ? { refs: input.refs as string[] } : {})
        });
        return result;
      }
      case "agent.profiles":
        return loadProfiles(this.options.layout.home, this.options.config.projectPath ?? process.cwd()).map((profile) => ({
          name: profile.name,
          description: profile.description,
          when: profile.when,
          permission: profile.permission,
          max_steps: profile.maxSteps,
          tools: profile.tools,
          source: profile.source,
          ...(profile.model ? { model: profile.model } : {})
        }));
      case "checkpoint.list": {
        const dir = this.options.layout.checkpointsDir;
        if (!dir) return [];
        return listFileCheckpoints(dir, (input.limit as number | undefined) ?? 20, this.options.config.projectPath).map((item) => ({
          id: item.id,
          label: item.label,
          created_at: item.created_at,
          files: item.files.length,
          bytes: item.bytes
        }));
      }
      case "checkpoint.latest": {
        const checkpoint = latestCheckpoint(this.db, input.sessionId as string);
        if (!checkpoint) return null;
        return {
          id: checkpoint.id,
          turn_id: checkpoint.turn_id,
          label: checkpoint.label,
          kind: checkpoint.kind,
          created_at: checkpoint.created_at,
          state: safeJson(checkpoint.state_json)
        };
      }
      case "checkpoint.restore": {
        const dir = this.options.layout.checkpointsDir;
        if (!dir) throw new RannError("E_TOOL_FAILED", "Direktori checkpoint tidak tersedia");
        const result = restoreFileCheckpoint(this.options.config.projectPath, dir, input.id as string, {
          force: input.force === true
        });
        appendAudit(this.db, {
          actor: "user",
          action: "checkpoint.restore",
          resource: input.id as string,
          decision: "ok",
          metadata: { restored: result.restored.length, workspace: this.options.config.projectPath }
        });
        return result;
      }
      case "plan.list": {
        const plans = listPlans(this.db, input.sessionId as string, (input.limit as number | undefined) ?? 20);
        return plans.map((plan) => ({
          ...plan,
          tasks: listTasks(this.db, plan.session_id).filter((task) => task.plan_id === plan.id)
        }));
      }
      case "tool.list": {
        const loaded = await loadCustomTools(this.options.config.projectPath);
        const builtins = toolSpecs().map((spec) => ({ ...spec, enabled: true, source: "builtin" }));
        const custom = loaded.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.schema, enabled: true, source: "project", permission: tool.permission, timeout_ms: tool.timeoutMs, file: tool.source }));
        return [...builtins, ...custom];
      }
      case "tool.test": {
        const loaded = await loadCustomTools(this.options.config.projectPath);
        const tool = loaded.tools.find((item) => item.name === input.name);
        if (!tool) {
          const invalid = loaded.errors.find((item) => item.file.includes(String(input.name)));
          throw new RannError("E_TOOL_NOT_FOUND", invalid ? `Tool kustom tidak valid: ${invalid.message}` : `Tool kustom tidak ditemukan: ${String(input.name)}`);
        }
        const started = Date.now();
        const result = await runCustomTool(tool, input.args ?? {}, { workspaceRoot: this.options.config.projectPath });
        appendAudit(this.db, { actor: "user", action: "tool.test", resource: `tool:${tool.name}`, decision: result.ok ? "ok" : "deny", metadata: { duration_ms: Date.now() - started, exit_code: result.exitCode ?? null } });
        return { ...result, duration_ms: Date.now() - started };
      }
      case "plan.show": {
        const row = getPlan(this.db, input.planId as string);
        if (!row) throw new RannError("E_NOT_FOUND", "Plan tidak ditemukan");
        const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
        const snapshots = Array.isArray(metadata.snapshots)
          ? (metadata.snapshots as Array<Record<string, unknown>>).map((snapshot) => ({
              version: snapshot.version,
              at: snapshot.at,
              reason: snapshot.reason
            }))
          : [{ version: row.version, at: row.created_at, reason: "rencana awal" }];
        return {
          id: row.id,
          session_id: row.session_id,
          goal: row.goal,
          status: row.status,
          version: row.version,
          active_version: row.version,
          snapshots,
          tasks: listTasks(this.db, row.session_id).filter((task) => task.plan_id === row.id)
        };
      }
      case "plan.export": {
        const row = getPlan(this.db, input.planId as string);
        if (!row) throw new RannError("E_NOT_FOUND", "Plan tidak ditemukan");
        const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
        const snapshots = Array.isArray(metadata.snapshots) ? (metadata.snapshots as Array<Record<string, unknown>>) : [];
        const latest = snapshots[snapshots.length - 1];
        const draft = (latest?.draft as Record<string, unknown> | undefined) ?? {
          goal: row.goal,
          assumptions: metadata.assumptions ?? [],
          criteria: metadata.criteria ?? [],
          tasks: listTasks(this.db, row.session_id)
            .filter((task) => task.plan_id === row.id)
            .map((task) => {
              const data = JSON.parse(task.metadata_json) as Record<string, unknown>;
              return {
                id: data.planTaskId,
                title: data.title,
                description: data.description ?? "",
                agent: data.agent ?? "coder",
                files: data.files ?? [],
                risk: data.risk ?? "low",
                acceptance: data.acceptance ?? "",
                dependsOn: data.dependsOn ?? []
              };
            }),
          estimate: metadata.estimate ?? { minutes: 10, source: "heuristic" },
          risks: metadata.risks ?? []
        };
        return { format: "rann-plan", format_version: 1, exported_at: new Date().toISOString(), plan_id: row.id, version: row.version, draft };
      }
      case "plan.import": {
        const draft = input.draft as PlanDraft;
        const validation = validatePlan(draft);
        if (!validation.ok) throw new RannError("E_INVALID_PARAMS", `rencana tidak valid: ${validation.errors.join("; ")}`);
        const session = getSession(this.db, input.sessionId as string);
        if (!session) throw new RannError("E_SESSION_NOT_FOUND", "Sesi tidak ditemukan");
        const turn = createTurn(this.db, { sessionId: session.id });
        const plan = persistPlan(this.db, session.id, turn.id, draft, validation, typeof input.text === "string" ? input.text : draft.goal, () => {});
        appendAudit(this.db, { actor: "user", action: "plan.import", resource: plan.id, decision: "ok", metadata: { session_id: session.id, tasks: draft.tasks.length } });
        return { plan_id: plan.id, version: plan.version, tasks: draft.tasks.length };
      }
      case "budget.status": {
        const config = this.options.config.config;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const since = start.getTime();
        const spent = sumCostSince(this.db, since);
        return {
          max_usd_per_day: config.budget.max_usd_per_day,
          max_tokens_per_day: config.budget.max_tokens_per_day,
          spent_usd_today: spent.knownUsd,
          unknown_cost_events_today: spent.unknownCount,
          tokens_today: sumTokensSince(this.db, since)
        };
      }
      case "secret.list":
        return this.secrets.list();
      case "secret.set": {
        const meta = this.secrets.set(input.name as string, input.value as string, input.provider as string | undefined);
        appendAudit(this.db, {
          actor: "user",
          action: "secret.set",
          resource: `secret:${meta.name}`,
          decision: "allow",
          metadata: { provider: meta.provider ?? null }
        });
        return meta;
      }
      case "secret.export": {
        const target = this.secrets.exportEncrypted(input.path as string);
        appendAudit(this.db, { actor: "user", action: "secret.export", resource: target, decision: "allow", metadata: {} });
        return { path: target };
      }
      case "secret.rotate": {
        this.secrets.rotateMasterKey();
        appendAudit(this.db, { actor: "user", action: "secret.rotate", resource: "vault", decision: "allow", metadata: {} });
        return { rotated: true };
      }
      case "secret.remove": {
        const removed = this.secrets.remove(input.name as string);
        appendAudit(this.db, {
          actor: "user",
          action: "secret.remove",
          resource: `secret:${input.name as string}`,
          decision: removed ? "allow" : "not_found",
          metadata: {}
        });
        return { removed };
      }
      case "usage.summary":
        return summarizeUsage(this.db, input.sessionId as string | undefined);
      case "config.explain": {
        return explainKey(this.options.config, input.key as string);
      }
      case "config.get":
        return {
          config: this.options.config.config,
          files: this.options.config.files,
          home: this.options.config.home,
          project_path: this.options.config.projectPath
        };
      case "plugin.list":
        return this.pluginManager(input.projectPath as string | undefined).list();
      case "plugin.install":
        return this.pluginManager(input.projectPath as string | undefined).install(input.source as string, {
          scope: input.scope as "global" | "project" | undefined,
          name: input.name as string | undefined,
          approve: input.approve === true,
          checksum: input.checksum as string | undefined,
          allowUnsigned: input.allowUnsigned === true,
          overwrite: input.overwrite === true
        });
      case "plugin.enable":
        return this.pluginManager(input.projectPath as string | undefined).enable(input.name as string);
      case "plugin.disable":
        return this.pluginManager(input.projectPath as string | undefined).disable(input.name as string);
      case "plugin.remove":
        return this.pluginManager(input.projectPath as string | undefined).remove(input.name as string);
      case "plugin.update":
        return this.pluginManager(input.projectPath as string | undefined).update(
          input.name as string,
          input.source as string | undefined
        );
      case "plugin.rollback":
        return this.pluginManager(input.projectPath as string | undefined).rollback(input.name as string);
      case "plugin.invoke":
        return this.pluginManager(input.projectPath as string | undefined).invoke(
          input.name as string,
          input.method as string,
          input.params,
          typeof input.timeoutMs === "number" ? input.timeoutMs : undefined
        );
      case "hooks.list": {
        const projectPath = (input.projectPath as string | undefined) ?? this.options.config.projectPath ?? process.cwd();
        const runner = new HookRunner(this.options.config.config.hooks, { projectRoot: projectPath });
        return { hooks: runner.list(), invalid: runner.validate() };
      }
      case "hooks.test": {
        const projectPath = (input.projectPath as string | undefined) ?? this.options.config.projectPath ?? process.cwd();
        const runner = new HookRunner(this.options.config.config.hooks, {
          projectRoot: projectPath,
          pluginRoot: join(this.options.layout.profileDir, "plugins")
        });
        const event = input.event as HookEvent;
        return runner.run(
          event,
          {
            session_id: input.sessionId as string | undefined,
            tool: input.tool as string | undefined,
            args: input.args,
            prompt: input.prompt as string | undefined
          },
          { cwd: projectPath, dryRun: input.dryRun === true }
        );
      }
      case "permission.respond":
        return this.respondPermission(input.requestId as string, input.approved as boolean, input.remember as boolean);
      case "memory.list":
        return this.memoryService(input.projectPath as string | undefined).list(
          input.scope as "global" | "project" | "all",
          input.limit as number
        );
      case "memory.search":
        return this.memoryService(input.projectPath as string | undefined).search(
          input.query as string,
          input.limit as number
        );
      case "memory.add":
        return this.memoryService(input.projectPath as string | undefined).add({
          text: input.text as string,
          scope: input.scope as "global" | "project",
          kind: input.kind as string,
          tags: input.tags as string[]
        });
      case "memory.update": {
        const updated = this.memoryService(input.projectPath as string | undefined).update(input.id as string, {
          text: input.text as string | undefined,
          kind: input.kind as string | undefined,
          tags: input.tags as string[] | undefined
        });
        if (!updated) throw new RannError("E_NOT_FOUND", `Memori tidak ditemukan: ${input.id}`);
        return updated;
      }
      case "memory.pending":
        return { candidates: this.memoryService(input.projectPath as string | undefined).pending((input.limit as number | undefined) ?? 50) };
      case "memory.approve": {
        const service = this.memoryService(input.projectPath as string | undefined);
        const entry = service.approve(
          input.id as string,
          {
            ...(typeof input.text === "string" ? { text: input.text } : {}),
            ...(Array.isArray(input.tags) ? { tags: input.tags as string[] } : {}),
            ...(typeof input.kind === "string" ? { kind: input.kind } : {})
          }
        );
        if (!entry) throw new RannError("E_NOT_FOUND", "Kandidat memori tidak ditemukan");
        return { approved: entry };
      }
      case "memory.prune":
        return { pruned: this.memoryService(input.projectPath as string | undefined).pruneAgentMemory((input.days as number | undefined) ?? 30) };
      case "memory.reject":
        return { rejected: this.memoryService(input.projectPath as string | undefined).reject(input.id as string) };
      case "memory.remove":
        return {
          removed: this.memoryService(input.projectPath as string | undefined).remove(input.id as string)
        };
      case "memory.export":
        return this.memoryService(input.projectPath as string | undefined).exportAll();
      case "memory.import":
        return this.memoryService(input.projectPath as string | undefined).importAll(
          input.payload as never,
          { replace: input.replace === true }
        );
      case "memory.index":
        return this.memoryService(input.projectPath as string | undefined).indexKnowledge(
          (input.root as string | undefined) ?? (input.projectPath as string | undefined) ?? process.cwd(),
          { maxFiles: typeof input.maxFiles === "number" ? input.maxFiles : 500 }
        );
      case "memory.supersede":
        return this.memoryService(input.projectPath as string | undefined).supersede(
          input.id as string,
          input.text as string,
          (input.reason as string | undefined) ?? "diganti"
        );
      case "skill.list":
        return this.skillStore(input.projectPath as string | undefined).list(input.limit as number);
      case "skill.conflicts":
        return this.skillStore(input.projectPath as string | undefined).conflicts();
      case "skill.view": {
        const skill = this.skillStore(input.projectPath as string | undefined).view(input.name as string);
        if (!skill) throw new RannError("E_NOT_FOUND", `Skill tidak ditemukan: ${input.name}`);
        return skill;
      }
      case "skill.create": {
        const store = this.skillStore(input.projectPath as string | undefined);
        if (input.dryRun === true) {
          return store.validate({
            name: input.name as string,
            description: input.description as string,
            body: input.body as string,
            triggers: input.triggers as string[] | undefined,
            dependencies: input.dependencies as string[] | undefined
          });
        }
        return store.create({
          name: input.name as string,
          description: input.description as string,
          body: input.body as string,
          scope: input.scope as "global" | "project",
          overwrite: input.overwrite as boolean,
          triggers: input.triggers as string[] | undefined,
          dependencies: input.dependencies as string[] | undefined,
          reason: (input.reason as string | undefined) ?? "dibuat",
          actor: (input.actor as string | undefined) ?? "user"
        });
      }
      case "skill.select":
        return this.skillStore(input.projectPath as string | undefined).select(input.task as string, {
          max: typeof input.max === "number" ? input.max : 3,
          include: input.include as string[] | undefined,
          exclude: input.exclude as string[] | undefined
        });
      case "skill.edit":
        return this.skillStore(input.projectPath as string | undefined).edit(input.name as string, {
          body: input.body as string | undefined,
          description: input.description as string | undefined,
          triggers: input.triggers as string[] | undefined,
          reason: input.reason as string | undefined,
          actor: input.actor as string | undefined
        });
      case "skill.history":
        return {
          versions: this.skillStore(input.projectPath as string | undefined).history(input.name as string),
          changelog: this.skillStore(input.projectPath as string | undefined).changelog(input.name as string)
        };
      case "skill.rollback":
        return this.skillStore(input.projectPath as string | undefined).rollback(
          input.name as string,
          input.version as string | undefined
        );
      case "skill.install":
        return this.skillStore(input.projectPath as string | undefined).install(input.source as string, {
          scope: input.scope as "global" | "project" | undefined,
          name: input.name as string | undefined,
          approve: input.approve === true
        });
      case "skill.update":
        return this.skillStore(input.projectPath as string | undefined).update(
          input.name as string,
          input.source as string | undefined
        );
      case "skill.remove":
        return {
          removed: this.skillStore(input.projectPath as string | undefined).remove(
            input.name as string,
            input.scope as "global" | "project"
          )
        };
      default:
        throw new RannError("E_METHOD_NOT_FOUND", `Method belum diimplementasikan: ${request.method}`);
    }
  }

  private async runBackgroundJob(context: JobContext): Promise<unknown> {
    const payload = JSON.parse(context.job.payload_json) as Record<string, unknown>;
    const text = typeof payload.text === "string" ? payload.text : "";
    if (context.job.kind === "shell") {
      return this.runShellCommand(text, this.options.config.projectPath, context.signal);
    }
    if (context.job.kind === "prompt") {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
      if (!sessionId) throw new RannError("E_INVALID_PARAMS", "Job prompt tanpa sessionId");
      return this.runPromptToCompletion(sessionId, text, context.signal);
    }
    if (context.job.kind === "scheduler.run") {
      const runId = typeof payload.runId === "string" ? payload.runId : undefined;
      const command = typeof payload.command === "string" ? payload.command : "";
      try {
        let result: unknown;
        if (command.startsWith("prompt:")) {
          const prompt = command.slice("prompt:".length).trim();
          const sessionId = typeof payload.sessionId === "string" ? (payload.sessionId as string) : undefined;
          result = await this.runScheduledPrompt(prompt, sessionId, context.signal);
        } else {
          const shell = command.startsWith("shell:") ? command.slice("shell:".length) : command;
          result = await this.runShellCommand(shell, this.options.config.projectPath, context.signal);
        }
        if (runId) finishSchedulerRun(this.db, runId, "done", JSON.stringify(result ?? null));
        return result;
      } catch (error) {
        if (runId) finishSchedulerRun(this.db, runId, context.signal.aborted ? "cancelled" : "failed", undefined, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
    throw new RannError("E_UNSUPPORTED", `Jenis job background tidak dikenal: ${context.job.kind}`);
  }

  private async runScheduledPrompt(prompt: string, sessionId: string | undefined, signal: AbortSignal): Promise<unknown> {
    let target = sessionId;
    if (!target) {
      const created = createSession(this.db, {
        projectPath: this.options.config.projectPath,
        title: `Jadwal: ${prompt.slice(0, 60)}`,
        model: this.options.config.config.model.default,
        permissionMode: this.options.config.config.permissions.mode
      });
      target = created.id;
    }
    return this.runPromptToCompletion(target, prompt, signal);
  }

  private async runPromptToCompletion(sessionId: string, text: string, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new RannError("E_CANCELLED", "Job dibatalkan sebelum turn dimulai");
    const started = this.sessionSend({ sessionId, text }) as { turnId: string; sessionId: string };
    const turnId = started.turnId;
    while (true) {
      if (signal.aborted) {
        this.activeTurns.get(sessionId)?.abort();
        throw new RannError("E_CANCELLED", "Job dibatalkan");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      const turn = getTurn(this.db, turnId);
      if (!turn) throw new RannError("E_TURN_NOT_FOUND", `Turn hilang: ${turnId}`);
      if (turn.status === "running" || turn.status === "queued") continue;
      const messages = listMessages(this.db, sessionId, 500).filter((message) => message.turn_id === turnId);
      const last = [...messages].reverse().find((message) => message.role === "assistant");
      if (turn.status === "failed") {
        throw new RannError("E_JOB_FAILED", `Turn background gagal: ${turn.error_code ?? "unknown"}`, {
          data: { code: turn.error_code ?? null, turnId }
        });
      }
      if (turn.status === "cancelled") throw new RannError("E_CANCELLED", "Turn background dibatalkan");
      return { turnId, sessionId, status: turn.status, text: last?.content ?? "" };
    }
  }

  private runShellCommand(
    command: string,
    cwd: string,
    signal: AbortSignal
  ): Promise<{ stdout: string; stderr: string; code: number | null; truncated: boolean }> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new RannError("E_CANCELLED", "Perintah dibatalkan"));
        return;
      }
      const child = spawn(command, {
        cwd,
        shell: true,
        detached: process.platform !== "win32",
        env: sanitizedEnv(),
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let truncated = false;
      const append = (current: string, chunk: string): string => {
        if (current.length >= 20_000) return current;
        const next = current + chunk;
        if (next.length > 20_000) {
          truncated = true;
          return next.slice(0, 20_000);
        }
        return next;
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk.toString("utf8"));
      });
      const kill = (): void => {
        if (!child.pid) return;
        try {
          if (process.platform === "win32") child.kill("SIGTERM");
          else process.kill(-child.pid, "SIGTERM");
        } catch {
          // proses mungkin sudah selesai
        }
        const timer = setTimeout(() => {
          try {
            if (process.platform === "win32") child.kill("SIGKILL");
            else if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
            // abaikan
          }
        }, 2_000);
        timer.unref?.();
      };
      const onAbort = (): void => kill();
      signal.addEventListener("abort", onAbort, { once: true });
      child.once("error", (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.once("close", (code) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          reject(new RannError("E_CANCELLED", "Perintah dibatalkan"));
          return;
        }
        resolve({ stdout, stderr, code, truncated });
      });
    });
  }

  private broadcastJob(type: string, job: JobRow, data?: Record<string, unknown>): void {
    let sessionId = "system";
    try {
      const payload = JSON.parse(job.payload_json) as Record<string, unknown>;
      if (typeof payload.sessionId === "string") sessionId = payload.sessionId;
    } catch {
      // payload rusak tetap dilaporkan tanpa sesi
    }
    const event = appendEvent(this.db, {
      type: "job.update",
      sessionId,
      data: { id: job.id, kind: job.kind, status: job.status, event: type, ...data }
    });
    this.broadcast(event);
  }

  private requestApproval(
    sessionId: string,
    turnId: string,
    tool: string,
    args: unknown,
    signal?: AbortSignal,
    reason?: string,
    risk?: "low" | "medium" | "high"
  ): Promise<ApprovalDecision> {
    const requestId = newId("req");
    const event = appendEvent(this.db, {
      type: "approval.request",
      sessionId,
      turnId,
      data: { request_id: requestId, tool, args: redactSecrets(args), ...(reason ? { reason } : {}), ...(risk ? { risk } : {}) }
    });
    this.broadcast(event);

    return new Promise<ApprovalDecision>((resolve) => {
      const settle = (approved: boolean, remember = false, reason = "user"): void => {
        const entry = this.pendingApprovals.get(requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        entry.signal?.removeEventListener("abort", entry.onAbort);
        this.pendingApprovals.delete(requestId);
        try {
          appendAudit(this.db, {
            actor: "user",
            action: "tool.approval",
            resource: `tool:${entry.tool}`,
            decision: approved ? "allow" : "deny",
            metadata: {
              request_id: requestId,
              session_id: entry.sessionId,
              turn_id: entry.turnId,
              remember,
              reason,
              args: JSON.stringify(redactSecrets(entry.args)).slice(0, 2_000)
            }
          });
        } catch {
          // Audit tidak boleh menahan keputusan izin yang sudah diambil user.
        }
        resolve({ approved, remember });
      };
      const onAbort = (): void => settle(false, false, "cancelled");
      const timer = setTimeout(() => settle(false, false, "timeout"), APPROVAL_TIMEOUT_MS);
      timer.unref?.();
      this.pendingApprovals.set(requestId, { settle, timer, onAbort, signal, sessionId, turnId, tool, args });
      if (signal?.aborted) {
        settle(false);
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private respondPermission(requestId: string, approved: boolean, remember: boolean): { ok: true } {
    const entry = this.pendingApprovals.get(requestId);
    if (!entry) throw new RannError("E_NOT_FOUND", `Permintaan izin tidak ditemukan atau sudah kedaluwarsa: ${requestId}`);
    entry.settle(approved, remember);
    return { ok: true };
  }

  private health(): Record<string, unknown> {
    return {
      status: "ok",
      version: this.options.version,
      protocol: PROTOCOL_VERSION,
      pid: process.pid,
      uptime_ms: Date.now() - this.startedAt,
      home: this.options.layout.home,
      profile: this.options.layout.profile,
      socket: this.options.layout.socketPath,
      database: { path: this.options.layout.dbPath, schema_version: schemaVersion(this.db) },
      providers: providerHealth.snapshot(),
      recovered_turns: this.recoveredTurns.splice(0),
      stalled_turns: this.db.prepare("SELECT turn_id, stall_reason, stalled_at FROM turn_runtime WHERE status = 'stalled'").all(),
      active_turns: [...this.activeTurns.keys()],
      background: this.background.snapshot(),
      scheduler: {
        total: listSchedulers(this.db).length,
        due: dueSchedulers(this.db).length
      }
    };
  }

  private sessionCreate(input: Record<string, unknown>): unknown {
    const config = this.options.config.config;
    const providerConfig = providerFor(config);
    const model = resolveModel(providerConfig, input.model as string | undefined);
    const session = createSession(this.db, {
      projectPath: (input.projectPath as string | undefined) ?? this.options.config.projectPath ?? process.cwd(),
      title: input.title as string | undefined,
      model,
      permissionMode: (input.permissionMode as AgentConfig["permissionMode"] | undefined) ?? config.permissions.mode
    });
    const event = appendEvent(this.db, { type: "session.updated", sessionId: session.id, data: { title: session.title, model: session.model } });
    this.broadcast(event);
    return session;
  }

  private turnGet(input: Record<string, unknown>): unknown {
    const turn = getTurn(this.db, input.turnId as string);
    if (!turn) throw new RannError("E_TURN_NOT_FOUND", `Turn tidak ditemukan: ${input.turnId}`);
    const messages = listMessages(this.db, turn.session_id, 500).filter((message) => message.turn_id === turn.id);
    return { ...turn, messages };
  }

  private sessionSend(input: Record<string, unknown>): unknown {
    const sessionId = input.sessionId as string;
    const session = getSession(this.db, sessionId);
    if (!session) throw new RannError("E_SESSION_NOT_FOUND", `Sesi tidak ditemukan: ${sessionId}`);
    if (session.status !== "active") throw new RannError("E_CONFLICT", `Sesi ${sessionId} berstatus ${session.status}`);
    if (this.activeTurns.has(sessionId)) throw new RannError("E_CONFLICT", `Sesi ${sessionId} masih menjalankan turn lain`);

    const config = this.options.config.config;
    seedRegistry(this.db, config);
    const projectPath = session.project_id
      ? (this.db.prepare("SELECT path FROM projects WHERE id = ?").get(session.project_id) as { path: string } | undefined)?.path
      : process.cwd();
    const workspaceRoot = projectPath ?? process.cwd();
    const attachments = prepareAttachments(
      input.attachments as RawAttachment[] | undefined,
      workspaceRoot,
      this.options.layout.artifactsDir
    );
    const requested = ((input.model as string | undefined) ?? session.model ?? "").trim();
    const target = this.resolveTarget(config, requested);
    let providerName = target.providerName;
    let providerConfig = providerFor(config, providerName);
    let descriptor = resolveDescriptor(this.db, config, providerName, target.model);
    let reason = input.model ? "override request" : "model sesi";
    const asksAuto = input.model === undefined || input.model === "auto";
    if (config.routing.mode === "auto" && asksAuto) {
      const snapshot = providerHealth.snapshot();
      const health: Record<string, HealthState> = {};
      for (const [name, entry] of Object.entries(snapshot)) health[name] = entry.status;
      const decision = routeModel({
        prompt: input.text as string,
        descriptors: registrySnapshot(this.db, config),
        health,
        policy: config.routing.policy,
        ...(config.routing.pinned ? { pinned: config.routing.pinned } : {}),
        prefer: config.routing.prefer,
        ...(config.routing.min_quality !== undefined ? { minQuality: config.routing.min_quality } : {}),
        ...(config.routing.max_cost_per_task !== undefined ? { maxCostPerTask: config.routing.max_cost_per_task } : {}),
        strictBudget: config.routing.strict_budget
      });
      const picked = decision.chosen
        ? registrySnapshot(this.db, config).find((item) => item.id === decision.chosen)
        : undefined;
      if (picked) {
        descriptor = picked;
        providerName = picked.provider;
        providerConfig = providerFor(config, providerName);
        reason = `routing otomatis: ${decision.taskClass} skor ${decision.score.toFixed(3)}${decision.warning ? ` (${decision.warning})` : ""}`;
      } else {
        reason = `routing otomatis gagal, memakai ${descriptor.id}${decision.warning ? ` (${decision.warning})` : ""}`;
      }
    }
    if (attachments.some((attachment) => attachment.kind === "image") && descriptor.capabilities.vision !== true) {
      throw new RannError("E_UNSUPPORTED", `Model ${descriptor.id} tidak mendukung gambar. Pilih model vision lewat /model.`);
    }
    const provider = createProvider(providerName, providerConfig, process.env, this.secrets);
    const model = descriptor.model;
    const fallbacks: NonNullable<RunTurnOptions["fallbacks"]> = [];
    for (const id of config.model.fallback) {
      if (id === descriptor.id) continue;
      const slash = id.indexOf("/");
      const providerName = slash > 0 ? id.slice(0, slash) : config.provider;
      const providerEntry = config.providers[providerName];
      if (!providerEntry) continue;
      try {
        const modelId = slash > 0 ? id.slice(slash + 1) : id;
        const candidate = resolveDescriptor(this.db, config, providerName, modelId);
        fallbacks.push({
          provider: createProvider(providerName, providerEntry, process.env, this.secrets),
          model: candidate.model,
          contextWindow: candidate.contextWindow,
          maxOutputTokens: candidate.maxOutputTokens
        });
      } catch {
        // provider fallback tanpa kredensial valid dilewati
      }
    }
    const turn = createTurn(this.db, { sessionId, idempotencyKey: input.idempotencyKey as string | undefined });
    startTurnRuntime(this.db, { turnId: turn.id, maxRuntimeMs: config.agent.max_runtime_ms });
    const heartbeat = setInterval(() => {
      heartbeatTurnRuntime(this.db, turn.id);
    }, config.agent.heartbeat_ms);
    heartbeat.unref();
    setTurnModel(this.db, turn.id, descriptor.id);
    recordRoutingLog(this.db, {
      sessionId,
      turnId: turn.id,
      requestedModel: asksAuto && config.routing.mode === "auto" ? "auto" : (input.model as string | undefined) ?? session.model,
      selectedModel: descriptor.id,
      reason
    });

    const controller = new AbortController();
    this.activeTurns.set(sessionId, controller);
    const approvals = this.sessionApprovals.get(sessionId) ?? new Set<string>();
    this.sessionApprovals.set(sessionId, approvals);
    const approvalPatterns = this.sessionApprovalPatterns.get(sessionId) ?? new Set<string>();
    this.sessionApprovalPatterns.set(sessionId, approvalPatterns);

    const agentConfig: AgentConfig = {
      permissionMode: (input.permissionMode as AgentConfig["permissionMode"] | undefined) ?? session.permission_mode,
      workspaceOnly: config.permissions.workspace_only,
      allow: config.permissions.allow,
      deny: config.permissions.deny,
      maxSteps: config.agent.max_steps,
      maxRuntimeMs: config.agent.max_runtime_ms,
      systemExtra: config.agent.system_extra,
      preApprovedTools: approvals,
      preApprovedPatterns: approvalPatterns,
      requestApproval: (request) => this.requestApproval(sessionId, turn.id, request.tool, request.args, controller.signal, request.reason, request.risk),
      ...(config.hooks.length > 0
        ? {
            hooks: new HookRunner(config.hooks, {
              projectRoot: workspaceRoot,
              pluginRoot: join(this.options.layout.profileDir, "plugins")
            })
          }
        : {}),
      ...(config.plugins.enabled ? { plugins: this.pluginManager(workspaceRoot) } : {}),
      scheduleTask: async (input) => {
        const job = enqueueJob(this.db, {
          kind: "prompt",
          priority: input.priority ?? 100,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
          ...(input.delaySeconds ? { nextRunAt: Date.now() + input.delaySeconds * 1_000 } : {}),
          payload: { text: input.text, sessionId }
        });
        appendAudit(this.db, {
          actor: "agent",
          action: "background.enqueue",
          resource: job.id,
          decision: "ok",
          metadata: { kind: "prompt", source: "tool", session_id: sessionId }
        });
        this.broadcastJob("queued", job);
        return { job_id: job.id, status: job.status, run_at: job.next_run_at };
      },
      sendMessage: async (chatId, text, threadId) => this.messaging.send(chatId, text, threadId)
    };

    const memory = config.memory.enabled
      ? new MemoryService(this.db, workspaceRoot, {
          enabled: config.memory.enabled,
          promptChars: config.memory.prompt_chars,
          retrieve: config.memory.retrieve,
          sessionId
        })
      : undefined;
    const skills = config.skills.enabled ? new SkillStore(this.options.layout.profileDir, workspaceRoot) : undefined;
    const mcp = config.mcp.enabled && Object.keys(config.mcp.servers).length > 0 ? this.mcp : undefined;

    let spawned = 0;
    const delegate = config.subagents.enabled
      ? async (delegateInput: DelegateInput): Promise<unknown> => {
          if (spawned >= config.subagents.max_per_turn) {
            throw new RannError(
              "E_BUDGET_EXHAUSTED",
              `Batas subagent per turn tercapai: ${config.subagents.max_per_turn}`
            );
          }
          spawned += 1;
          if (delegateInput.background) {
            let startedResolve: (agentId: string) => void = () => {};
            let startedReject: (error: unknown) => void = () => {};
            const started = new Promise<string>((resolve, reject) => {
              startedResolve = resolve;
              startedReject = reject;
            });
            const task = this.runSubagent({
              parent: session,
              parentTurnId: turn.id,
              projectPath: workspaceRoot,
              model,
              input: delegateInput,
              signal: controller.signal,
              onStarted: startedResolve
            }).then(
              () => undefined,
              (error: unknown) => {
                startedReject(error);
                try {
                  const event = appendEvent(this.db, {
                    type: "error",
                    sessionId: session.id,
                    turnId: turn.id,
                    data: { error_code: "E_JOB_FAILED", message: `Subagent latar gagal: ${error instanceof Error ? error.message : String(error)}` }
                  });
                  this.broadcast(event);
                } catch {
                  // pelaporan kegagalan subagent bersifat best effort
                }
              }
            );
            this.backgroundAgents.add(task);
            void task.finally(() => this.backgroundAgents.delete(task));
            const agentId = await started;
            return { agent_id: agentId, status: "running", background: true };
          }
          return this.runSubagent({
            parent: session,
            parentTurnId: turn.id,
            projectPath: workspaceRoot,
            model,
            input: delegateInput,
            signal: controller.signal
          });
        }
      : undefined;

    void runTurn({
      db: this.db,
      session,
      turnId: turn.id,
      userText: input.text as string,
      ...(attachments.length > 0 ? { attachments } : {}),
      provider,
      model,
      workspaceRoot,
      ...(this.options.layout.checkpointsDir ? { checkpointsDir: this.options.layout.checkpointsDir } : {}),
      config: { ...agentConfig, instructionsHome: this.options.layout.profileDir },
      browser: this.browser,
      context: {
        maxTokens: config.context.max_tokens,
        keepRecent: config.context.keep_recent,
        summaryChars: config.context.summary_chars
      },
      budget: {
        maxTokensPerTurn: config.budget.max_tokens_per_turn,
        maxTokensPerDay: config.budget.max_tokens_per_day,
        maxUsdPerDay: config.budget.max_usd_per_day
      },
      memory,
      skills,
      mcp,
      delegate,
      planOnly: input.planOnly === true,
      forcePlan: input.forcePlan === true,
      modelCapabilities: descriptor.capabilities,
      contextWindow: descriptor.contextWindow,
      maxOutputTokens: descriptor.maxOutputTokens,
      fallbacks,
      costUsd: (inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens) =>
        costFor(descriptor, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
      approvePlan: async (plan) => {
        const decision = await this.requestApproval(
          sessionId,
          turn.id,
          "plan",
          { goal: plan.goal, high_risk: plan.highRisk, text: plan.text },
          controller.signal,
          plan.highRisk ? "rencana berisiko tinggi" : "persetujuan rencana",
          plan.highRisk ? "high" : undefined
        );
        return decision.approved;
      },
      signal: controller.signal,
      emit: (event) => this.broadcast(event)
    })
      .catch((error: unknown) => {
        const failure = error instanceof RannError ? error : new RannError("E_INTERNAL", error instanceof Error ? error.message : String(error));
        try {
          finishTurn(this.db, { id: turn.id, status: "failed", error: { code: failure.code, message: failure.message } });
          const event = appendEvent(this.db, {
            type: "turn.failed",
            sessionId,
            turnId: turn.id,
            data: { error_code: failure.code, message: failure.message, analysis: analyzeFailure(failure) }
          });
          this.broadcast(event);
        } catch {
          // kegagalan pencatatan tidak boleh menutupi kegagalan turn
        }
      })
      .finally(() => {
        clearInterval(heartbeat);
        try {
          const finalTurn = getTurn(this.db, turn.id);
          const runtimeStatus = finalTurn?.status === "done" ? "done" : finalTurn?.status === "cancelled" ? "cancelled" : "failed";
          finishTurnRuntime(this.db, turn.id, runtimeStatus);
        } catch {
          // runtime tracking bersifat best effort
        }
        this.activeTurns.delete(sessionId);
      });

    return { turnId: turn.id, status: "running", sessionId };
  }

  private pluginManager(projectPath?: string): PluginManager {
    return new PluginManager(this.options.layout.profileDir, projectPath ?? this.options.config.projectPath);
  }

  private resolveTarget(config: LoadedConfig["config"], requested: string): { providerName: string; model: string } {
    const aliasMatch = Object.entries(config.models ?? {}).find(([, value]) => value.aliases.includes(requested));
    if (aliasMatch) {
      const slash = aliasMatch[0].indexOf("/");
      if (slash > 0) {
        return { providerName: aliasMatch[0].slice(0, slash), model: aliasMatch[0].slice(slash + 1) };
      }
    }
    const slash = requested.indexOf("/");
    if (slash > 0) {
      const providerName = requested.slice(0, slash);
      if (providerName === "mock" || config.providers[providerName]) {
        return { providerName, model: requested.slice(slash + 1) };
      }
    }
    const providerName = config.provider;
    const entry = providerFor(config, providerName);
    const model = requested && requested !== "auto" ? requested : resolveModel(entry, undefined);
    return { providerName, model };
  }

  private async acquireSubagentSlot(key: string, limit: number, signal?: AbortSignal): Promise<() => void> {
    const slot = this.subagentSlots.get(key) ?? { running: 0, waiters: [] };
    this.subagentSlots.set(key, slot);
    if (slot.running < limit) {
      slot.running += 1;
      return this.releaseSubagentSlot(key);
    }
    await new Promise<void>((resolveSlot, rejectSlot) => {
      const waiter = (): void => {
        cleanup();
        slot.running += 1;
        resolveSlot();
      };
      const onAbort = (): void => {
        cleanup();
        slot.waiters = slot.waiters.filter((item) => item !== waiter);
        rejectSlot(new RannError("E_CANCELLED", "Menunggu slot subagent dibatalkan"));
      };
      const cleanup = (): void => signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      slot.waiters.push(waiter);
    });
    return this.releaseSubagentSlot(key);
  }

  private releaseSubagentSlot(key: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const slot = this.subagentSlots.get(key);
      if (!slot) return;
      slot.running = Math.max(0, slot.running - 1);
      const next = slot.waiters.shift();
      if (next) next();
      else if (slot.running === 0) this.subagentSlots.delete(key);
    };
  }

  private recordAgentMessage(input: {
    from: string;
    to: string;
    type: "note" | "question" | "answer" | "conflict";
    subject: string;
    body: string;
    priority?: "low" | "normal" | "high";
    refs?: string[];
  }): { id: string; escalated: boolean } {
    const from = getSubagent(this.db, input.from);
    const to = getSubagent(this.db, input.to);
    if (!from || !to) throw new RannError("E_NOT_FOUND", "Agent pengirim atau tujuan tidak ditemukan");
    if (from.id === to.id) throw new RannError("E_TOOL_INVALID_ARGS", "Agent tidak bisa mengirim pesan ke dirinya sendiri");
    const root = (path: string | null): string => (path ?? "").split("/")[0] ?? "";
    const related = from.parent_id === to.id || to.parent_id === from.id || (root(from.path) !== "" && root(from.path) === root(to.path));
    if (!related) throw new RannError("E_PERMISSION", "Pesan hanya boleh ke parent, anak, atau peer dalam tim yang sama");
    const id = recordSubagentMessage(this.db, {
      from: input.from,
      to: input.to,
      type: input.type,
      subject: input.subject,
      body: input.body,
      priority: input.priority ?? "normal",
      ...(input.refs ? { refs: input.refs } : {})
    });
    let escalated = false;
    if (input.type === "conflict") {
      const count = this.db
        .prepare("SELECT COUNT(*) AS n FROM subagent_messages WHERE type = 'conflict' AND ((from_agent = ? AND to_agent = ?) OR (from_agent = ? AND to_agent = ?))")
        .get(input.from, input.to, input.to, input.from) as { n?: number } | undefined;
      if ((count?.n ?? 0) >= 3) {
        escalated = true;
        const rootAgent = from.depth === 0 ? from : to.depth === 0 ? to : from;
        const sessionId = rootAgent.session_id ?? this.options.config.projectPath ?? "";
        if (sessionId) {
          try {
            const event = appendEvent(this.db, {
              type: "error",
              sessionId,
              data: {
                error_code: "E_AGENT_CONFLICT",
                escalation: true,
                message: `Konflik antar agen belum selesai setelah ${count?.n ?? 3} pesan: ${input.subject}`,
                from: input.from,
                to: input.to
              }
            });
            this.broadcast(event);
          } catch {
            // eskalasi best effort
          }
        }
      }
    }
    return { id, escalated };
  }

  private async runSubagent(options: {
    parent: SessionRow;
    parentTurnId: string;
    projectPath: string;
    model: string;
    input: DelegateInput;
    signal: AbortSignal;
    onStarted?: (agentId: string) => void;
  }): Promise<unknown> {
    const config = this.options.config.config;
    if (!config.subagents.enabled) throw new RannError("E_PERMISSION", "Subagent tidak aktif di config");
    if (options.signal.aborted) throw new RannError("E_CANCELLED", "Subagent dibatalkan");
    if (countSubagentsForTurn(this.db, options.parentTurnId) >= config.subagents.max_per_turn) {
      throw new RannError("E_BUDGET_EXHAUSTED", `Subagent per turn maksimum ${config.subagents.max_per_turn} tercapai`);
    }

    const parentAgent = getSubagentByTurn(this.db, options.parentTurnId);
    const depth = parentAgent ? parentAgent.depth + 1 : 0;
    if (depth >= config.subagents.max_depth) {
      throw new RannError("E_PERMISSION", `Kedalaman subagent maksimum ${config.subagents.max_depth} tercapai`);
    }
    if (parentAgent && countSubagentChildren(this.db, parentAgent.id) >= config.subagents.max_children) {
      throw new RannError("E_BUDGET_EXHAUSTED", `Anak subagent maksimum ${config.subagents.max_children} tercapai`);
    }

    const profiles = loadProfiles(this.options.layout.home, options.projectPath);
    let selected: SubagentProfile;
    try {
      selected = pickProfile(profiles, options.input.profile, options.input.goal);
    } catch (error) {
      throw new RannError("E_TOOL_INVALID_ARGS", error instanceof Error ? error.message : String(error));
    }

    const requestedModel = selected.model ?? config.subagents.model ?? options.model;
    const target = this.resolveTarget(config, requestedModel);
    const descriptor = resolveDescriptor(this.db, config, target.providerName, target.model);
    const provider = createProvider(target.providerName, providerFor(config, target.providerName), process.env, this.secrets);
    const rank: Record<string, number> = { "read-only": 0, ask: 1, custom: 1, "accept-edits": 2, trusted: 3 };
    const profileMode = config.subagents.permission_mode === "read-only" ? "read-only" : selected.permission;
    const sessionMode = options.parent.permission_mode;
    const permissionMode = (rank[sessionMode] ?? 1) <= (rank[profileMode] ?? 1) ? sessionMode : profileMode;
    const maxSteps = Math.max(1, Math.min(options.input.maxSteps ?? selected.maxSteps, config.subagents.max_steps, 30));

    const child = createSession(this.db, {
      projectPath: options.projectPath,
      parentId: options.parent.id,
      title: `Subagent ${selected.name}: ${(options.input.label ?? options.input.goal).trim().slice(0, 50)}`,
      model: `${target.providerName}/${target.model}`,
      permissionMode
    });
    const created = appendEvent(this.db, {
      type: "session.updated",
      sessionId: child.id,
      data: { title: child.title, model: child.model, parent_id: options.parent.id }
    });
    this.broadcast(created);

    const turn = createTurn(this.db, { sessionId: child.id });
    const agent = createSubagent(this.db, {
      sessionId: child.id,
      turnId: turn.id,
      parentTurnId: options.parentTurnId,
      profile: selected.name,
      goal: options.input.goal,
      depth,
      path: parentAgent ? `${parentAgent.path}/${selected.name}` : selected.name,
      model: `${target.providerName}/${target.model}`,
      permissionMode,
      metadata: {
        context: options.input.context ?? null,
        acceptance: options.input.acceptance ?? null,
        files: options.input.files ?? [],
        timeout_ms: options.input.timeoutMs ?? null,
        max_steps: maxSteps,
        max_depth: config.subagents.max_depth,
        profile_source: selected.source,
        output: selected.output
      },
      ...(parentAgent ? { parentId: parentAgent.id } : {})
    });
    options.onStarted?.(agent.id);
    const agentHooks = config.hooks ? new HookRunner(config.hooks, { projectRoot: options.projectPath }) : undefined;
    await agentHooks?.run("AgentSpawn", { agent_id: agent.id, profile: selected.name, goal: options.input.goal, depth }, { cwd: options.projectPath });

    const controller = new AbortController();
    const relayAbort = (): void => controller.abort();
    options.signal.addEventListener("abort", relayAbort, { once: true });
    this.agentControllers.set(agent.id, controller);

    const emitAgent = (): void => {
      try {
        const current = getSubagent(this.db, agent.id);
        const event = appendEvent(this.db, {
          type: "agent.update",
          sessionId: options.parent.id,
          turnId: options.parentTurnId,
          data: {
            agent_id: agent.id,
            parent_id: parentAgent?.id ?? null,
            profile: selected.name,
            status: current?.status ?? "running",
            depth,
            steps: current?.steps ?? 0,
            cost_usd: current?.cost_usd ?? 0
          }
        });
        this.broadcast(event);
      } catch {
        // kegagalan event tidak boleh menghentikan subagent
      }
    };

    updateSubagent(this.db, agent.id, { status: "running" });
    emitAgent();
    const heartbeat = setInterval(() => {
      try {
        heartbeatSubagent(this.db, agent.id);
        emitAgent();
      } catch {
        // heartbeat bersifat best effort
      }
    }, config.subagents.heartbeat_ms);

    const tools = selected.tools === "*" ? undefined : [...selected.tools];
    if (tools) {
      if (depth + 1 < config.subagents.max_depth && !tools.includes("task")) tools.push("task");
      if (!tools.includes("agent_message")) tools.push("agent_message");
    }

    const before = this.gitChangedFiles(options.projectPath);
    const memory = config.memory.enabled && selected.memory
      ? new MemoryService(this.db, options.projectPath, {
          enabled: config.memory.enabled,
          promptChars: config.memory.prompt_chars,
          retrieve: config.memory.retrieve,
          sessionId: child.id,
          agentProfile: selected.name
        })
      : undefined;
    const skills = config.skills.enabled ? new SkillStore(this.options.layout.profileDir, options.projectPath) : undefined;
    const mcp = config.mcp.enabled && Object.keys(config.mcp.servers).length > 0 ? this.mcp : undefined;

    const childConfig: AgentConfig = {
      permissionMode,
      workspaceOnly: config.permissions.workspace_only,
      allow: config.permissions.allow,
      deny: config.permissions.deny,
      maxSteps,
      ...(tools ? { tools } : {}),
      systemExtra: [
        selected.systemPrompt,
        `Tujuan: ${options.input.goal}`,
        options.input.context ? `Konteks dari agent induk: ${options.input.context}` : "",
        options.input.acceptance ? `Kriteria selesai: ${options.input.acceptance}` : "",
        options.input.files && options.input.files.length > 0 ? `Berkas relevan: ${options.input.files.join(", ")}` : "",
        "Kamu tidak bisa bertanya ke pengguna. Akhiri dengan ringkasan hasil yang bisa dipakai agent induk."
      ]
        .filter(Boolean)
        .join("\n"),
      requestApproval: (request) =>
        this.requestApproval(options.parent.id, options.parentTurnId, request.tool, request.args, controller.signal, request.reason, request.risk),
      ...(config.hooks.length > 0
        ? {
            hooks: new HookRunner(config.hooks, {
              projectRoot: options.projectPath,
              pluginRoot: join(this.options.layout.profileDir, "plugins")
            })
          }
        : {}),
      ...(config.plugins.enabled ? { plugins: this.pluginManager(options.projectPath) } : {})
    };

    const runSignal = options.input.timeoutMs
      ? AbortSignal.any([controller.signal, AbortSignal.timeout(options.input.timeoutMs)])
      : controller.signal;
    const releaseSlot = await this.acquireSubagentSlot(`${target.providerName}/${target.model}`, config.subagents.max_concurrent, runSignal);
    try {
      const result = await runTurn({
        db: this.db,
        session: child,
        turnId: turn.id,
        agentId: agent.id,
        userText: options.input.goal,
        provider,
        model: target.model,
        workspaceRoot: options.projectPath,
        ...(this.options.layout.checkpointsDir ? { checkpointsDir: this.options.layout.checkpointsDir } : {}),
        config: childConfig,
        browser: this.browser,
        context: {
          maxTokens: config.context.max_tokens,
          keepRecent: config.context.keep_recent,
          summaryChars: config.context.summary_chars
        },
        budget: {
          maxTokensPerTurn: config.budget.max_tokens_per_turn,
          maxTokensPerDay: config.budget.max_tokens_per_day,
          maxUsdPerDay: config.budget.max_usd_per_day
        },
        memory,
        skills,
        mcp,
        modelCapabilities: descriptor.capabilities,
        contextWindow: descriptor.contextWindow,
        maxOutputTokens: descriptor.maxOutputTokens,
        costUsd: (inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens) =>
          costFor(descriptor, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
        agentMessage: async (message) => this.recordAgentMessage({ ...message, from: agent.id }),
        signal: runSignal,
        emit: (event) => this.broadcast(event)
      });
      const after = this.gitChangedFiles(options.projectPath);
      const filesChanged = [...after].filter((file) => !before.has(file));
      const costUsd =
        costFor(descriptor, result.usage.inputTokens, result.usage.outputTokens, result.usage.cacheReadTokens, result.usage.cacheWriteTokens) ?? 0;
      touchSession(this.db, child.id, { status: "closed" });
      updateSubagent(this.db, agent.id, { status: "done", steps: result.steps, cost_usd: costUsd });
      const evidencePattern = /(?:[\w./-]+\.\w+:\d+|\b(?:pnpm|npm|npx|node|git|pytest|go test|cargo test)\b)/;
      const verified = filesChanged.length > 0 || evidencePattern.test(result.text);
      const summary = {
        agent_id: agent.id,
        profile: selected.name,
        session_id: child.id,
        turn_id: turn.id,
        status: "done" as const,
        verified,
        unverified_reason: verified ? null : "Ringkasan tidak memuat path:baris atau perintah yang bisa diperiksa",
        acceptance: options.input.acceptance ?? null,
        text: result.text,
        steps: result.steps,
        usage: result.usage,
        cost_usd: costUsd,
        files_changed: filesChanged
      };
      finishSubagent(this.db, agent.id, "done", summary);
      await agentHooks?.run("AgentComplete", { agent_id: agent.id, profile: selected.name, status: "done", steps: result.steps }, { cwd: options.projectPath });
      emitAgent();
      return summary;
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof RannError && error.code === "E_CANCELLED");
      touchSession(this.db, child.id, { status: cancelled ? "closed" : "error" });
      updateSubagent(this.db, agent.id, { status: cancelled ? "cancelled" : "failed" });
      finishSubagent(this.db, agent.id, cancelled ? "cancelled" : "failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      await agentHooks?.run("AgentComplete", { agent_id: agent.id, profile: selected.name, status: cancelled ? "cancelled" : "failed" }, { cwd: options.projectPath }).catch(() => undefined);
      emitAgent();
      throw error;
    } finally {
      clearInterval(heartbeat);
      options.signal.removeEventListener("abort", relayAbort);
      this.agentControllers.delete(agent.id);
      releaseAgentLeases(this.db, agent.id);
      releaseSlot();
    }
  }

  private gitChangedFiles(root: string): Set<string> {
    try {
      const output = execFileSync("git", ["status", "--porcelain"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000
      });
      const files = new Set<string>();
      for (const line of output.split("\n")) {
        if (line.trim().length < 4) continue;
        const value = line.slice(3).trim();
        const arrow = value.indexOf(" -> ");
        files.add(arrow === -1 ? value : value.slice(arrow + 4));
      }
      return files;
    } catch {
      return new Set<string>();
    }
  }

  private memoryService(projectPath?: string, sessionId?: string): MemoryService {
    const config = this.options.config.config;
    if (!config.memory.enabled) throw new RannError("E_PERMISSION", "Memori lokal tidak aktif di config");
    return new MemoryService(this.db, projectPath ?? process.cwd(), {
      enabled: config.memory.enabled,
      promptChars: config.memory.prompt_chars,
      retrieve: config.memory.retrieve,
      ...(sessionId ? { sessionId } : {})
    });
  }

  private skillStore(projectPath?: string): SkillStore {
    const config = this.options.config.config;
    if (!config.skills.enabled) throw new RannError("E_PERMISSION", "Skill lokal tidak aktif di config");
    return new SkillStore(this.options.layout.profileDir, projectPath ?? process.cwd());
  }

  private modelList(): unknown {
    const config = this.options.config.config;
    const current = config.providers[config.provider];
    seedRegistry(this.db, config);
    const defaultModel = resolveModel(current ?? ({ kind: "mock", models: [] } as never));
    const descriptors = registrySnapshot(this.db, config);
    const models = new Set<string>(current?.models ?? []);
    if (defaultModel) models.add(defaultModel);
    return {
      provider: config.provider,
      default: defaultModel,
      models: [...models],
      descriptors
    };
  }

  private providerList(): unknown {
    const config = this.options.config.config;
    const entries = Object.entries(config.providers).map(([name, provider]) => {
      let keyHint: string | null = null;
      if (provider.api_key_ref) {
        try {
          const value = this.secrets.get(provider.api_key_ref);
          if (value) keyHint = `****${value.slice(-4)}`;
        } catch {
          keyHint = null;
        }
      } else if (provider.api_key_env && process.env[provider.api_key_env]) {
        const value = process.env[provider.api_key_env]!;
        keyHint = `****${value.slice(-4)}`;
      }
      return {
        name,
        kind: provider.kind,
        base_url: provider.base_url,
        default_model: provider.default_model,
        models: provider.models,
        has_key: Boolean(
          provider.api_key_ref ||
            (provider.api_key_env && process.env[provider.api_key_env]) ||
            (provider.api_key_file && existsSync(provider.api_key_file))
        ),
        key_hint: keyHint,
        health: providerHealth.get(name).status,
        retry_after_ms: providerHealth.get(name).retryAfterMs ?? null
      };
    });
    if (!config.providers.mock) {
      entries.unshift({
        name: "mock",
        kind: "mock",
        base_url: undefined,
        default_model: "mock-1",
        models: ["mock-1"],
        has_key: true,
        key_hint: "****mock",
        health: "unknown" as const,
        retry_after_ms: null
      } as (typeof entries)[number]);
    }
    return entries;
  }

  private async providerTest(input: Record<string, unknown>): Promise<unknown> {
    const config = this.options.config.config;
    const name = (input.name as string | undefined) ?? config.provider;
    const providerConfig = providerFor(config, name);
    const provider = createProvider(name, providerConfig, process.env, this.secrets);
    const model = (input.model as string | undefined) ?? resolveModel(providerConfig);
    const started = Date.now();
    let reply = "";
    const usage = { inputTokens: 0, outputTokens: 0 };
    try {
      for await (const chunk of provider.chat({
        model,
        messages: [{ role: "user", content: "Balas hanya OK" }],
        maxTokens: 32
      })) {
        if (chunk.type === "text") reply += chunk.text;
        if (chunk.type === "usage") {
          usage.inputTokens += chunk.inputTokens;
          usage.outputTokens += chunk.outputTokens;
        }
      }
    } catch (error) {
      providerHealth.recordFailure(name, toRannError(error));
      throw error;
    }
    const latency = Date.now() - started;
    providerHealth.recordSuccess(name, latency);
    return {
      ok: true,
      provider: name,
      model,
      reply: reply.trim(),
      usage,
      latency_ms: latency
    };
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.dailyBackupTimer) clearInterval(this.dailyBackupTimer);
    await this.messaging.stop();
    await this.gateway.stop();
    this.scheduler.stop();
    await this.background.stop();
    for (const controller of this.activeTurns.values()) controller.abort();
    this.activeTurns.clear();
    for (const controller of this.agentControllers.values()) controller.abort();
    this.agentControllers.clear();
    await Promise.allSettled([...this.backgroundAgents]);
    this.backgroundAgents.clear();
    for (const entry of this.pendingApprovals.values()) entry.settle(false);
    this.pendingApprovals.clear();
    this.sessionApprovals.clear();
    this.sessionApprovalPatterns.clear();
    await this.mcp.close();
    await this.browser.closeAll();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    for (const socket of this.sockets) socket.destroy();
    this.db.close();
    if (process.platform !== "win32" && existsSync(this.options.layout.socketPath)) {
      try {
        unlinkSync(this.options.layout.socketPath);
      } catch {
        // abaikan
      }
    }
  }
}
