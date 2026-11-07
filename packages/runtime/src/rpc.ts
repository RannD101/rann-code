import { createServer, type Server, type Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { RannError, PROTOCOL_VERSION, methodParamsSchema, newId, redactSecrets, toRpcError, type EventEnvelope, type RpcRequest } from "@rann/shared";
import {
  appendAudit,
  appendEvent,
  createSession,
  createTurn,
  eventsForTurn,
  finishTurn,
  getSession,
  getTurn,
  listMessages,
  listSessions,
  openDatabase,
  recordRoutingLog,
  schemaVersion,
  setTurnModel,
  summarizeUsage,
  sumCostSince,
  sumTokensSince,
  touchSession,
  SecretStore,
  type Db,
  type SessionRow
} from "@rann/storage";
import { providerFor, type LoadedConfig } from "@rann/shared";
import type { Layout } from "./paths.js";
import { routeModel, type HealthState } from "./router.js";
import { runTurn, type AgentConfig, type ApprovalDecision, type DelegateInput, type RunTurnOptions } from "./agent.js";
import { createProvider, resolveModel } from "./providers/index.js";
import { costFor, registrySnapshot, resolveDescriptor, seedRegistry } from "./models.js";
import { providerHealth } from "./providers/retry.js";
import { MemoryService } from "./memory.js";
import { SkillStore } from "./skills.js";
import { McpManager } from "./mcp.js";

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

export class RpcServer {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly activeTurns = new Map<string, AbortController>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly sessionApprovals = new Map<string, Set<string>>();
  private readonly db: Db;
  private readonly secrets: SecretStore;
  private readonly mcp: McpManager;
  private readonly startedAt = Date.now();
  private closing = false;

  constructor(private readonly options: RpcServerOptions) {
    const opened = openDatabase({
      path: options.layout.dbPath,
      backupBeforeMigrate: options.config.config.storage.backup_before_migrate,
      backupDir: options.layout.backupsDir
    });
    this.db = opened.db;
    this.secrets = new SecretStore({
      dir: options.layout.secretsDir,
      ...(process.env.RANN_SECRET_PASSPHRASE ? { passphrase: process.env.RANN_SECRET_PASSPHRASE } : {})
    });
    this.mcp = new McpManager(options.config.config.mcp.servers, options.version);
    this.server = createServer((socket) => this.attach(socket));
  }

  get database(): Db {
    return this.db;
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
  }

  broadcast(event: EventEnvelope): void {
    const line = JSON.stringify({ jsonrpc: "2.0", method: "event", params: event }) + "\n";
    for (const socket of this.sockets) {
      if (!socket.destroyed) socket.write(line);
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
      const rpcError = toRpcError(error);
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
      case "session.list":
        return listSessions(this.db, {
          status: input.status as string | undefined,
          projectPath: input.projectPath as string | undefined,
          limit: input.limit as number
        });
      case "session.get": {
        const session = getSession(this.db, input.sessionId as string);
        if (!session) throw new RannError("E_SESSION_NOT_FOUND", `Sesi tidak ditemukan: ${input.sessionId}`);
        return { ...session, messages: listMessages(this.db, session.id, 200) };
      }
      case "session.send":
        return this.sessionSend(input);
      case "turn.get":
        return this.turnGet(input);
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
        const { explainKey } = await import("@rann/shared");
        return explainKey(this.options.config, input.key as string);
      }
      case "config.get":
        return {
          config: this.options.config.config,
          files: this.options.config.files,
          home: this.options.config.home,
          project_path: this.options.config.projectPath
        };
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
      case "memory.remove":
        return {
          removed: this.memoryService(input.projectPath as string | undefined).remove(input.id as string)
        };
      case "skill.list":
        return this.skillStore(input.projectPath as string | undefined).list(input.limit as number);
      case "skill.view": {
        const skill = this.skillStore(input.projectPath as string | undefined).view(input.name as string);
        if (!skill) throw new RannError("E_NOT_FOUND", `Skill tidak ditemukan: ${input.name}`);
        return skill;
      }
      case "skill.create":
        return this.skillStore(input.projectPath as string | undefined).create({
          name: input.name as string,
          description: input.description as string,
          body: input.body as string,
          scope: input.scope as "global" | "project",
          overwrite: input.overwrite as boolean
        });
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

  private requestApproval(
    sessionId: string,
    turnId: string,
    tool: string,
    args: unknown,
    signal?: AbortSignal
  ): Promise<ApprovalDecision> {
    const requestId = newId("req");
    const event = appendEvent(this.db, {
      type: "approval.request",
      sessionId,
      turnId,
      data: { request_id: requestId, tool, args: redactSecrets(args) }
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
      active_turns: [...this.activeTurns.keys()]
    };
  }

  private sessionCreate(input: Record<string, unknown>): unknown {
    const config = this.options.config.config;
    const providerConfig = providerFor(config);
    const model = resolveModel(providerConfig, input.model as string | undefined);
    const session = createSession(this.db, {
      projectPath: (input.projectPath as string | undefined) ?? process.cwd(),
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

    const projectPath = session.project_id
      ? (this.db.prepare("SELECT path FROM projects WHERE id = ?").get(session.project_id) as { path: string } | undefined)?.path
      : process.cwd();
    const workspaceRoot = projectPath ?? process.cwd();

    const agentConfig: AgentConfig = {
      permissionMode: (input.permissionMode as AgentConfig["permissionMode"] | undefined) ?? session.permission_mode,
      workspaceOnly: config.permissions.workspace_only,
      allow: config.permissions.allow,
      deny: config.permissions.deny,
      maxSteps: config.agent.max_steps,
      systemExtra: config.agent.system_extra,
      preApprovedTools: approvals,
      requestApproval: (request) => this.requestApproval(sessionId, turn.id, request.tool, request.args, controller.signal)
    };

    const memory = config.memory.enabled
      ? new MemoryService(this.db, workspaceRoot, {
          enabled: config.memory.enabled,
          promptChars: config.memory.prompt_chars,
          retrieve: config.memory.retrieve
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
      provider,
      model,
      workspaceRoot,
      config: agentConfig,
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
      modelCapabilities: descriptor.capabilities,
      contextWindow: descriptor.contextWindow,
      maxOutputTokens: descriptor.maxOutputTokens,
      fallbacks,
      costUsd: (inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens) =>
        costFor(descriptor, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
      approvePlan: async (plan) => {
        const decision = await this.requestApproval(sessionId, turn.id, "plan", {
          goal: plan.goal,
          high_risk: plan.highRisk,
          text: plan.text
        });
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
            data: { error_code: failure.code, message: failure.message }
          });
          this.broadcast(event);
        } catch {
          // kegagalan pencatatan tidak boleh menutupi kegagalan turn
        }
      })
      .finally(() => this.activeTurns.delete(sessionId));

    return { turnId: turn.id, status: "running", sessionId };
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

  private async runSubagent(options: {
    parent: SessionRow;
    parentTurnId: string;
    projectPath: string;
    model: string;
    input: DelegateInput;
    signal: AbortSignal;
  }): Promise<unknown> {
    const config = this.options.config.config;
    if (!config.subagents.enabled) throw new RannError("E_PERMISSION", "Subagent tidak aktif di config");
    if (options.signal.aborted) throw new RannError("E_CANCELLED", "Subagent dibatalkan");

    const child = createSession(this.db, {
      projectPath: options.projectPath,
      parentId: options.parent.id,
      title: `Subagent: ${(options.input.label ?? options.input.goal).trim().slice(0, 60)}`,
      model: config.subagents.model ?? options.model,
      permissionMode: config.subagents.permission_mode
    });
    const created = appendEvent(this.db, {
      type: "session.updated",
      sessionId: child.id,
      data: { title: child.title, model: child.model, parent_id: options.parent.id }
    });
    this.broadcast(created);

    const turn = createTurn(this.db, { sessionId: child.id });
    const provider = createProvider(config.provider, providerFor(config), process.env, this.secrets);
    const memory = config.memory.enabled
      ? new MemoryService(this.db, options.projectPath, {
          enabled: config.memory.enabled,
          promptChars: config.memory.prompt_chars,
          retrieve: config.memory.retrieve
        })
      : undefined;
    const skills = config.skills.enabled ? new SkillStore(this.options.layout.profileDir, options.projectPath) : undefined;
    const mcp = config.mcp.enabled && Object.keys(config.mcp.servers).length > 0 ? this.mcp : undefined;

    const childConfig: AgentConfig = {
      permissionMode: config.subagents.permission_mode,
      workspaceOnly: config.permissions.workspace_only,
      allow: config.permissions.allow,
      deny: config.permissions.deny,
      maxSteps: config.subagents.max_steps,
      systemExtra: [
        "Kamu subagent dengan konteks terpisah.",
        `Tujuan: ${options.input.goal}`,
        options.input.context ? `Konteks dari agent induk: ${options.input.context}` : "",
        "Fokus pada tujuan. Jangan bertanya balik. Akhiri dengan ringkasan hasil yang bisa dipakai agent induk."
      ]
        .filter(Boolean)
        .join("\n"),
      requestApproval: (request) =>
        this.requestApproval(options.parent.id, options.parentTurnId, request.tool, request.args, options.signal)
    };

    try {
      const result = await runTurn({
        db: this.db,
        session: child,
        turnId: turn.id,
        userText: options.input.goal,
        provider,
        model: child.model,
        workspaceRoot: options.projectPath,
        config: childConfig,
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
        signal: options.signal,
        emit: (event) => this.broadcast(event)
      });
      touchSession(this.db, child.id, { status: "closed" });
      return {
        session_id: child.id,
        turn_id: turn.id,
        text: result.text,
        steps: result.steps,
        usage: result.usage,
        compacted: result.compacted
      };
    } catch (error) {
      touchSession(this.db, child.id, { status: "error" });
      throw error;
    }
  }

  private memoryService(projectPath?: string): MemoryService {
    const config = this.options.config.config;
    if (!config.memory.enabled) throw new RannError("E_PERMISSION", "Memori lokal tidak aktif di config");
    return new MemoryService(this.db, projectPath ?? process.cwd(), {
      enabled: config.memory.enabled,
      promptChars: config.memory.prompt_chars,
      retrieve: config.memory.retrieve
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
    return {
      ok: true,
      provider: name,
      model,
      reply: reply.trim(),
      usage,
      latency_ms: Date.now() - started
    };
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    for (const controller of this.activeTurns.values()) controller.abort();
    this.activeTurns.clear();
    for (const entry of this.pendingApprovals.values()) entry.settle(false);
    this.pendingApprovals.clear();
    this.sessionApprovals.clear();
    await this.mcp.close();
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
