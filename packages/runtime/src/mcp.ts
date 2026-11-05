import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { RannError } from "@rann/shared";
import type { ToolSpec } from "./providers/types.js";

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
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
  process: ChildProcessWithoutNullStreams;
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

export class McpManager {
  private readonly states = new Map<string, ServerState>();
  private readonly routes = new Map<string, ToolRoute>();
  private cachedSpecs: ToolSpec[] | undefined;
  private loading: Promise<ToolSpec[]> | undefined;

  constructor(
    private readonly servers: Record<string, McpServerConfig>,
    private readonly version = "0.1.0"
  ) {}

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
        this.states.get(name)?.process.kill("SIGKILL");
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
    const child = spawn(config.command, config.args, {
      cwd: resolve(config.cwd ?? process.cwd()),
      env: { ...process.env, ...config.env },
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

  private onData(state: ServerState, chunk: string): void {
    state.buffer += chunk;
    if (state.buffer.length > MAX_BUFFER) {
      this.failState(state, new Error("output MCP melebihi 8 MB"));
      state.process.kill("SIGKILL");
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
      state.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }) + "\n");
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
    const id = state.nextId++;
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        rejectPromise(new Error(`MCP ${state.name} timeout ${state.config.timeout_ms} ms untuk ${method}`));
      }, state.config.timeout_ms);
      state.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      state.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  private async initialize(state: ServerState): Promise<void> {
    if (state.initialized) return;
    await this.request(state, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "rann-code", version: this.version }
    });
    state.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
    state.initialized = true;
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
      state.process.kill("SIGKILL");
    }
    this.states.clear();
    this.routes.clear();
    this.cachedSpecs = undefined;
  }
}
