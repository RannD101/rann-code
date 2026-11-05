import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { RannError } from "@rann/shared";
import { RpcClient } from "@rann/runtime";
import { resolveHome, resolveLayout } from "@rann/runtime";

export function packageVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function currentLayout() {
  return resolveLayout(resolveHome(), process.env.RANN_PROFILE ?? "default");
}

export async function tryConnect(): Promise<RpcClient | undefined> {
  try {
    return await RpcClient.connect(currentLayout().socketPath, 500);
  } catch {
    return undefined;
  }
}

export async function ensureDaemon(): Promise<RpcClient> {
  const existing = await tryConnect();
  if (existing) return existing;

  const layout = currentLayout();
  const daemonEntry = new URL("./daemon-main.js", import.meta.url);
  const child = spawn(process.execPath, [daemonEntry.pathname], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, RANN_HOME: layout.home, RANN_PROFILE: layout.profile }
  });
  child.unref();

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const client = await tryConnect();
    if (client) return client;
  }
  throw new RannError("E_DAEMON_DOWN", `Daemon gagal start. Cek log di ${layout.logsDir}`);
}
