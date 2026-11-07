import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Layout {
  home: string;
  profile: string;
  profileDir: string;
  dbPath: string;
  socketPath: string;
  pidPath: string;
  logsDir: string;
  runDir: string;
  artifactsDir: string;
  checkpointsDir: string;
  secretsDir: string;
  backupsDir: string;
}

const PRIVATE_DIR_MODE = 0o700;

function ensureDir(path: string, mode = PRIVATE_DIR_MODE): void {
  mkdirSync(path, { recursive: true, mode });
  try {
    chmodSync(path, mode);
  } catch {
    // chmod tidak selalu diizinkan di filesystem non-POSIX; abaikan.
  }
}

export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.RANN_HOME ?? join(homedir(), ".rann"));
}

export function resolveLayout(home = resolveHome(), profile = process.env.RANN_PROFILE ?? "default"): Layout {
  const profileDir = join(home, "profiles", profile);
  const runDir = join(home, "run");
  return {
    home,
    profile,
    profileDir,
    dbPath: join(profileDir, "rann.db"),
    socketPath: process.platform === "win32" ? `\\\\.\\pipe\\rann-${profile}` : join(runDir, "daemon.sock"),
    pidPath: join(runDir, "daemon.pid"),
    logsDir: join(profileDir, "logs"),
    runDir,
    artifactsDir: join(profileDir, "artifacts"),
    checkpointsDir: join(profileDir, "checkpoints"),
    secretsDir: join(profileDir, "secrets"),
    backupsDir: join(profileDir, "backups")
  };
}

export function ensureLayout(layout: Layout): void {
  ensureDir(layout.home);
  ensureDir(join(layout.home, "config"));
  ensureDir(join(layout.home, "profiles"));
  ensureDir(layout.profileDir);
  ensureDir(layout.runDir);
  ensureDir(layout.logsDir);
  ensureDir(layout.artifactsDir);
  ensureDir(layout.checkpointsDir);
  ensureDir(layout.secretsDir);
  ensureDir(layout.backupsDir);
}

export function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // abaikan
  }
}

export function readPid(layout: Layout): number | undefined {
  if (!existsSync(layout.pidPath)) return undefined;
  const raw = readFileSync(layout.pidPath, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

export function daemonAlive(layout: Layout): boolean {
  const pid = readPid(layout);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
