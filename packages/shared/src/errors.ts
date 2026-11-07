export const ERROR_CODES = [
  "E_INVALID_PARAMS",
  "E_METHOD_NOT_FOUND",
  "E_NOT_FOUND",
  "E_SESSION_NOT_FOUND",
  "E_TURN_NOT_FOUND",
  "E_CONFIG_INVALID",
  "E_PERMISSION",
  "E_APPROVAL_REQUIRED",
  "E_SANDBOX",
  "E_CONFLICT",
  "E_PROVIDER_AUTH",
  "E_PROVIDER_RATE_LIMIT",
  "E_PROVIDER_UNAVAILABLE",
  "E_PROVIDER_CAPABILITY",
  "E_CONTEXT_OVERFLOW",
  "E_STREAM_TRUNCATED",
  "E_PLAN_INVALID",
  "E_PLAN_BLOCKED",
  "E_PLAN_REQUIRED_APPROVAL",
  "E_VERIFICATION_FAILED",
  "E_TOOL_TIMEOUT",
  "E_TOOL_FAILED",
  "E_FILE_CHANGED",
  "E_LEASE_CONFLICT",
  "E_GOAL_INCOMPLETE",
  "E_NO_PROGRESS",
  "E_TOOL_NOT_FOUND",
  "E_TOOL_INVALID_ARGS",
  "E_BUDGET_EXHAUSTED",
  "E_DB",
  "E_DAEMON_DOWN",
  "E_GATEWAY_AUTH",
  "E_RATE_LIMITED",
  "E_INPUT_TOO_LARGE",
  "E_RECOVERY_FAILED",
  "E_RUNTIME_EXCEEDED",
  "E_JOB_FAILED",
  "E_CANCELLED",
  "E_TIMEOUT",
  "E_STORAGE",
  "E_UNSUPPORTED",
  "E_INTERNAL"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const EXIT_CODES: Record<ErrorCode, number> = {
  E_INVALID_PARAMS: 2,
  E_METHOD_NOT_FOUND: 2,
  E_NOT_FOUND: 6,
  E_SESSION_NOT_FOUND: 6,
  E_TURN_NOT_FOUND: 6,
  E_CONFIG_INVALID: 3,
  E_PERMISSION: 5,
  E_APPROVAL_REQUIRED: 5,
  E_SANDBOX: 5,
  E_CONFLICT: 9,
  E_PROVIDER_AUTH: 4,
  E_PROVIDER_RATE_LIMIT: 4,
  E_PROVIDER_UNAVAILABLE: 4,
  E_PROVIDER_CAPABILITY: 4,
  E_CONTEXT_OVERFLOW: 4,
  E_STREAM_TRUNCATED: 7,
  E_PLAN_INVALID: 4,
  E_PLAN_BLOCKED: 9,
  E_PLAN_REQUIRED_APPROVAL: 5,
  E_VERIFICATION_FAILED: 1,
  E_TOOL_TIMEOUT: 7,
  E_TOOL_FAILED: 1,
  E_FILE_CHANGED: 1,
  E_LEASE_CONFLICT: 9,
  E_GOAL_INCOMPLETE: 9,
  E_NO_PROGRESS: 7,
  E_TOOL_NOT_FOUND: 2,
  E_TOOL_INVALID_ARGS: 2,
  E_BUDGET_EXHAUSTED: 4,
  E_DB: 1,
  E_DAEMON_DOWN: 4,
  E_GATEWAY_AUTH: 4,
  E_RATE_LIMITED: 5,
  E_INPUT_TOO_LARGE: 2,
  E_RECOVERY_FAILED: 1,
  E_RUNTIME_EXCEEDED: 7,
  E_JOB_FAILED: 1,
  E_CANCELLED: 8,
  E_TIMEOUT: 7,
  E_STORAGE: 1,
  E_UNSUPPORTED: 2,
  E_INTERNAL: 1
};

const RETRYABLE = new Set<ErrorCode>([
  "E_APPROVAL_REQUIRED",
  "E_PROVIDER_RATE_LIMIT",
  "E_PROVIDER_UNAVAILABLE",
  "E_CONTEXT_OVERFLOW",
  "E_STREAM_TRUNCATED",
  "E_TOOL_TIMEOUT",
  "E_DAEMON_DOWN",
  "E_TIMEOUT",
  "E_CONFLICT",
  "E_RATE_LIMITED"
]);

export interface RannErrorOptions {
  data?: Record<string, unknown>;
  cause?: unknown;
  retryable?: boolean;
}

export class RannError extends Error {
  readonly code: ErrorCode;
  readonly data?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: RannErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RannError";
    this.code = code;
    this.data = options.data;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}

export function exitCodeFor(code: ErrorCode): number {
  return EXIT_CODES[code];
}

export function isRannError(value: unknown): value is RannError {
  return value instanceof RannError;
}

export function toRannError(value: unknown): RannError {
  if (isRannError(value)) return value;
  if (value instanceof Error) return new RannError("E_INTERNAL", value.message, { cause: value });
  return new RannError("E_INTERNAL", String(value));
}

export interface RpcErrorShape {
  code: ErrorCode;
  message: string;
  data?: Record<string, unknown>;
  hint?: string;
}

const HINTS: Partial<Record<ErrorCode, string>> = {
  E_PROVIDER_AUTH: "Periksa API key provider dengan rann provider test, lalu login ulang bila perlu.",
  E_PROVIDER_RATE_LIMIT: "Tunggu atau ganti provider lewat rann provider use.",
  E_PROVIDER_UNAVAILABLE: "Cek koneksi dan endpoint provider; circuit breaker terbuka sementara.",
  E_CONTEXT_OVERFLOW: "Kurangi lampiran atau jalankan /compact, lalu ulangi.",
  E_TOOL_TIMEOUT: "Naikkan timeout tool atau pecah pekerjaan menjadi langkah lebih kecil.",
  E_FILE_CHANGED: "Baca ulang berkas sebelum menulis karena isinya berubah sejak dibaca.",
  E_LEASE_CONFLICT: "Sesi lain sedang memegang path ini; tunggu atau batalkan sesi tersebut.",
  E_PLAN_REQUIRED_APPROVAL: "Setujui rencana lewat dialog izin atau jalankan dengan mode yang sesuai.",
  E_BUDGET_EXHAUSTED: "Naikkan budget atau ganti model yang lebih murah.",
  E_APPROVAL_REQUIRED: "Setujui aksi di terminal, atau jalankan ulang dengan izin yang sesuai.",
  E_DAEMON_DOWN: "Jalankan rann doctor lalu coba lagi.",
  E_NO_PROGRESS: "Ubah strategi atau parameter, jangan ulangi perintah yang sama.",
  E_CONFIG_INVALID: "Periksa rann config list dan betulkan kunci yang dilaporkan."
};

export function hintFor(code: ErrorCode): string | undefined {
  return HINTS[code];
}

export function toRpcError(value: unknown, traceId?: string): RpcErrorShape {
  const err = toRannError(value);
  const data = { ...(err.data ?? {}), ...(traceId ? { trace_id: traceId } : {}) };
  const shape: RpcErrorShape = { code: err.code, message: err.message };
  if (Object.keys(data).length > 0) shape.data = data;
  const hint = hintFor(err.code);
  if (hint) shape.hint = hint;
  return shape;
}

/** Hanya untuk pesan yang aman ditampilkan: tidak pernah memuat secret. */
export function publicMessage(value: unknown): string {
  return toRannError(value).message;
}
