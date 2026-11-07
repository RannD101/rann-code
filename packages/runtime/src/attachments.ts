import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { RannError } from "@rann/shared";

export type AttachmentKind = "image" | "pdf" | "text";

export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  hash: string;
  path: string;
  kind: AttachmentKind;
}

export interface RawAttachment {
  path: string;
  name?: string;
}

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const IMAGE_TYPES: Array<{ mime: string; ext: string; magic: number[] }> = [
  { mime: "image/png", ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", ext: ".jpg", magic: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", ext: ".gif", magic: [0x47, 0x49, 0x46, 0x38] }
];

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv", ".log", ".yaml", ".yml",
  ".toml", ".ini", ".cfg", ".conf", ".xml", ".html", ".htm", ".css", ".scss", ".js", ".mjs",
  ".cjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".php", ".sh",
  ".bash", ".zsh", ".sql", ".env", ".gitignore", ".dockerfile", ".diff", ".patch"
]);

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function detectMime(path: string, buffer: Buffer): { mime: string; kind: AttachmentKind } | undefined {
  for (const candidate of IMAGE_TYPES) {
    if (startsWith(buffer, candidate.magic)) return { mime: candidate.mime, kind: "image" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", kind: "image" };
  }
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46])) return { mime: "application/pdf", kind: "pdf" };
  const extension = extname(path).toLowerCase();
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  const binary = sample.includes(0) || sample.some((byte) => byte < 7 || (byte > 13 && byte < 32));
  if (!binary && (TEXT_EXTENSIONS.has(extension) || sample.length === 0)) {
    const known: Record<string, string> = {
      ".md": "text/markdown", ".markdown": "text/markdown", ".json": "application/json",
      ".jsonl": "application/x-ndjson", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
      ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".xml": "application/xml"
    };
    return { mime: known[extension] ?? "text/plain", kind: "text" };
  }
  return undefined;
}

function insideWorkspace(path: string, workspaceRoot: string): boolean {
  const relativePath = relative(workspaceRoot, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function prepareAttachments(
  raw: RawAttachment[] | undefined,
  workspaceRoot: string,
  artifactsDir: string
): AttachmentRef[] {
  if (!raw || raw.length === 0) return [];
  if (raw.length > 20) throw new RannError("E_INVALID_PARAMS", "Maksimal 20 lampiran per turn");
  const root = realpathSync(workspaceRoot);
  const targetDir = join(artifactsDir, "attachments");
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  const prepared: AttachmentRef[] = [];
  let total = 0;
  for (const item of raw) {
    const requested = resolve(workspaceRoot, item.path);
    if (!existsSync(requested)) throw new RannError("E_INVALID_PARAMS", `Lampiran tidak ditemukan: ${item.path}`);
    const stats = lstatSync(requested);
    if (stats.isDirectory()) throw new RannError("E_INVALID_PARAMS", `Lampiran harus berkas, bukan folder: ${item.path}`);
    if (stats.isSymbolicLink()) throw new RannError("E_PERMISSION", `Lampiran symlink tidak diizinkan: ${item.path}`);
    const real = realpathSync(requested);
    if (!insideWorkspace(real, root)) {
      throw new RannError("E_PERMISSION", `Lampiran di luar workspace ditolak: ${item.path}`);
    }
    const size = statSync(real).size;
    if (size > MAX_ATTACHMENT_BYTES) {
      throw new RannError("E_INVALID_PARAMS", `Lampiran ${basename(real)} melebihi 20 MB`);
    }
    total += size;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new RannError("E_INVALID_PARAMS", "Total lampiran melebihi 50 MB, pecah menjadi beberapa turn");
    }
    const buffer = readFileSync(real);
    const detected = detectMime(real, buffer);
    if (!detected) {
      throw new RannError("E_INVALID_PARAMS", `Tipe lampiran tidak didukung: ${item.name ?? basename(real)}`);
    }
    const hash = createHash("sha256").update(buffer).digest("hex");
    const extension = extname(real).toLowerCase() || (detected.kind === "image" ? ".img" : ".txt");
    const destination = join(targetDir, `${hash}${extension}`);
    if (!existsSync(destination)) copyFileSync(real, destination);
    prepared.push({
      id: `att_${hash.slice(0, 16)}`,
      name: item.name ?? basename(real),
      mime: detected.mime,
      size,
      hash,
      path: destination,
      kind: detected.kind
    });
  }
  return prepared;
}

export function attachmentText(attachment: AttachmentRef, maxChars = 50_000): string {
  if (attachment.kind === "text") {
    const text = readFileSync(attachment.path, "utf8");
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n[... dipotong, ${text.length} karakter total]` : text;
  }
  if (attachment.kind === "pdf") {
    try {
      const result = spawnPdfText(attachment.path);
      return result.length > maxChars ? `${result.slice(0, maxChars)}\n[... dipotong, ${result.length} karakter total]` : result;
    } catch {
      return "";
    }
  }
  return "";
}

function spawnPdfText(path: string): string {
  const result = spawnSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 30_000 });
  if (result.status !== 0 || typeof result.stdout !== "string") throw new Error("pdftotext gagal");
  return result.stdout;
}
