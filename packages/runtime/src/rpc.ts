import { createServer, type Server, type Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { RannError, PROTOCOL_VERSION, methodParamsSchema, newId, toRpcError, type EventEnvelope, type RpcRequest } from "@rann/shared";
import {
  appendEvent,
  createSession,
  createTurn,
  eventsForTurn,
  getSession,
  getTurn,
  listMessages,
  listSessions,
  openDatabase,
  schemaVersion,
  type Db
} from "@rann/storage";
import { providerFor, type LoadedConfig } from "@rann/shared";
import type { Layout } from "./paths.js";
import { runTurn, type AgentConfig, type ApprovalDecision } from "./agent.js";
import { createProvider, resolveModel } from "./providers/index.js";

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
  private readonly startedAt = Date.now();
  private closing = false;

  constructor(private readonly options: RpcServerOptions) {
    const opened = openDatabase({
      path: options.layout.dbPath,
      backupBeforeMigrate: options.config.config.storage.backup_before_migrate,
      backupDir: options.layout.backupsDir
    });
    this.db = opened.db;
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
      case "session.cancel": {
        const sessionId = input.sessionId as string;
        const controller = this.activeTurns.get(sessionId);
        if (!controller) return { cancelled: false, reason: "tidak ada turn berjalan" };
        controller.abort();
        return { cancelled: true };
      }
      case "turn.get": {
        const turn = getTurn(this.db, input.turnId as string);
        if (!turn) throw new RannError("E_TURN_NOT_FOUND", `Turn tidak ditemukan: ${input.turnId}`);
        return turn;
      }
      case "turn.events":
        return eventsForTurn(this.db, input.turnId as string, (input.afterSeq as number) ?? 0);
      case "model.list":
        return this.modelList();
      case "provider.list":
        return this.providerList();
      case "config.explain": {
        const { explainKey } = await import("@rann/shared");
        return explainKey(this.options.config, input.key as string);
      }
      case "permission.respond":
        return this.respondPermission(input.requestId as string, input.approved as boolean, input.remember as boolean);
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
      type: "approval.requested",
      sessionId,
      turnId,
      data: { request_id: requestId, tool, args }
    });
    this.broadcast(event);

    return new Promise<ApprovalDecision>((resolve) => {
      const settle = (approved: boolean, remember = false): void => {
        const entry = this.pendingApprovals.get(requestId);
        if (!entry) return;
        clearTimeout(entry.timer);
        entry.signal?.removeEventListener("abort", entry.onAbort);
        this.pendingApprovals.delete(requestId);
        resolve({ approved, remember });
      };
      const onAbort = (): void => settle(false);
      const timer = setTimeout(() => settle(false), APPROVAL_TIMEOUT_MS);
      timer.unref?.();
      this.pendingApprovals.set(requestId, { settle, timer, onAbort, signal });
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
    const event = appendEvent(this.db, { type: "session.created", sessionId: session.id, data: { title: session.title, model: session.model } });
    this.broadcast(event);
    return session;
  }

  private sessionSend(input: Record<string, unknown>): unknown {
    const sessionId = input.sessionId as string;
    const session = getSession(this.db, sessionId);
    if (!session) throw new RannError("E_SESSION_NOT_FOUND", `Sesi tidak ditemukan: ${sessionId}`);
    if (session.status !== "active") throw new RannError("E_CONFLICT", `Sesi ${sessionId} berstatus ${session.status}`);
    if (this.activeTurns.has(sessionId)) throw new RannError("E_CONFLICT", `Sesi ${sessionId} masih menjalankan turn lain`);

    const config = this.options.config.config;
    const providerConfig = providerFor(config);
    const provider = createProvider(config.provider, providerConfig);
    const model = (input.model as string | undefined) ?? session.model;
    const turn = createTurn(this.db, { sessionId, idempotencyKey: input.idempotencyKey as string | undefined });

    const controller = new AbortController();
    this.activeTurns.set(sessionId, controller);
    const approvals = this.sessionApprovals.get(sessionId) ?? new Set<string>();
    this.sessionApprovals.set(sessionId, approvals);
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

    const projectPath = session.project_id
      ? (this.db.prepare("SELECT path FROM projects WHERE id = ?").get(session.project_id) as { path: string } | undefined)?.path
      : process.cwd();

    void runTurn({
      db: this.db,
      session,
      turnId: turn.id,
      userText: input.text as string,
      provider,
      model,
      workspaceRoot: projectPath ?? process.cwd(),
      config: agentConfig,
      signal: controller.signal,
      emit: (event) => this.broadcast(event)
    })
      .catch(() => {
        // kegagalan sudah dicatat sebagai event turn.failed dan status turn
      })
      .finally(() => this.activeTurns.delete(sessionId));

    return { turnId: turn.id, status: "running", sessionId };
  }

  private modelList(): unknown {
    const config = this.options.config.config;
    const current = config.providers[config.provider];
    const defaultModel = resolveModel(current ?? ({ kind: "mock", models: [] } as never));
    const models = new Set<string>(current?.models ?? []);
    if (defaultModel) models.add(defaultModel);
    return {
      provider: config.provider,
      default: defaultModel,
      models: [...models]
    };
  }

  private providerList(): unknown {
    const config = this.options.config.config;
    return Object.entries(config.providers).map(([name, provider]) => ({
      name,
      kind: provider.kind,
      base_url: provider.base_url,
      default_model: provider.default_model,
      models: provider.models,
      has_key: Boolean(provider.api_key_env ?? provider.api_key_file)
    }));
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    for (const controller of this.activeTurns.values()) controller.abort();
    this.activeTurns.clear();
    for (const entry of this.pendingApprovals.values()) entry.settle(false);
    this.pendingApprovals.clear();
    this.sessionApprovals.clear();
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
