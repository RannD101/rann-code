import { execFile } from "node:child_process";
import { RannError } from "@rann/shared";

export interface GitOutput {
  code: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

const MAX_GIT_OUTPUT = 200_000;
const SENSITIVE_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || SENSITIVE_ENV.test(name)) continue;
    env[name] = value;
  }
  return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", PAGER: "cat" };
}

export function runGit(cwd: string, args: string[], options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<GitOutput> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      "git",
      ["--no-pager", ...args],
      {
        cwd,
        env: gitEnv(),
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: 10 * 1024 * 1024,
        ...(options.signal ? { signal: options.signal } : {})
      },
      (error, stdout, stderr) => {
        if (error && typeof (error as NodeJS.ErrnoException).code === "string") {
          rejectPromise(new RannError("E_TOOL_FAILED", `Git gagal dijalankan: ${error.message}`));
          return;
        }
        const out = stdout.toString();
        const err = stderr.toString();
        const code = error ? Number((error as { code?: number }).code ?? 1) : 0;
        const truncatedOut = out.length > MAX_GIT_OUTPUT;
        const truncatedErr = err.length > MAX_GIT_OUTPUT;
        resolvePromise({
          code,
          stdout: truncatedOut ? out.slice(0, MAX_GIT_OUTPUT) : out,
          stderr: truncatedErr ? err.slice(0, MAX_GIT_OUTPUT) : err,
          truncated: truncatedOut || truncatedErr
        });
      }
    );
  });
}

export function safeGitPath(path: string): string {
  if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) {
    throw new RannError("E_TOOL_FAILED", `Path git harus relatif dan tanpa ..: ${path}`);
  }
  return path;
}

export function commitMessage(message: string, sessionId?: string): string[] {
  const body = message.trim();
  if (body.length === 0) throw new RannError("E_TOOL_INVALID_ARGS", "Pesan commit kosong");
  return sessionId ? ["-m", body, "-m", `Rann-Code-Session: ${sessionId}`] : ["-m", body];
}
