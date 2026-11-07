import { RannError, toRannError } from "@rann/shared";

export type FailureCategory =
  | "provider"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "budget"
  | "permission"
  | "context"
  | "stream"
  | "plan"
  | "tool"
  | "cancelled"
  | "unknown";

export interface FailureAnalysis {
  category: FailureCategory;
  retryable: boolean;
  cause: string;
  action: string;
}

export interface FailureContext {
  provider?: string;
  model?: string;
  step?: number;
  lastTool?: string;
}

const TABLE: Record<string, Omit<FailureAnalysis, "cause">> = {
  E_PROVIDER_AUTH: {
    category: "auth",
    retryable: false,
    action: "Periksa api_key_ref provider, lalu jalankan `rann provider test <nama>`."
  },
  E_PROVIDER_RATE_LIMIT: {
    category: "rate_limit",
    retryable: true,
    action: "Tunggu sesuai Retry-After atau pindah ke provider lain lewat fallback."
  },
  E_PROVIDER_UNAVAILABLE: {
    category: "provider",
    retryable: true,
    action: "Cek base URL dan status provider; fallback akan mencoba kandidat berikutnya."
  },
  E_PROVIDER_CAPABILITY: {
    category: "provider",
    retryable: false,
    action: "Pilih model yang punya capability yang dibutuhkan, misalnya tool calling."
  },
  E_TIMEOUT: {
    category: "timeout",
    retryable: true,
    action: "Naikkan timeout atau kecilkan permintaan; stream yang sudah mengirim teks tidak diulang."
  },
  E_STREAM_TRUNCATED: {
    category: "stream",
    retryable: true,
    action: "Teks parsial sudah disimpan; ulangi turn bila jawaban belum lengkap."
  },
  E_BUDGET_EXHAUSTED: {
    category: "budget",
    retryable: false,
    action: "Naikkan budget harian, kecilkan tugas, atau tunggu reset harian."
  },
  E_CONTEXT_OVERFLOW: {
    category: "context",
    retryable: false,
    action: "Kurangi konteks, mulai sesi baru, atau pakai model dengan context window lebih besar."
  },
  E_APPROVAL_REQUIRED: {
    category: "permission",
    retryable: false,
    action: "Setujui permintaan tool lewat dialog izin atau ubah mode izin."
  },
  E_PERMISSION: {
    category: "permission",
    retryable: false,
    action: "Periksa workspace_only, daftar allow/deny, dan path yang dituju tool."
  },
  E_PLAN_INVALID: {
    category: "plan",
    retryable: true,
    action: "Perbaiki siklus atau task tanpa kriteria selesai, lalu susun ulang rencana."
  },
  E_PLAN_REQUIRED_APPROVAL: {
    category: "permission",
    retryable: false,
    action: "Setujui rencana sebelum tool tulis dijalankan."
  },
  E_CANCELLED: {
    category: "cancelled",
    retryable: false,
    action: "Turn dihentikan user; mulai turn baru bila ingin melanjutkan."
  }
};

export function analyzeFailure(error: unknown, context: FailureContext = {}): FailureAnalysis {
  const err = error instanceof RannError ? error : toRannError(error);
  const base = TABLE[err.code] ?? {
    category: "unknown" as const,
    retryable: false,
    action: "Periksa pesan error dan log turn; kode ini belum punya saran otomatis."
  };
  const where = [
    context.provider ? `provider ${context.provider}` : undefined,
    context.model ? `model ${context.model}` : undefined,
    context.step !== undefined ? `langkah ${context.step}` : undefined,
    context.lastTool ? `tool terakhir ${context.lastTool}` : undefined
  ].filter((item): item is string => item !== undefined);
  const cause = where.length > 0 ? `${err.message} (${where.join(", ")})` : err.message;
  return { ...base, cause };
}
