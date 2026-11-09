import { RannError } from "@rann/shared";
import type { ProviderHealthProbe, ProviderModelInfo } from "./types.js";

export interface JsonRequestOptions {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  label: string;
}

export interface JsonResponse<T> {
  data: T;
  requestId?: string;
  status: number;
}

/**
 * Request JSON dengan timeout sendiri. Adapter memakai ini untuk method
 * pendukung (listModels, embed, health) supaya tidak menggandakan penanganan
 * error yang berbeda-beda di setiap provider.
 */
export async function requestJson<T>(options: JsonRequestOptions): Promise<JsonResponse<T>> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onAbort = (): void => controller.abort(new Error("aborted"));
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(options.url, {
        method: options.method ?? "GET",
        headers: { accept: "application/json", ...options.headers },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason as Error | undefined;
        if (reason?.message === "timeout") {
          throw new RannError("E_TIMEOUT", `${options.label} melewati ${timeoutMs} ms`);
        }
        throw new RannError("E_CANCELLED", `${options.label} dibatalkan`);
      }
      throw new RannError("E_PROVIDER_UNAVAILABLE", `Gagal menghubungi ${options.label}: ${(error as Error).message}`, {
        cause: error
      });
    }
    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      const code = response.status === 401 || response.status === 403
        ? "E_PROVIDER_AUTH"
        : response.status === 429
          ? "E_PROVIDER_RATE_LIMIT"
          : "E_PROVIDER_UNAVAILABLE";
      let detail = raw.slice(0, 300);
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } | string };
        const message = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
        if (message) detail = message;
      } catch {
        // biarkan teks mentah
      }
      throw new RannError(code, `${options.label} membalas ${response.status}: ${detail}`, {
        data: { status: response.status }
      });
    }
    let data: T;
    try {
      data = JSON.parse(raw) as T;
    } catch (error) {
      throw new RannError("E_PROVIDER_UNAVAILABLE", `${options.label} membalas JSON tidak valid`, { cause: error });
    }
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
    return { data, status: response.status, ...(requestId ? { requestId } : {}) };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Probe kesehatan memakai endpoint daftar model karena itu endpoint termurah
 * yang hampir selalu tersedia di semua provider.
 */
export async function probeHealth(
  url: string,
  headers: Record<string, string>,
  label: string,
  timeoutMs = 10_000,
  signal?: AbortSignal
): Promise<ProviderHealthProbe> {
  const started = Date.now();
  try {
    const result = await requestJson<unknown>({ url, headers, label, timeoutMs, ...(signal ? { signal } : {}) });
    const latencyMs = Date.now() - started;
    return { ok: true, latencyMs, status: result.status >= 400 ? "degraded" : "healthy" };
  } catch (error) {
    const latencyMs = Date.now() - started;
    return {
      ok: false,
      latencyMs,
      status: "down",
      error: error instanceof RannError ? `${error.code}: ${error.message}` : (error as Error).message
    };
  }
}

export function normalizeModelInfo(entry: {
  id?: string;
  name?: string;
  display_name?: string;
  displayName?: string;
  context_window?: number;
  contextWindow?: number;
  input_token_limit?: number;
  max_output_tokens?: number;
  maxOutputTokens?: number;
  output_token_limit?: number;
  capabilities?: Record<string, boolean>;
}): ProviderModelInfo | undefined {
  const id = entry.id ?? entry.name;
  if (!id) return undefined;
  const contextWindow = entry.context_window ?? entry.contextWindow ?? entry.input_token_limit;
  const maxOutputTokens = entry.max_output_tokens ?? entry.maxOutputTokens ?? entry.output_token_limit;
  return {
    id,
    ...(entry.display_name || entry.displayName ? { displayName: entry.display_name ?? entry.displayName } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(entry.capabilities ? { capabilities: entry.capabilities } : {})
  };
}
