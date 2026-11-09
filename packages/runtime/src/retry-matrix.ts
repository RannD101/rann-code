import { RannError } from "@rann/shared";

/**
 * Matriks retry dari ARCHITECTURE 13.3. Semua jalur retry di runtime membaca
 * tabel ini supaya jumlah percobaan, backoff, dan jitter tidak berbeda-beda
 * antar subsistem.
 */
export type RetryTarget =
  | "provider.chat"
  | "provider.stream"
  | "tool.shell"
  | "tool.http"
  | "mcp.request"
  | "db.busy"
  | "gateway.request";

export type IdempotencyRule = "required" | "get-only" | "never" | "depends";

export interface RetryPolicy {
  target: RetryTarget;
  attempts: number;
  backoffMs: number[];
  jitterMs: number;
  idempotency: IdempotencyRule;
  retryableCodes: readonly string[];
}

const PROVIDER_RETRYABLE = ["E_PROVIDER_RATE_LIMIT", "E_PROVIDER_UNAVAILABLE", "E_TIMEOUT", "E_STREAM_TRUNCATED"] as const;

export const RETRY_MATRIX: Record<RetryTarget, RetryPolicy> = {
  "provider.chat": {
    target: "provider.chat",
    attempts: 3,
    backoffMs: [1_000, 2_000, 4_000],
    jitterMs: 250,
    idempotency: "required",
    retryableCodes: PROVIDER_RETRYABLE
  },
  "provider.stream": {
    target: "provider.stream",
    attempts: 2,
    backoffMs: [500],
    jitterMs: 100,
    idempotency: "required",
    retryableCodes: PROVIDER_RETRYABLE
  },
  "tool.shell": {
    target: "tool.shell",
    attempts: 1,
    backoffMs: [1_000],
    jitterMs: 0,
    idempotency: "never",
    retryableCodes: ["E_TOOL_TIMEOUT"]
  },
  "tool.http": {
    target: "tool.http",
    attempts: 3,
    backoffMs: [500, 1_000],
    jitterMs: 100,
    idempotency: "get-only",
    retryableCodes: [...PROVIDER_RETRYABLE, "E_TOOL_TIMEOUT"]
  },
  "mcp.request": {
    target: "mcp.request",
    attempts: 2,
    backoffMs: [1_000],
    jitterMs: 100,
    idempotency: "depends",
    retryableCodes: ["E_TIMEOUT", "E_PROVIDER_UNAVAILABLE"]
  },
  "db.busy": {
    target: "db.busy",
    attempts: 5,
    backoffMs: [50, 100, 200, 400, 800],
    jitterMs: 25,
    idempotency: "required",
    retryableCodes: ["SQLITE_BUSY", "SQLITE_LOCKED", "E_STATE_CONFLICT"]
  },
  "gateway.request": {
    target: "gateway.request",
    attempts: 2,
    backoffMs: [100],
    jitterMs: 0,
    idempotency: "required",
    retryableCodes: ["E_PROVIDER_UNAVAILABLE", "E_TIMEOUT"]
  }
};

export function retryPolicy(target: RetryTarget): RetryPolicy {
  return RETRY_MATRIX[target];
}

export interface RetryDecisionInput {
  attempt: number;
  error: unknown;
  /** Dipakai untuk aturan `get-only` dan `depends`. */
  idempotent?: boolean;
  method?: string;
  signal?: AbortSignal;
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof RannError) return error.code;
  const candidate = error as { code?: unknown; message?: unknown } | undefined;
  if (candidate && typeof candidate.code === "string") return candidate.code;
  if (candidate && typeof candidate.message === "string" && /SQLITE_BUSY|SQLITE_LOCKED/.test(candidate.message)) {
    return /SQLITE_LOCKED/.test(candidate.message) ? "SQLITE_LOCKED" : "SQLITE_BUSY";
  }
  return undefined;
}

export function canRetry(target: RetryTarget, input: RetryDecisionInput): boolean {
  const policy = retryPolicy(target);
  if (input.signal?.aborted) return false;
  if (input.attempt >= policy.attempts) return false;
  const code = errorCode(input.error);
  if (code === undefined || !policy.retryableCodes.includes(code)) return false;
  if (policy.idempotency === "never") return false;
  if (policy.idempotency === "get-only") {
    const method = (input.method ?? "GET").toUpperCase();
    return method === "GET" || method === "HEAD";
  }
  if (policy.idempotency === "depends") return input.idempotent === true;
  return true;
}

export function retryDelay(
  target: RetryTarget,
  attempt: number,
  retryAfterMs?: number,
  random: () => number = Math.random
): number {
  const policy = retryPolicy(target);
  if (retryAfterMs !== undefined && retryAfterMs > 0) return Math.min(retryAfterMs, 60_000);
  const base = policy.backoffMs[attempt - 1] ?? policy.backoffMs[policy.backoffMs.length - 1] ?? 1_000;
  const jitter = policy.jitterMs > 0 ? Math.floor(random() * (policy.jitterMs + 1)) : 0;
  return base + jitter;
}

export interface AttemptRecord {
  target: RetryTarget;
  attempt: number;
  code: string;
  message: string;
}

export function describeAttempts(attempts: AttemptRecord[]): string {
  return attempts.map((entry) => `${entry.target}#${entry.attempt}:${entry.code}`).join(" -> ");
}
