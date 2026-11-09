import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { RannError } from "@rann/shared";
import type { ToolSpec } from "./providers/types.js";

export interface McpServerConfig {
  transport?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  oauth?: {
    token_url: string;
    client_id: string;
    client_secret_env?: string;
    scope?: string;
    device_authorization_url?: string;
  };
  permission?: "read" | "write" | "exec";
  enabled: boolean;
  timeout_ms: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  cleanup?: () => void;
}

interface ServerState {
  name: string;
  config: McpServerConfig;
  process?: ChildProcessWithoutNullStreams;
  sessionId?: string;
  buffer: string;
  nextId: number;
  pending: Map<number, PendingRequest>;
  stderr: string;
  initialized: boolean;
}

interface ToolRoute {
  server: string;
  tool: string;
}

const MAX_BUFFER = 8 * 1024 * 1024;
const MAX_STDERR = 8_000;

function sanitize(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 48) : "tool";
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : JSON.stringify(content);
  const parts: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    if (entry.type === "text" && typeof entry.text === "string") parts.push(entry.text);
    else if (entry.type === "resource" && typeof entry.resource === "object" && entry.resource !== null) {
      const resource = entry.resource as Record<string, unknown>;
      if (typeof resource.text === "string") parts.push(resource.text);
    } else if (entry.type === "image") parts.push("[gambar MCP tidak ditampilkan]");
  }
  return parts.join("\n");
}


/**
 * OAuth 2.0 untuk MCP: device authorization grant (RFC 8628) bila
 * `device_authorization_url` diisi, jika tidak client credentials.
 */
export async function fetchOAuthToken(
  name: string,
  config: NonNullable<McpServerConfig["oauth"]>,
  options: {
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    onDeviceCode?: (input: { userCode: string; verificationUri: string; expiresIn: number }) => void;
  } = {}
): Promise<string> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const post = async (url: string, body: URLSearchParams): Promise<Record<string, unknown>> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      ...(options.signal ? { signal: options.signal } : {})
    });
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok && parsed.error === undefined) throw new Error(`MCP ${name}: OAuth gagal ${response.status}`);
    return parsed;
  };

  if (config.device_authorization_url) {
    const device = await post(
      config.device_authorization_url,
      new URLSearchParams({ client_id: config.client_id, ...(config.scope ? { scope: config.scope } : {}) })
    );
    const deviceCode = typeof device.device_code === "string" ? device.device_code : "";
    if (!deviceCode) throw new Error(`MCP ${name}: device authorization tidak mengembalikan device_code`);
    const expiresIn = typeof device.expires_in === "number" ? device.expires_in : 600;
    let interval = Math.max(1, typeof device.interval === "number" ? device.interval : 5);
    options.onDeviceCode?.({
      userCode: String(device.user_code ?? ""),
      verificationUri: String(device.verification_uri ?? device.verification_url ?? ""),
      expiresIn
    });
    const deadline = Date.now() + expiresIn * 1000;
    while (Date.now() < deadline) {
      await sleep(interval * 1000);
      const token = await post(
        config.token_url,
        new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: config.client_id
        })
      );
      if (typeof token.access_token === "string") return token.access_token;
      if (token.error === "authorization_pending") continue;
      if (token.error === "slow_down") {
        interval += 5;
        continue;
      }
      throw new Error(`MCP ${name}: device flow gagal: ${String(token.error ?? "tanpa access_token")}`);
    }
    throw new Error(`MCP ${name}: device flow melewati batas waktu`);
  }

  const secret = config.client_secret_env ? process.env[config.client_secret_env] : undefined;
  if (!secret) throw new Error(`MCP ${name}: env ${config.client_secret_env ?? "<kosong>"} kosong untuk OAuth`);
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: config.client_id, client_secret: secret });
  if (config.scope) body.set("scope", config.scope);
  const token = await post(config.token_url, body);
  if (typeof token.access_token !== "string") throw new Error(`MCP ${name}: OAuth tidak mengembalikan access_token`);
  return token.access_token;
}

export class McpManager {
  private readonly states = new Map<string, ServerState>();
  private readonly routes = new Map<string, ToolRoute>();
  private cachedSpecs: ToolSpec[] | undefined;
  private loading: Promise<ToolSpec[]> | undefined;

  constructor(
    private readonly servers: Record<string, McpServerConfig>,
    private readonly version = "0.1.0",
    private readonly secrets?: { set(name: string, value: string, provider?: string): unknown }
  ) {}

  permissionFor(name: string): "read" | "write" | "exec" {
    const server = name.replace(/^mcp__/, "").split("__")[0] ?? "";
    return this.servers[server]?.permission ?? "exec";
  }

  async listTools(): Promise<ToolSpec[]> {
    if (this.cachedSpecs) return this.cachedSpecs;
    if (this.loading) return this.loading;
    this.loading = this.loadTools().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async loadTools(): Promise<ToolSpec[]> {
    const specs: ToolSpec[] = [];
    this.routes.clear();
    for (const [name, config] of Object.entries(this.servers)) {
      if (!config.enabled) continue;
      const prefix = `mcp__${sanitize(name)}__`;
      try {
        const state = await this.start(name, config);
        const result = (await this.request(state, "tools/list", {})) as { tools?: unknown };
        const tools = Array.isArray(result.tools) ? result.tools : [];
        for (const raw of tools) {
          if (typeof raw !== "object" || raw === null) continue;
          const tool = raw as Record<string, unknown>;
          if (typeof tool.name !== "string" || tool.name.length === 0) continue;
          const fullName = `${prefix}${sanitize(tool.name)}`;
          this.routes.set(fullName, { server: name, tool: tool.name });
          specs.push({
            name: fullName,
            description: `[MCP ${name}] ${typeof tool.description === "string" ? tool.description : tool.name}`,
            parameters:
              typeof tool.inputSchema === "object" && tool.inputSchema !== null
                ? (tool.inputSchema as Record<string, unknown>)
                : { type: "object", properties: {} }
          });
        }
      } catch (error) {
        const state = this.states.get(name);
        const detail = state?.stderr.trim().slice(-800);
        this.states.get(name)?.process?.kill("SIGKILL");
        this.states.delete(name);
        throw new RannError(
          "E_TOOL_FAILED",
          `MCP server ${name} gagal dimuat: ${(error as Error).message}${detail ? ` (${detail})` : ""}`
        );
      }
    }
    this.cachedSpecs = specs;
    return specs;
  }

  private async start(name: string, config: McpServerConfig): Promise<ServerState> {
    const existing = this.states.get(name);
    if (existing) return existing;
    const transport = config.transport ?? (config.url ? "http" : "stdio");
    if (transport !== "stdio") return this.startHttp(name, config, transport);
    if (!config.command) throw new Error(`MCP ${name}: command wajib untuk transport stdio`);
    const baseEnv: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]) {
      const value = process.env[key];
      if (value !== undefined) baseEnv[key] = value;
    }
    const extraEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env ?? {})) {
      const name = value.startsWith("env:") ? value.slice(4) : "";
      const resolved = name ? process.env[name] : value;
      if (resolved !== undefined) extraEnv[key] = resolved;
    }
    const child = spawn(config.command, config.args ?? [], {
      cwd: resolve(config.cwd ?? process.cwd()),
      env: { ...baseEnv, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const state: ServerState = {
      name,
      config,
      process: child,
      buffer: "",
      nextId: 1,
      pending: new Map(),
      stderr: "",
      initialized: false
    };
    this.states.set(name, state);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      state.stderr = (state.stderr + chunk).slice(-MAX_STDERR);
    });
    child.stdout.on("data", (chunk: string) => this.onData(state, chunk));
    child.on("error", (error) => this.failState(state, error));
    child.on("exit", (code, signal) => {
      this.failState(state, new Error(`proses berhenti (${signal ?? code ?? "tanpa kode"})`));
      if (this.states.get(name) === state) this.states.delete(name);
      this.cachedSpecs = undefined;
    });

    await this.initialize(state);
    return state;
  }

  private async startHttp(name: string, config: McpServerConfig, transport: "http" | "sse"): Promise<ServerState> {
    if (!config.url || !/^https?:\/\//i.test(config.url)) throw new Error(`MCP ${name}: URL http(s) wajib untuk transport ${transport}`);
    const state: ServerState = {
      name,
      config: { ...config, transport },
      buffer: "",
      nextId: 1,
      pending: new Map(),
      stderr: "",
      initialized: false
    };
    this.states.set(name, state);
    if (config.oauth) {
      const accessToken = await fetchOAuthToken(name, config.oauth);
      this.secrets?.set(`mcp-${name}`, accessToken, "mcp");
      state.config.headers = { ...(state.config.headers ?? {}), authorization: `Bearer ${accessToken}` };
    }
    await this.initializeHttp(state);
    return state;
  }

  private httpHeaders(state: ServerState): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...Object.fromEntries(Object.entries(state.config.headers ?? {}).map(([key, value]) => {
        const name = value.startsWith("env:") ? value.slice(4) : "";
        return [key, name ? (process.env[name] ?? "") : value];
      })),
      ...(state.sessionId ? { "mcp-session-id": state.sessionId } : {})
    };
  }

  private async parseHttpResponse(response: Response, method: string): Promise<Record<string, unknown>> {
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok) throw new Error(`HTTP ${response.status} untuk ${method}`);
    if (type.includes("text/event-stream")) {
      const text = await response.text();
      for (const block of text.split(/\n\n/)) {
        const data = block.split(/\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
        if (!data) continue;
        const parsed = parseJsonLine(data);
        if (parsed && ("result" in parsed || "error" in parsed)) return parsed;
      }
      throw new Error(`respons SSE ${method} tidak memuat hasil`);
    }
    const parsed = (await response.json()) as unknown;
    const envelope = Array.isArray(parsed) ? parsed[0] : parsed;
    if (typeof envelope !== "object" || envelope === null) throw new Error(`respons ${method} bukan objek JSON`);
    return envelope as Record<string, unknown>;
  }

  private async httpRequest(state: ServerState, method: string, params: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), state.config.timeout_ms);
    try {
      const response = await fetch(state.config.url as string, {
        method: "POST",
        headers: this.httpHeaders(state),
        body: JSON.stringify({ jsonrpc: "2.0", id: state.nextId++, method, params }),
        signal: controller.signal
      });
      const session = response.headers.get("mcp-session-id");
      if (session) state.sessionId = session;
      const message = await this.parseHttpResponse(response, method);
      if (message.error) throw new Error(String((message.error as Record<string, unknown>).message ?? "MCP error"));
      return message.result;
    } catch (error) {
      if ((error as Error).name === "AbortError") throw new Error(`MCP ${state.name} timeout ${state.config.timeout_ms} ms untuk ${method}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async notifyHttp(state: ServerState, method: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), state.config.timeout_ms);
    try {
      await fetch(state.config.url as string, {
        method: "POST",
        headers: this.httpHeaders(state),
        body: JSON.stringify({ jsonrpc: "2.0", method, params: {} }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async initializeHttp(state: ServerState): Promise<void> {
    if (state.initialized) return;
    const result = (await this.httpRequest(state, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "rann-code", version: this.version }
    })) as Record<string, unknown> | undefined;
    const session = (result as Record<string, unknown> | undefined)?.sessionId;
    if (typeof session === "string") state.sessionId = session;
    await this.notifyHttp(state, "notifications/initialized");
    state.initialized = true;
  }

  private onData(state: ServerState, chunk: string): void {
    state.buffer += chunk;
    if (state.buffer.length > MAX_BUFFER) {
      this.failState(state, new Error("output MCP melebihi 8 MB"));
      state.process?.kill("SIGKILL");
      return;
    }
    let index = state.buffer.indexOf("\n");
    while (index >= 0) {
      const line = state.buffer.slice(0, index).trim();
      state.buffer = state.buffer.slice(index + 1);
      if (line.length > 0) this.onMessage(state, line);
      index = state.buffer.indexOf("\n");
    }
  }

  private onMessage(state: ServerState, line: string): void {
    const message = parseJsonLine(line);
    if (!message) return;
    const id = typeof message.id === "number" ? message.id : undefined;
    if (id === undefined) return;
    if (message.method && !("result" in message) && !("error" in message)) {
      state.process?.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }) + "\n");
      return;
    }
    const pending = state.pending.get(id);
    if (!pending) return;
    state.pending.delete(id);
    clearTimeout(pending.timer);
    pending.cleanup?.();
    if (message.error) {
      pending.reject(new Error(String((message.error as Record<string, unknown>).message ?? "MCP error")));
      return;
    }
    pending.resolve(message.result);
  }

  private failState(state: ServerState, error: Error): void {
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
    }
    state.pending.clear();
  }

  private request(state: ServerState, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!state.process) return this.httpRequest(state, method, params);
    const id = state.nextId++;
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        rejectPromise(new Error(`MCP ${state.name} timeout ${state.config.timeout_ms} ms untuk ${method}`));
      }, state.config.timeout_ms);
      state.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      state.process?.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private async initialize(state: ServerState): Promise<void> {
    if (state.initialized) return;
    await this.request(state, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "rann-code", version: this.version }
    });
    state.process?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    state.initialized = true;
  }

  async listResources(name?: string): Promise<Record<string, unknown>> {
    const output: Record<string, unknown> = {};
    for (const [server, config] of Object.entries(this.servers)) {
      if (!config.enabled || (name && server !== name)) continue;
      const state = await this.start(server, config);
      await this.initialize(state);
      output[server] = await this.request(state, "resources/list", {});
    }
    return output;
  }

  async listPrompts(name?: string): Promise<Record<string, unknown>> {
    const output: Record<string, unknown> = {};
    for (const [server, config] of Object.entries(this.servers)) {
      if (!config.enabled || (name && server !== name)) continue;
      const state = await this.start(server, config);
      await this.initialize(state);
      output[server] = await this.request(state, "prompts/list", {});
    }
    return output;
  }

  async callTool(fullName: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.routes.has(fullName)) await this.listTools();
    const route = this.routes.get(fullName);
    if (!route) throw new RannError("E_TOOL_NOT_FOUND", `Tool MCP tidak dikenal: ${fullName}`);
    const state = this.states.get(route.server);
    if (!state) throw new RannError("E_TOOL_FAILED", `MCP server ${route.server} tidak aktif`);
    if (signal?.aborted) throw new RannError("E_CANCELLED", "Panggilan MCP dibatalkan");

    const result = (await this.request(state, "tools/call", {
      name: route.tool,
      arguments: typeof args === "object" && args !== null ? args : {}
    })) as Record<string, unknown>;
    const text = textFromContent(result.content);
    if (result.isError === true) {
      throw new RannError("E_TOOL_FAILED", text.slice(0, 4_000) || `Tool MCP ${route.tool} melaporkan error`);
    }
    return {
      server: route.server,
      tool: route.tool,
      content: text,
      structured: result.structuredContent ?? null
    };
  }

  async close(): Promise<void> {
    for (const state of this.states.values()) {
      this.failState(state, new Error("MCP ditutup"));
      state.process?.kill("SIGKILL");
    }
    this.states.clear();
    this.routes.clear();
    this.cachedSpecs = undefined;
  }
}
