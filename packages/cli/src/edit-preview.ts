import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface EditPreview {
  path: string;
  added: number;
  removed: number;
  lines: string[];
}

function splitLines(value: string): string[] {
  return value.length === 0 ? [] : value.replace(/\r\n/g, "\n").split("\n");
}

function summarize(before: string, after: string, path: string): EditPreview {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  const lines = [
    ...removed.slice(0, 4).map((line) => `- ${line}`),
    ...added.slice(0, 6).map((line) => `+ ${line}`)
  ];
  if (removed.length > 4) lines.push(`- ... ${removed.length - 4} baris lagi`);
  if (added.length > 6) lines.push(`+ ... ${added.length - 6} baris lagi`);
  return { path, added: added.length, removed: removed.length, lines };
}

function readIfExists(path: string): string | null {
  try {
    const absolute = resolve(path);
    if (!existsSync(absolute)) return null;
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

export function previewEdit(tool: string, rawArgs: unknown, cwd: string): EditPreview | null {
  if (rawArgs === null || typeof rawArgs !== "object") return null;
  const args = rawArgs as Record<string, unknown>;
  try {
    if (tool === "fs_edit" || tool === "edit_file") {
      const path = String(args.path ?? "");
      if (!path || typeof args.old !== "string" || typeof args.new !== "string") return null;
      return summarize(args.old, args.new, path);
    }
    if (tool === "fs_write" || tool === "write_file") {
      const path = String(args.path ?? "");
      if (!path || typeof args.content !== "string") return null;
      return summarize(readIfExists(resolve(cwd, path)) ?? "", args.content, path);
    }
    if (tool === "apply_patch" && Array.isArray(args.changes)) {
      const first = args.changes[0] as Record<string, unknown> | undefined;
      if (!first || typeof first.path !== "string" || typeof first.content !== "string") return null;
      return summarize(readIfExists(resolve(cwd, first.path)) ?? "", first.content, first.path);
    }
  } catch {
    return null;
  }
  return null;
}
