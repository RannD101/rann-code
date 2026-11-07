import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { RannError } from "@rann/shared";
import { findTool } from "./tools/index.js";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type JsonRecord = Record<string, unknown>;
export type Invoke = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function cleanName(value: string): string {
  return value.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "lampiran";
}

export function impactFor(tool: string): string {
  const spec = findTool(tool);
  if (!spec) return "tidak diketahui";
  if (spec.risk === "exec") return "menjalankan perintah di workspace";
  if (spec.risk === "write") return "mengubah berkas di workspace";
  if (spec.risk === "net") return "mengakses jaringan";
  if (spec.risk === "admin") return "mengubah konfigurasi agent";
  return "hanya membaca data";
}

export function approvalReason(args: JsonRecord): string {
  if (typeof args.reason === "string" && args.reason.trim()) return args.reason.trim().slice(0, 300);
  if (typeof args.command === "string") return `Perintah: ${args.command.slice(0, 200)}`;
  if (typeof args.path === "string") return `Berkas: ${args.path.slice(0, 200)}`;
  if (typeof args.url === "string") return `URL: ${args.url.slice(0, 200)}`;
  return "Tool ini butuh persetujuan sebelum dijalankan.";
}

export function approvalText(input: { tool: string; args: JsonRecord; requestId: string }): string {
  return [
    "Izin diperlukan",
    `tool: ${input.tool}`,
    `dampak: ${impactFor(input.tool)}`,
    `alasan: ${approvalReason(input.args)}`,
    `id: ${input.requestId}`,
    "",
    "1. Izinkan",
    "2. Tolak",
    "",
    "Balas 1 atau ya untuk menyetujui, 2 atau tidak untuk menolak."
  ].join("\n");
}

const APPROVE_REPLIES = new Set(["1", "ya", "yes"]);
const DENY_REPLIES = new Set(["2", "tidak", "no"]);

/** Mengembalikan true untuk setuju, false untuk tolak, undefined bila bukan balasan izin. */
export function normalizeApprovalReply(text: string): boolean | undefined {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/u, "")
    .trim();
  if (APPROVE_REPLIES.has(normalized)) return true;
  if (DENY_REPLIES.has(normalized)) return false;
  return undefined;
}

export function stripCommandPrefix(text: string, prefixes: string[]): { text: string; prefixed: boolean } {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  for (const prefix of prefixes) {
    const needle = prefix.toLowerCase();
    if (!lower.startsWith(needle)) continue;
    const rest = trimmed.slice(needle.length);
    if (rest.length === 0) return { text: "", prefixed: true };
    if (/^\s/u.test(rest)) return { text: rest.trim(), prefixed: true };
    if (/^@\S+$/u.test(rest)) return { text: "", prefixed: true };
    if (/^@\S+\s/u.test(rest)) return { text: rest.replace(/^@\S+\s*/u, "").trim(), prefixed: true };
  }
  return { text: trimmed, prefixed: false };
}

export function looksLikeCommand(text: string): boolean {
  return /^[/!]\S/u.test(text.trim());
}

export function splitPlatformMessage(text: string, limit: number, hardLimit = 12_000): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [""];
  const clipped =
    normalized.length > hardLimit
      ? `${normalized.slice(0, hardLimit)}\n\n[... dipotong, ${String(normalized.length)} karakter total]`
      : normalized;
  if (clipped.length <= limit) return [clipped];
  const chunks: string[] = [];
  let rest = clipped;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.map((chunk, index) => `${chunk}\n\n(${String(index + 1)}/${String(chunks.length)})`);
}

export function saveAttachment(input: { bytes: Buffer; name: string; projectPath: string; platform: string }): {
  path: string;
  name: string;
} {
  const targetDir = join(input.projectPath, ".rann", input.platform);
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const extension = extname(input.name).toLowerCase();
  const hash = createHash("sha256").update(input.bytes).digest("hex").slice(0, 16);
  const stored = join(targetDir, `${hash}-${cleanName(basename(input.name, extension))}${extension}`);
  if (existsSync(stored)) {
    chmodSync(stored, 0o600);
  } else {
    writeFileSync(stored, input.bytes, { mode: 0o600 });
  }
  return { path: relative(input.projectPath, stored), name: cleanName(input.name) };
}

export async function readBodyLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new RannError("E_INPUT_TOO_LARGE", "Lampiran melebihi 20 MB");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RannError("E_INPUT_TOO_LARGE", "Lampiran melebihi 20 MB");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export interface CommandContext {
  invoke: Invoke;
  sessionId: string;
  reply: (text: string) => Promise<void>;
  resolveApproval: (approved: boolean, requestId: string | undefined) => Promise<void>;
}

export async function runTextCommand(text: string, context: CommandContext): Promise<boolean> {
  const [raw = "", ...rest] = text.trim().split(/\s+/u);
  const name = raw.replace(/^[!/]/u, "").split("@")[0]?.toLowerCase() ?? "";
  const argument = rest.join(" ").trim();
  if (!name) return false;
  if (name === "status") {
    const health = asRecord(await context.invoke("health", {}));
    const usage = asRecord(await context.invoke("usage.summary", { sessionId: context.sessionId }));
    await context.reply(
      [
        `status daemon: ${String(health.status ?? "?")}`,
        `sesi: ${context.sessionId}`,
        `turn: ${String(usage.turns ?? 0)}`,
        `token: ${String(usage.total_tokens ?? 0)}`,
        `biaya: $${Number(usage.cost_usd ?? 0).toFixed(4)}`
      ].join("\n")
    );
    return true;
  }
  if (name === "cancel") {
    const result = asRecord(await context.invoke("session.cancel", { sessionId: context.sessionId }));
    await context.reply(result.cancelled ? "Turn dibatalkan." : "Tidak ada turn berjalan.");
    return true;
  }
  if (name === "resume") {
    await context.invoke("session.send", { sessionId: context.sessionId, text: "lanjutkan dari langkah terakhir" });
    await context.reply("Melanjutkan sesi...");
    return true;
  }
  if (name === "model") {
    const models = await context.invoke("model.list", {});
    const list = Array.isArray(models) ? models.slice(0, 15) : [];
    const lines = list.map((item) => {
      const row = asRecord(item);
      return `${String(row.id ?? row.name ?? "?")} (${String(row.provider ?? "?")})`;
    });
    await context.reply(lines.length > 0 ? `Model tersedia:\n${lines.join("\n")}` : "Belum ada model.");
    return true;
  }
  if (name === "cost") {
    const usage = asRecord(await context.invoke("usage.summary", { sessionId: context.sessionId }));
    await context.reply(
      `token masuk: ${String(usage.input_tokens ?? 0)}\ntoken keluar: ${String(usage.output_tokens ?? 0)}\nbiaya: $${Number(usage.cost_usd ?? 0).toFixed(4)}`
    );
    return true;
  }
  if (name === "approve" || name === "deny") {
    await context.resolveApproval(name === "approve", argument || undefined);
    return true;
  }
  if (name === "help" || name === "start") {
    await context.reply("Perintah: status, cancel, resume, model, cost, approve <id>, deny <id>");
    return true;
  }
  return false;
}

export function slackTsToMicros(ts: string): bigint {
  const [seconds = "", fraction = ""] = ts.split(".");
  if (!/^\d+$/u.test(seconds) || !/^\d*$/u.test(fraction)) {
    throw new RannError("E_INVALID_PARAMS", `Timestamp Slack tidak valid: ${ts}`);
  }
  const padded = `${fraction}000000`.slice(0, 6);
  return BigInt(seconds) * 1_000_000n + BigInt(padded);
}

export function discordIdToBigInt(id: string): bigint {
  try {
    return BigInt(id);
  } catch {
    throw new RannError("E_INVALID_PARAMS", `ID pesan Discord tidak valid: ${id}`);
  }
}
