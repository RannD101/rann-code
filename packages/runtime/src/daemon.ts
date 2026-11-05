import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, RannError } from "@rann/shared";
import { RpcServer } from "./rpc.js";
import { daemonAlive, ensureLayout, readPid, resolveLayout, resolveHome, type Layout } from "./paths.js";

export interface DaemonOptions {
  home?: string;
  profile?: string;
  version: string;
}

export interface RunningDaemon {
  layout: Layout;
  server: RpcServer;
  stop: () => Promise<void>;
}

const DEFAULT_CONFIG = `# Konfigurasi global Rann Code
profile = "default"
provider = "mock"

[model]
default = "mock-1"

[permissions]
mode = "ask"
workspace_only = true

[agent]
max_steps = 24
`;

export function ensureDefaultConfig(layout: Layout): void {
  const path = join(layout.home, "config", "config.toml");
  if (existsSync(path)) return;
  writeFileSync(path, DEFAULT_CONFIG, { mode: 0o600 });
}

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const layout = resolveLayout(options.home ?? resolveHome(), options.profile ?? process.env.RANN_PROFILE ?? "default");
  ensureLayout(layout);
  ensureDefaultConfig(layout);

  if (daemonAlive(layout)) {
    throw new RannError("E_CONFLICT", `Daemon sudah berjalan dengan pid ${readPid(layout)}`, { data: { pid: readPid(layout) } });
  }

  const config = loadConfig({ home: layout.home });
  const state: { server?: RpcServer } = {};
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await state.server?.close();
    const pidPath = layout.pidPath;
    if (existsSync(pidPath)) {
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(pidPath);
      } catch {
        // abaikan
      }
    }
  };

  const server = new RpcServer({ layout, config, version: options.version, shutdown: () => void shutdown() });
  state.server = server;
  await server.listen();
  writeFileSync(layout.pidPath, `${process.pid}\n`, { mode: 0o600 });

  const onSignal = (): void => {
    void shutdown().then(() => process.exit(0));
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  return { layout, server, stop: shutdown };
}

export async function stopDaemon(options: { home?: string; timeoutMs?: number } = {}): Promise<{ stopped: boolean; pid?: number }> {
  const layout = resolveLayout(options.home ?? resolveHome());
  const pid = readPid(layout);
  if (!pid || !daemonAlive(layout)) return { stopped: false };
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { stopped: false, pid };
  }
  const deadline = Date.now() + (options.timeoutMs ?? 3_000);
  while (Date.now() < deadline) {
    if (!daemonAlive(layout)) return { stopped: true, pid };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { stopped: !daemonAlive(layout), pid };
}
