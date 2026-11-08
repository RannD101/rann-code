import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { WebSocketServer, type WebSocket } from "ws";
import { createPublicKey, verify } from "node:crypto";
import { RannError, toRannError, type EventEnvelope, type RannConfig } from "@rann/shared";
import type { Db, GatewayDeviceView, GatewayRole, GatewayScope } from "@rann/storage";
import {
  appendAudit,
  authenticate,
  gatewayStats,
  getMappedSession,
  hasScope,
  issuePairCode,
  listDevices,
  mapSession,
  recordGatewayMessage,
  redeemPairCode,
  revokeDevice,
  updateDeviceRole
} from "@rann/storage";
import { dashboardPage } from "./dashboard.js";

export interface GatewayLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
}

export interface GatewayOptions {
  db: Db;
  config: RannConfig;
  version: string;
  profile: string;
  artifactsDir: string;
  invoke: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  discordInteraction?: (payload: Record<string, unknown>) => Promise<string>;
  subscribe: (listener: (event: EventEnvelope) => void) => () => void;
  logger?: GatewayLogger;
}

export interface GatewayStatus {
  running: boolean;
  host: string;
  port: number;
  public_url: string | null;
  tls: boolean;
  clients: number;
  devices: number;
  last_event_seq: number;
  started_at: number | null;
}

interface RecentEvent {
  seq: number;
  event: EventEnvelope;
}

interface PairAttempt {
  count: number;
  resetAt: number;
}

interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  device?: GatewayDeviceView;
}

const MAX_JSON_BODY = 1 * 1024 * 1024;
const MAX_ATTACHMENT = 20 * 1024 * 1024;
const PAIR_WINDOW_MS = 15 * 60_000;
const PAIR_LIMIT = 5;
const DASHBOARD_PATH = "/";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json"
};

function safeEqual(a: string, b: string): boolean {
  const one = Buffer.from(a);
  const two = Buffer.from(b);
  return one.length === two.length && timingSafeEqual(one, two);
}

function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0]!.trim();
  return request.socket.remoteAddress ?? "unknown";
}

function requireScope(device: GatewayDeviceView, scope: GatewayScope): void {
  if (!hasScope(device.scopes, scope)) {
    throw new RannError("E_SCOPE", `Token tidak punya scope ${scope}`, {
      data: { scope, scopes: device.scopes }
    });
  }
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new RannError("E_INPUT_TOO_LARGE", `Body melebihi batas ${limit} byte`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(request, MAX_JSON_BODY);
  if (body.length === 0) return {};
  try {
    const parsed = JSON.parse(body.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("bukan objek");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new RannError("E_INVALID_PARAMS", "Body JSON tidak valid");
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function sendError(response: ServerResponse, error: unknown): void {
  const err = toRannError(error);
  const status =
    (err.code === "E_PERMISSION" || err.code === "E_SCOPE") || err.code === "E_GATEWAY_AUTH"
      ? 403
      : err.code === "E_NOT_FOUND" || err.code === "E_SESSION_NOT_FOUND" || err.code === "E_TURN_NOT_FOUND"
        ? 404
        : err.code === "E_CONFLICT"
          ? 409
          : err.code === "E_RATE_LIMITED"
            ? 429
            : err.code === "E_INPUT_TOO_LARGE"
            ? 413
            : err.code === "E_INVALID_PARAMS"
              ? 400
              : 500;
  sendJson(response, status, {
    error: {
      code: err.code,
      message: err.message,
      traceId: randomBytes(8).toString("hex")
    }
  });
}

export class GatewayServer {
  private readonly db: Db;
  private readonly config: RannConfig;
  private readonly version: string;
  private readonly profile: string;
  private readonly artifactsDir: string;
  private readonly invokeRpc: GatewayOptions["invoke"];
  private readonly discordInteraction?: GatewayOptions["discordInteraction"];
  private readonly subscribeRpc: GatewayOptions["subscribe"];
  private readonly logger?: GatewayLogger;
  private server?: Server;
  private wss?: WebSocketServer;
  private unsubscribe?: () => void;
  private readonly clients = new Set<WebSocket>();
  private readonly recent: RecentEvent[] = [];
  private readonly attempts = new Map<string, PairAttempt>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private startedAt: number | null = null;
  private lastSeq = 0;

  constructor(options: GatewayOptions) {
    this.db = options.db;
    this.config = options.config;
    this.version = options.version;
    this.profile = options.profile;
    this.artifactsDir = options.artifactsDir;
    this.invokeRpc = options.invoke;
    this.discordInteraction = options.discordInteraction;
    this.subscribeRpc = options.subscribe;
    this.logger = options.logger;
  }

  status(): GatewayStatus {
    return {
      running: this.server !== undefined,
      host: this.config.gateway.host,
      port: this.config.gateway.port,
      public_url: this.config.gateway.public_url ?? null,
      tls: Boolean(this.config.gateway.tls_cert && this.config.gateway.tls_key),
      clients: this.clients.size,
      devices: listDevices(this.db).filter((device) => device.revoked_at === null).length,
      last_event_seq: this.lastSeq,
      started_at: this.startedAt
    };
  }

  pairCode(createdBy = "local"): { code: string; expiresAt: number } {
    return issuePairCode(this.db, { createdBy });
  }

  devices(): GatewayDeviceView[] {
    return listDevices(this.db);
  }

  revoke(id: string): boolean {
    const removed = revokeDevice(this.db, id);
    if (removed) {
      for (const client of this.clients) {
        const device = (client as WebSocket & { rannDevice?: GatewayDeviceView }).rannDevice;
        if (device?.id === id) client.close(4003, "token dicabut");
      }
    }
    return removed;
  }

  setRole(id: string, role: GatewayRole): GatewayDeviceView | undefined {
    return updateDeviceRole(this.db, id, role);
  }

  stats(): ReturnType<typeof gatewayStats> {
    return gatewayStats(this.db);
  }

  async start(): Promise<void> {
    if (this.server) return;
    const { host, port, tls_cert, tls_key } = this.config.gateway;
    if ((tls_cert && !tls_key) || (!tls_cert && tls_key)) {
      throw new RannError("E_CONFIG_INVALID", "tls_cert dan tls_key harus diisi bersama");
    }
    if (tls_cert && tls_key && (!existsSync(tls_cert) || !existsSync(tls_key))) {
      throw new RannError("E_CONFIG_INVALID", "Berkas TLS gateway tidak ditemukan");
    }
    const handler = (request: IncomingMessage, response: ServerResponse): void => {
      void this.handle(request, response);
    };
    this.server = tls_cert && tls_key
      ? createHttpsServer({ cert: readFileSync(tls_cert), key: readFileSync(tls_key) }, handler)
      : createHttpServer(handler);
    this.wss = new WebSocketServer({ noServer: true });
    this.server.on("upgrade", (request, socket, head) => {
      void this.upgrade(request, socket as never, head);
    });
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error): void => reject(error);
      this.server!.once("error", onError);
      this.server!.listen(port, host, () => {
        this.server!.off("error", onError);
        resolvePromise();
      });
    });
    this.unsubscribe = this.subscribeRpc((event) => this.onEvent(event));
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        const socket = client as WebSocket & { rannAlive?: boolean; rannMissed?: number };
        if (socket.rannAlive === false) {
          socket.rannMissed = (socket.rannMissed ?? 0) + 1;
          if (socket.rannMissed >= 3) {
            client.terminate();
            continue;
          }
        } else {
          socket.rannMissed = 0;
        }
        socket.rannAlive = false;
        client.ping();
      }
    }, this.config.gateway.heartbeat_ms);
    this.heartbeat.unref?.();
    this.startedAt = Date.now();
    this.logger?.info(`gateway aktif di ${this.config.gateway.public_url ?? `${host}:${String(port)}`}`);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    for (const client of this.clients) client.close(1001, "server berhenti");
    this.clients.clear();
    this.wss?.close();
    this.wss = undefined;
    const server = this.server;
    this.server = undefined;
    this.startedAt = null;
    if (server) {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  }

  private onEvent(event: EventEnvelope): void {
    this.lastSeq = Math.max(this.lastSeq, event.seq);
    this.recent.push({ seq: event.seq, event });
    if (this.recent.length > 1_000) this.recent.splice(0, this.recent.length - 1_000);
    const line = JSON.stringify({ type: "event", event });
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(line);
    }
  }

  private replay(since: number, sessionId?: string): EventEnvelope[] {
    return this.recent
      .filter((item) => item.seq > since)
      .map((item) => item.event)
      .filter((event) => !sessionId || event.sessionId === sessionId);
  }

  private async upgrade(request: IncomingMessage, socket: never, head: Buffer): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/v1/events") {
      (socket as unknown as { destroy: () => void }).destroy();
      return;
    }
    const device = this.authFromRequest(request);
    if (!device || !hasScope(device.scopes, "read")) {
      (socket as unknown as { write: (data: string) => void }).write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      (socket as unknown as { destroy: () => void }).destroy();
      return;
    }
    const nodeName = typeof request.headers["x-rann-node"] === "string" ? request.headers["x-rann-node"] : undefined;
    if (nodeName) {
      const node = this.config.gateway.nodes.find((item) => item.name === nodeName);
      if (!node) {
        (socket as unknown as { write: (data: string) => void }).write("HTTP/1.1 404 Not Found\r\n\r\n");
        (socket as unknown as { destroy: () => void }).destroy();
        return;
      }
      const target = new URL(node.url);
      const token = node.token_env ? process.env[node.token_env] : undefined;
      const headers: string[] = [`GET ${url.pathname}${url.search} HTTP/1.1`];
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined || key === "host" || key === "authorization" || key === "x-rann-node") continue;
        headers.push(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
      }
      headers.push(`host: ${target.host}`);
      if (token) headers.push(`authorization: Bearer ${token}`);
      const upstream = target.protocol === "https:"
        ? tlsConnect({ host: target.hostname, port: Number(target.port || 443), servername: target.hostname })
        : netConnect({ host: target.hostname, port: Number(target.port || 80) });
      upstream.on("connect", () => {
        upstream.write(`${headers.join("\r\n")}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket as never);
        (socket as unknown as NodeJS.ReadableStream).pipe(upstream);
      });
      upstream.on("error", () => (socket as unknown as { destroy: () => void }).destroy());
      return;
    }
    this.wss!.handleUpgrade(request, socket as never, head, (client) => {
      const tagged = client as WebSocket & { rannAlive?: boolean; rannMissed?: number; rannDevice?: GatewayDeviceView };
      tagged.rannAlive = true;
      tagged.rannMissed = 0;
      tagged.rannDevice = device;
      this.clients.add(client);
      client.on("pong", () => {
        tagged.rannAlive = true;
        tagged.rannMissed = 0;
      });
      client.on("close", () => this.clients.delete(client));
      client.on("error", () => this.clients.delete(client));
      const since = Number(url.searchParams.get("since") ?? "0");
      const sessionId = url.searchParams.get("sessionId") ?? undefined;
      client.send(JSON.stringify({ type: "hello", gateway: this.version, device: device.name }));
      for (const event of this.replay(Number.isFinite(since) ? since : 0, sessionId)) {
        client.send(JSON.stringify({ type: "event", event }));
      }
    });
  }

  private async handleDiscordInteraction(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const publicKey = this.config.messaging?.discord?.public_key;
    if (!publicKey) {
      sendJson(response, 503, { error: "discord public_key belum diatur" });
      return;
    }
    const signature = request.headers["x-signature-ed25519"];
    const timestamp = request.headers["x-signature-timestamp"];
    if (typeof signature !== "string" || typeof timestamp !== "string") {
      sendJson(response, 401, { error: "signature discord tidak ada" });
      return;
    }
    const body = await readBody(request, MAX_ATTACHMENT);
    try {
      const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKey, "hex")]);
      const key = createPublicKey({ key: der, format: "der", type: "spki" });
      const valid = verify(null, Buffer.from(`${timestamp}${body.toString("utf8")}`), key, Buffer.from(signature, "hex"));
      if (!valid) {
        sendJson(response, 401, { error: "signature discord tidak valid" });
        return;
      }
      const payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      if (payload.type === 1) {
        sendJson(response, 200, { type: 1 });
        return;
      }
      if (!this.discordInteraction) {
        sendJson(response, 503, { error: "adapter discord tidak aktif" });
        return;
      }
      const content = await this.discordInteraction(payload);
      sendJson(response, 200, { type: 4, data: { content } });
    } catch (error) {
      sendJson(response, 400, { error: toRannError(error).message });
    }
  }

  private async proxyToNode(
    node: { name: string; url: string; token_env?: string },
    request: IncomingMessage,
    response: ServerResponse,
    path: string
  ): Promise<void> {
    if (request.headers.upgrade?.toLowerCase() === "websocket") {
      sendJson(response, 501, { error: "WebSocket multi-node belum didukung lewat proxy", node: node.name });
      return;
    }
    const target = new URL(node.url);
    const body = request.method === "GET" || request.method === "HEAD" ? Buffer.alloc(0) : await readBody(request, MAX_ATTACHMENT);
    const token = node.token_env ? process.env[node.token_env] : undefined;
    const client = target.protocol === "https:" ? httpsRequest : httpRequest;
    await new Promise<void>((resolvePromise) => {
      const upstream = client({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname.replace(/\/$/, "")}${path}`,
        method: request.method,
        headers: {
          ...(typeof request.headers["content-type"] === "string" ? { "content-type": request.headers["content-type"] } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        }
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
        upstreamResponse.on("end", resolvePromise);
      });
      upstream.on("error", (error) => {
        if (!response.headersSent) sendJson(response, 502, { error: "node tidak bisa dihubungi", node: node.name, message: error.message });
        else response.end();
        resolvePromise();
      });
      if (body.length > 0) upstream.write(body);
      upstream.end();
    });
  }

  private authFromRequest(request: IncomingMessage): GatewayDeviceView | undefined {
    const authorization = request.headers.authorization;
    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
      return authenticate(this.db, authorization.slice(7).trim(), this.profile);
    }
    const protocol = request.headers["sec-websocket-protocol"];
    if (typeof protocol === "string") {
      const parts = protocol.split(",").map((part) => part.trim());
      const token = parts.find((part) => part.startsWith("rann_token."))?.slice("rann_token.".length);
      if (token) return authenticate(this.db, token, this.profile);
    }
    return undefined;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    try {
      if (request.method === "OPTIONS") {
        this.cors(response, request);
        response.writeHead(204);
        response.end();
        return;
      }
      this.cors(response, request);
      const context: RequestContext = { request, response, url };
      const path = url.pathname;

      if (path === "/health" || path === "/v1/health/public") {
        sendJson(response, 200, {
          ok: true,
          gateway: "ok",
          version: this.version,
          uptime_ms: this.startedAt ? Date.now() - this.startedAt : 0
        });
        return;
      }
      if (path === DASHBOARD_PATH && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:"
        });
        response.end(dashboardPage(this.version));
        return;
      }
      const nodeName = typeof request.headers["x-rann-node"] === "string" ? request.headers["x-rann-node"] : undefined;
      if (nodeName && path.startsWith("/v1/")) {
        const node = this.config.gateway.nodes.find((item) => item.name === nodeName);
        if (!node) {
          sendJson(response, 404, { error: "node tidak ditemukan", node: nodeName });
          return;
        }
        await this.proxyToNode(node, request, response, path);
        return;
      }
      if (path === "/v1/discord/interactions" && request.method === "POST") {
        await this.handleDiscordInteraction(request, response);
        return;
      }
      if (path === "/v1/auth/pair" && request.method === "POST") {
        await this.handlePair(context);
        return;
      }

      const device = this.authFromRequest(request);
      if (!device) throw new RannError("E_GATEWAY_AUTH", "Token perangkat tidak valid atau dicabut");
      context.device = device;
      requireScope(device, "read");

      if (path === "/v1/auth/me" && request.method === "GET") {
        sendJson(response, 200, { device });
        return;
      }
      if (path === "/v1/health" && request.method === "GET") {
        const health = await this.invokeRpc("health", {});
        sendJson(response, 200, { ...(health as Record<string, unknown>), gateway: this.status() });
        return;
      }
      if (path === "/v1/gateway" && request.method === "GET") {
        requireScope(device, "admin");
        sendJson(response, 200, { status: this.status(), stats: this.stats(), devices: this.devices() });
        return;
      }
      if (path === "/v1/gateway/pair" && request.method === "POST") {
        requireScope(device, "admin");
        const body = await readJson(request);
        const ttl = typeof body.ttl_ms === "number" ? body.ttl_ms : undefined;
        const result = issuePairCode(this.db, { createdBy: device.id, ...(ttl ? { ttlMs: ttl } : {}) });
        sendJson(response, 201, { ...result, expires_in_ms: result.expiresAt - Date.now() });
        return;
      }
      if (path === "/v1/devices" && request.method === "GET") {
        requireScope(device, "admin");
        sendJson(response, 200, this.devices());
        return;
      }
      if (path.startsWith("/v1/devices/") && request.method === "DELETE") {
        requireScope(device, "admin");
        const id = path.slice("/v1/devices/".length);
        sendJson(response, 200, { revoked: this.revoke(id) });
        return;
      }
      if (path.startsWith("/v1/devices/") && path.endsWith("/role") && request.method === "POST") {
        requireScope(device, "admin");
        const id = path.slice("/v1/devices/".length, -"/role".length);
        const body = await readJson(request);
        const role = body.role;
        if (role !== "owner" && role !== "operator" && role !== "viewer" && role !== "approver") {
          throw new RannError("E_INVALID_PARAMS", "role harus owner, operator, viewer, atau approver");
        }
        const updated = this.setRole(id, role);
        if (!updated) throw new RannError("E_NOT_FOUND", `Perangkat tidak ditemukan: ${id}`);
        sendJson(response, 200, updated);
        return;
      }

      if (path === "/v1/overview" && request.method === "GET") {
        const data = await this.pageData("overview");
        sendJson(response, 200, data);
        return;
      }
      if (path.startsWith("/v1/pages/") && request.method === "GET") {
        const page = path.slice("/v1/pages/".length);
        const data = await this.pageData(page, url);
        sendJson(response, 200, data);
        return;
      }
      if (path === "/v1/sessions" && request.method === "GET") {
        const sessions = await this.invokeRpc("session.list", {
          limit: Number(url.searchParams.get("limit") ?? "50")
        });
        sendJson(response, 200, sessions);
        return;
      }
      if (path === "/v1/sessions" && request.method === "POST") {
        requireScope(device, "run");
        const body = await readJson(request);
        const session = await this.invokeRpc("session.create", {
          title: typeof body.title === "string" ? body.title : `Web ${device.name}`,
          ...(typeof body.projectPath === "string" ? { projectPath: body.projectPath } : {}),
          ...(typeof body.model === "string" ? { model: body.model } : {})
        });
        sendJson(response, 201, session);
        return;
      }
      const sessionMatch = /^\/v1\/sessions\/([^/]+)(?:\/(messages|cancel|attachments))?$/.exec(path);
      if (sessionMatch) {
        const sessionId = decodeURIComponent(sessionMatch[1]!);
        const action = sessionMatch[2];
        if (!action && request.method === "GET") {
          const session = await this.invokeRpc("session.get", { sessionId });
          sendJson(response, 200, session);
          return;
        }
        if (action === "messages" && request.method === "GET") {
          const session = (await this.invokeRpc("session.get", { sessionId })) as { messages?: unknown[] };
          sendJson(response, 200, session.messages ?? []);
          return;
        }
        if (action === "messages" && request.method === "POST") {
          requireScope(device, "run");
          const body = await readJson(request);
          const text = typeof body.text === "string" ? body.text.trim() : "";
          if (!text) throw new RannError("E_INVALID_PARAMS", "text wajib diisi");
          const attachments = Array.isArray(body.attachments)
            ? body.attachments.filter((item): item is Record<string, string> => Boolean(item) && typeof item === "object")
            : undefined;
          recordGatewayMessage(this.db, {
            deviceId: device.id,
            channel: "web",
            channelKey: sessionId,
            direction: "in",
            body: text
          });
          const turn = await this.invokeRpc("session.send", {
            sessionId,
            text,
            ...(attachments && attachments.length > 0 ? { attachments } : {})
          });
          sendJson(response, 202, turn);
          return;
        }
        if (action === "cancel" && request.method === "POST") {
          requireScope(device, "run");
          const result = await this.invokeRpc("session.cancel", { sessionId });
          sendJson(response, 200, result);
          return;
        }
        if (action === "attachments" && request.method === "POST") {
          requireScope(device, "run");
          const attachment = await this.saveAttachment(request);
          sendJson(response, 201, attachment);
          return;
        }
      }
      const approvalMatch = /^\/v1\/approvals\/([^/]+)$/.exec(path);
      if (approvalMatch && request.method === "POST") {
        requireScope(device, "approve");
        const body = await readJson(request);
        const result = await this.invokeRpc("permission.respond", {
          requestId: decodeURIComponent(approvalMatch[1]!),
          approved: body.approved === true,
          remember: body.remember === true
        });
        sendJson(response, 200, result);
        return;
      }
      const turnMatch = /^\/v1\/turns\/([^/]+)$/.exec(path);
      if (turnMatch && request.method === "GET") {
        const turn = await this.invokeRpc("turn.get", { turnId: decodeURIComponent(turnMatch[1]!) });
        sendJson(response, 200, turn);
        return;
      }
      if (path === "/v1/background" && request.method === "GET") {
        const jobs = await this.invokeRpc("background.list", { limit: Number(url.searchParams.get("limit") ?? "50") });
        sendJson(response, 200, jobs);
        return;
      }
      if (path === "/v1/scheduler" && request.method === "GET") {
        const jobs = await this.invokeRpc("scheduler.list", {});
        sendJson(response, 200, jobs);
        return;
      }
      if (path === "/v1/usage" && request.method === "GET") {
        const usage = await this.invokeRpc("usage.summary", {
          ...(url.searchParams.get("sessionId") ? { sessionId: url.searchParams.get("sessionId") } : {})
        });
        sendJson(response, 200, usage);
        return;
      }
      if (path === "/v1/chat/ensure" && request.method === "POST") {
        requireScope(device, "run");
        const session = await this.ensureSession(device, "web", "chat");
        sendJson(response, 200, session);
        return;
      }
      if (path.startsWith("/v1/artifacts/") && request.method === "GET") {
        const name = path.slice("/v1/artifacts/".length);
        const full = resolve(this.artifactsDir, name);
        if (!full.startsWith(resolve(this.artifactsDir) + sep)) {
          throw new RannError("E_PERMISSION", "Path artefak tidak valid");
        }
        if (!existsSync(full)) throw new RannError("E_NOT_FOUND", "Artefak tidak ditemukan");
        response.writeHead(200, {
          "content-type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream",
          "cache-control": "private, max-age=300"
        });
        response.end(readFileSync(full));
        return;
      }
      throw new RannError("E_NOT_FOUND", `Endpoint tidak ditemukan: ${path}`);
    } catch (error) {
      const err = toRannError(error);
      if (err.code === "E_PERMISSION" || err.code === "E_SCOPE") {
        try {
          appendAudit(this.db, {
            actor: "gateway",
            action: "authorize",
            resource: url.pathname,
            decision: "deny",
            metadata: {
              method: request.method ?? "GET",
              required_scope: typeof err.data?.scope === "string" ? err.data.scope : undefined
            }
          });
        } catch {
          // Audit tidak boleh menggagalkan respons otorisasi.
        }
      }
      if (!response.headersSent) sendError(response, err);
      else response.destroy();
    }
  }

  private cors(response: ServerResponse, request: IncomingMessage): void {
    const origin = request.headers.origin;
    const allowed = this.config.gateway.allow_origins;
    if (typeof origin === "string" && (allowed.length === 0 || allowed.includes(origin))) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "origin");
    }
    response.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("access-control-allow-headers", "authorization,content-type,x-filename");
  }

  private async handlePair(context: RequestContext): Promise<void> {
    const ip = clientIp(context.request);
    const now = Date.now();
    const current = this.attempts.get(ip);
    if (!current || current.resetAt <= now) {
      this.attempts.set(ip, { count: 1, resetAt: now + PAIR_WINDOW_MS });
    } else {
      if (current.count >= PAIR_LIMIT) {
        throw new RannError("E_RATE_LIMITED", "Terlalu banyak percobaan pairing, coba lagi nanti");
      }
      current.count += 1;
    }
    const body = await readJson(context.request);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "web";
    if (code.length !== 8) throw new RannError("E_INVALID_PARAMS", "Kode pairing harus 8 karakter");
    const result = redeemPairCode(this.db, {
      code,
      name: name || "web",
      profile: this.profile,
      role: "operator"
    });
    if ("error" in result) {
      throw new RannError("E_GATEWAY_AUTH", `Kode pairing ${result.error === "expired" ? "kedaluwarsa" : "tidak valid atau sudah dipakai"}`);
    }
    this.logger?.info(`perangkat baru dipasangkan: ${result.device.name}`);
    sendJson(context.response, 201, { token: result.token, device: result.device });
  }

  private async saveAttachment(request: IncomingMessage): Promise<Record<string, unknown>> {
    const filename = String(request.headers["x-filename"] ?? "lampiran").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const mime = String(request.headers["content-type"] ?? "application/octet-stream").split(";")[0]!;
    const bytes = await readBody(request, MAX_ATTACHMENT);
    if (bytes.length === 0) throw new RannError("E_INVALID_PARAMS", "Berkas kosong");
    const extension = extname(filename).toLowerCase() || (mime.startsWith("image/") ? `.${mime.slice(6).replace("jpeg", "jpg")}` : "");
    const allowed = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".txt", ".md", ".json", ".csv", ".ts", ".js", ".py"];
    if (extension && !allowed.includes(extension)) {
      throw new RannError("E_UNSUPPORTED", `Tipe lampiran ${extension} tidak didukung`);
    }
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    const stored = `${Date.now()}-${hash}${extension || ".bin"}`;
    writeFileSync(join(this.artifactsDir, stored), bytes, { mode: 0o600 });
    return {
      path: join(this.artifactsDir, stored),
      name: filename,
      size: bytes.length,
      mime,
      url: `/v1/artifacts/${encodeURIComponent(stored)}`
    };
  }

  private async ensureSession(
    device: GatewayDeviceView,
    channel: string,
    channelKey: string
  ): Promise<unknown> {
    const mapped = getMappedSession(this.db, device.id, channel, channelKey);
    if (mapped) {
      try {
        return await this.invokeRpc("session.get", { sessionId: mapped });
      } catch {
        // sesi lama hilang, buat pengganti
      }
    }
    const session = (await this.invokeRpc("session.create", {
      title: channel === "web" ? `Web ${device.name}` : `${channel} ${channelKey}`
    })) as { id: string };
    mapSession(this.db, { deviceId: device.id, sessionId: session.id, channel, channelKey });
    return session;
  }

  private async pageData(page: string, url?: URL): Promise<unknown> {
    if (page === "devices") return this.devices();
    if (page === "gateway") return { status: this.status(), stats: this.stats() };
    const params: Record<string, unknown> = {};
    if (url?.searchParams.get("sessionId")) params.sessionId = url.searchParams.get("sessionId");
    if (url?.searchParams.get("limit")) params.limit = Number(url.searchParams.get("limit"));
    return this.invokeRpc("dashboard.data", { page, ...params });
  }
}

export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const base = `v0:${timestamp}:${body}`;
  const expected = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  return safeEqual(expected, signature);
}
