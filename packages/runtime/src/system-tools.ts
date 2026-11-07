import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { RannError } from "@rann/shared";

const MAX_DB_ROWS = 500;
const MAX_DOC_CHARS = 200_000;

export function sqliteQuery(path: string, sql: string, params: unknown[] = []): { columns: string[]; rows: unknown[][]; truncated: boolean } {
  const trimmed = sql.trim();
  if (!/^(select|with|explain|pragma\s+(table_info|index_list|index_info|foreign_key_list|database_list))/i.test(trimmed)) {
    throw new RannError("E_PERMISSION", "Query database hanya boleh SELECT, WITH, EXPLAIN, atau PRAGMA baca");
  }
  if (/\b(insert|update|delete|drop|alter|create|attach|detach|vacuum|reindex)\b/i.test(trimmed)) {
    throw new RannError("E_PERMISSION", "Query yang mengubah database ditolak");
  }
  if (!existsSync(path)) throw new RannError("E_TOOL_INVALID_ARGS", `Database tidak ada: ${path}`);
  const db = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
  try {
    const statement = db.prepare(trimmed);
    const rawRows = statement.raw(true).all(...params);
    const columns = statement.columns().map((column) => column.name);
    const rows = rawRows.slice(0, MAX_DB_ROWS) as unknown[][];
    return { columns, rows, truncated: rawRows.length > MAX_DB_ROWS };
  } finally {
    db.close();
  }
}

export function systemInfo(): Record<string, unknown> {
  const read = (path: string): string => {
    try {
      return readFileSync(path, "utf8").trim();
    } catch {
      return "";
    }
  };
  return {
    platform: process.platform,
    arch: process.arch,
    release: read("/proc/sys/kernel/osrelease") || process.version,
    node: process.version,
    cpus: execFileSync("sh", ["-c", "nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1"], { encoding: "utf8" }).trim(),
    uptime_seconds: Math.round(Number(read("/proc/uptime").split(" ")[0] ?? 0)),
    memory: read("/proc/meminfo").split("\n").filter((line) => /MemTotal|MemAvailable|SwapTotal/.test(line)),
    disk: execFileSync("df", ["-h", process.cwd()], { encoding: "utf8" }).trim().split("\n").slice(-1)[0] ?? ""
  };
}

export function documentExtract(path: string): { text: string; kind: string; bytes: number; truncated: boolean } {
  if (!existsSync(path)) throw new RannError("E_TOOL_INVALID_ARGS", `Dokumen tidak ada: ${path}`);
  const ext = extname(path).toLowerCase();
  const bytes = statSync(path).size;
  if (bytes > 25 * 1024 * 1024) throw new RannError("E_INPUT_TOO_LARGE", "Dokumen melebihi 25 MB");
  let text = "";
  let kind = ext.replace(".", "") || "unknown";
  if ([".txt", ".md", ".csv", ".json", ".log"].includes(ext)) {
    text = readFileSync(path, "utf8");
  } else if (ext === ".pdf") {
    try {
      text = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8", timeout: 60_000 });
    } catch {
      throw new RannError("E_UNSUPPORTED", "pdftotext tidak tersedia. Pasang poppler-utils untuk membaca PDF");
    }
  } else if (ext === ".docx") {
    try {
      text = execFileSync("unzip", ["-p", path, "word/document.xml"], { encoding: "utf8", timeout: 30_000, maxBuffer: 20 * 1024 * 1024 })
        .replace(/<w:p[ >]/g, "\n<w:p ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+\n/g, "\n")
        .replace(/[ \t]+/g, " ");
    } catch {
      throw new RannError("E_UNSUPPORTED", "unzip tidak tersedia untuk membaca DOCX");
    }
  } else if (ext === ".xlsx") {
    try {
      const shared = execFileSync("unzip", ["-p", path, "xl/sharedStrings.xml"], { encoding: "utf8", timeout: 30_000, maxBuffer: 20 * 1024 * 1024 }).replace(/<[^>]+>/g, " ");
      const sheet = execFileSync("unzip", ["-p", path, "xl/worksheets/sheet1.xml"], { encoding: "utf8", timeout: 30_000, maxBuffer: 20 * 1024 * 1024 }).replace(/<[^>]+>/g, " ");
      text = `${shared}\n${sheet}`.replace(/[ \t]+/g, " ");
      kind = "xlsx";
    } catch {
      throw new RannError("E_UNSUPPORTED", "unzip tidak tersedia untuk membaca XLSX");
    }
  } else {
    throw new RannError("E_UNSUPPORTED", `Format dokumen belum didukung: ${ext || "tanpa ekstensi"}`);
  }
  const clipped = text.trim().slice(0, MAX_DOC_CHARS);
  return { text: clipped, kind, bytes, truncated: text.trim().length > clipped.length };
}

export function imageInfo(path: string, ocrRequested = false): Record<string, unknown> {
  if (!existsSync(path)) throw new RannError("E_TOOL_INVALID_ARGS", `Gambar tidak ada: ${path}`);
  const bytes = statSync(path).size;
  const output: Record<string, unknown> = { path, name: basename(path), bytes };
  try {
    const identify = execFileSync("identify", ["-format", "%m %wx%h %[colorspace]", path], { encoding: "utf8", timeout: 10_000 }).trim();
    const [format, dimensions, colorspace] = identify.split(" ");
    Object.assign(output, { format, width: dimensions?.split("x")[0], height: dimensions?.split("x")[1], dimensions, colorspace });
  } catch {
    output.note = "ImageMagick identify tidak tersedia; metadata dimensi tidak dibaca";
  }
  const ocr = ocrRequested || process.env.RANN_OCR === "1";
  if (ocr) {
    try {
      output.ocr = execFileSync("tesseract", [path, "stdout", "-l", process.env.RANN_OCR_LANG ?? "eng"], { encoding: "utf8", timeout: 120_000 }).slice(0, 50_000);
    } catch {
      output.ocr_error = "tesseract tidak tersedia";
    }
  }
  return output;
}

export function imageTransform(path: string, output: string, options: { width?: number; height?: number; crop?: string }): Record<string, unknown> {
  if (!existsSync(path)) throw new RannError("E_TOOL_INVALID_ARGS", `Gambar tidak ada: ${path}`);
  const args: string[] = [path];
  if (options.crop) args.push("-crop", options.crop);
  if (options.width || options.height) args.push("-resize", `${options.width ?? ""}x${options.height ?? ""}`);
  args.push(output);
  try {
    execFileSync("convert", args, { encoding: "utf8", timeout: 60_000 });
  } catch {
    throw new RannError("E_UNSUPPORTED", "ImageMagick convert tidak tersedia untuk mengubah gambar");
  }
  return { output, source: path, bytes: statSync(output).size };
}

const PACKAGE_MANAGERS = /^(npm|pnpm|yarn)$/;
const PACKAGE_VERBS = /^(install|i|add|remove|uninstall|test|run|ci|update|list|ls|why|outdated|audit)$/;

export function packageCommand(manager: string, args: string[], cwd: string): Record<string, unknown> {
  if (!PACKAGE_MANAGERS.test(manager)) throw new RannError("E_PERMISSION", `Package manager tidak diizinkan: ${manager}`);
  const verb = args[0] ?? "";
  if (!PACKAGE_VERBS.test(verb)) throw new RannError("E_PERMISSION", `Subperintah package tidak diizinkan: ${verb || "(kosong)"}`);
  if (args.some((arg) => /^--(prefix|global|location=global|registry|script-shell)/.test(arg))) {
    throw new RannError("E_PERMISSION", "Flag package yang mengubah lokasi global atau registry ditolak");
  }
  const started = Date.now();
  try {
    const output = execFileSync(manager, args, { cwd, encoding: "utf8", timeout: 300_000, maxBuffer: 5 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } });
    return { manager, args, exit_code: 0, output: output.slice(0, 100_000), duration_ms: Date.now() - started };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return {
      manager,
      args,
      exit_code: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`.slice(0, 100_000),
      duration_ms: Date.now() - started
    };
  }
}

export function detectPackageManager(cwd: string): string {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}
