import { RannError } from "@rann/shared";
import { canRetry, retryDelay, type RetryTarget } from "../retry-matrix.js";

export type HealthStatus = "healthy" | "degraded" | "rate_limited" | "auth_error" | "down" | "unknown";

export interface ProviderHealth {
  status: HealthStatus;
  failures: number;
  lastError?: string;
  lastCheckedAt: number;
  retryAfterMs?: number;
  openUntil?: number;
  latencyMs?: number;
}

const FAILURE_WINDOW_MS = 60_000;
const CIRCUIT_OPEN_MS = 30_000;
const MAX_FAILURES = 5;

export class HealthRegistry {
  private readonly states = new Map<string, ProviderHealth>();

  get(name: string): ProviderHealth {
    return this.states.get(name) ?? { status: "unknown", failures: 0, lastCheckedAt: 0 };
  }

  snapshot(): Record<string, ProviderHealth> {
    return Object.fromEntries(this.states);
  }

  isOpen(name: string): boolean {
    const state = this.get(name);
    return state.openUntil !== undefined && state.openUntil > Date.now();
  }

  retryAfter(name: string): number {
    const state = this.get(name);
    if (state.retryAfterMs === undefined) return 0;
    return Math.max(0, state.lastCheckedAt + state.retryAfterMs - Date.now());
  }

  isCoolingDown(name: string): boolean {
    return this.isOpen(name) || this.retryAfter(name) > 0;
  }

  recordSuccess(name: string, latencyMs?: number): void {
    this.states.set(name, {
      status: "healthy",
      failures: 0,
      lastCheckedAt: Date.now(),
      ...(latencyMs !== undefined ? { latencyMs } : {})
    });
  }

  recordProbe(name: string, ok: boolean, latencyMs: number, error?: RannError): void {
    if (ok) {
      this.recordSuccess(name, latencyMs);
      return;
    }
    const failed = error ?? new RannError("E_PROVIDER_UNAVAILABLE", "Health probe gagal");
    this.recordFailure(name, failed);
    const current = this.get(name);
    this.states.set(name, { ...current, latencyMs });
  }

  recordFailure(name: string, error: RannError): void {
    const now = Date.now();
    const previous = this.get(name);
    const failures = previous.failures + 1;
    const status: HealthStatus =
      error.code === "E_PROVIDER_RATE_LIMIT"
        ? "rate_limited"
        : error.code === "E_PROVIDER_AUTH"
          ? "auth_error"
          : failures >= 2
            ? "down"
            : "degraded";
    const data = (error.data ?? {}) as Record<string, unknown>;
    const retryAfterMs = typeof data.retryAfterMs === "number" ? data.retryAfterMs : undefined;
    const windowStart = previous.lastCheckedAt > now - FAILURE_WINDOW_MS ? previous.failures : 0;
    const counted = windowStart + 1;
    this.states.set(name, {
      status,
      failures: counted,
      lastError: error.message,
      lastCheckedAt: now,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      ...(counted >= MAX_FAILURES ? { openUntil: now + CIRCUIT_OPEN_MS } : {})
    });
  }
}

export const providerHealth = new HealthRegistry();

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof RannError)) return false;
  return canRetry("provider.chat", { attempt: 1, error });
}

export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  return retryDelay("provider.chat", attempt, retryAfterMs);
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new RannError("E_CANCELLED", "Dibatalkan saat menunggu retry"));
      },
      { once: true }
    );
  });
}

export interface RetryOptions {
  attempts?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: RannError, delayMs: number) => void;
  /** Default `provider.chat`; jalur streaming memakai `provider.stream`. */
  target?: RetryTarget;
}

export async function* retryStream<T>(
  factory: () => AsyncIterable<T>,
  options: RetryOptions = {}
): AsyncGenerator<T, void, unknown> {
  const target = options.target ?? "provider.chat";
  const attempts = options.attempts ?? (target === "provider.stream" ? 2 : 3);
  let emitted = false;
  let lastError: RannError | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      for await (const item of factory()) {
        emitted = true;
        yield item;
      }
      return;
    } catch (error) {
      const err = error instanceof RannError ? error : new RannError("E_PROVIDER_UNAVAILABLE", (error as Error).message);
      if (emitted) throw err;
      if (!canRetry(target, { attempt, error: err, ...(options.signal ? { signal: options.signal } : {}) })) throw err;
      lastError = err;
      const data = (err.data ?? {}) as Record<string, unknown>;
      const delay = retryDelay(target, attempt, typeof data.retryAfterMs === "number" ? data.retryAfterMs : undefined);
      options.onRetry?.(attempt, err, delay);
      await sleep(delay, options.signal);
    }
  }
  // `attempts` bisa lebih kecil dari jatah kebijakan target (misalnya kandidat
  // fallback hanya boleh satu percobaan). Tanpa throw di sini, stream yang gagal
  // akan terlihat selesai tanpa teks.
  if (lastError) throw lastError;
}
