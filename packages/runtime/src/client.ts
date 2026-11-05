import { connect, type Socket } from "node:net";
import { RannError, type EventEnvelope, type RpcResponse } from "@rann/shared";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class RpcClient {
  private readonly pending = new Map<string | number, Pending>();
  private readonly listeners = new Set<(event: EventEnvelope) => void>();
  private readonly closeListeners = new Set<() => void>();
  private nextId = 1;
  private buffer = "";
  private closed = false;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("close", () => this.failAll(new RannError("E_DAEMON_DOWN", "Koneksi ke daemon terputus")));
    socket.on("error", (error) => this.failAll(new RannError("E_DAEMON_DOWN", `Koneksi daemon error: ${error.message}`, { cause: error })));
  }

  static async connect(socketPath: string, timeoutMs = 5_000): Promise<RpcClient> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const connection = connect(socketPath);
      const timer = setTimeout(() => {
        connection.destroy();
        reject(new RannError("E_DAEMON_DOWN", `Daemon tidak merespons di ${socketPath}`));
      }, timeoutMs);
      connection.once("connect", () => {
        clearTimeout(timer);
        resolve(connection);
      });
      connection.once("error", (error) => {
        clearTimeout(timer);
        reject(new RannError("E_DAEMON_DOWN", `Daemon tidak bisa dihubungi: ${error.message}`, { cause: error }));
      });
    });
    return new RpcClient(socket);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length > 0) this.dispatch(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private dispatch(line: string): void {
    let message: RpcResponse | { jsonrpc: "2.0"; method: "event"; params: EventEnvelope };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if ("method" in message && message.method === "event") {
      for (const listener of this.listeners) listener(message.params);
      return;
    }
    const response = message as RpcResponse;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if ("error" in response) {
      pending.reject(new RannError(response.error.code as never, response.error.message, { data: response.error.data }));
    } else {
      pending.resolve(response.result);
    }
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new RannError("E_DAEMON_DOWN", "Klien sudah ditutup"));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RannError("E_TIMEOUT", `Permintaan ${method} melewati ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.write(payload);
    });
  }

  onEvent(listener: (event: EventEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.end();
    this.socket.destroy();
  }
}
