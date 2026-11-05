import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RannError } from "@rann/shared";

function formatValue(raw: string): string {
  if (raw === "true" || raw === "false") return raw;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  if (raw.startsWith("[") || raw.startsWith("{")) return raw;
  return JSON.stringify(raw);
}

function sectionOf(keyPath: string[]): string {
  return keyPath.slice(0, -1).join(".");
}

export function setConfigValue(home: string, key: string, rawValue: string): void {
  const parts = key.split(".").filter(Boolean);
  if (parts.length === 0) throw new RannError("E_INVALID_PARAMS", "Kunci config kosong");
  const keyName = parts[parts.length - 1]!;
  const section = sectionOf(parts);
  const path = join(home, "config", "config.toml");

  let lines: string[] = [];
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch {
    lines = [];
  }

  const output: string[] = [];
  let current = "";
  let inserted = false;
  const newLine = `${keyName} = ${formatValue(rawValue)}`;

  const flushInsert = (): void => {
    if (inserted) return;
    if (current === section) {
      if (output.length > 0 && output[output.length - 1] === "") output.pop();
      output.push(newLine);
      inserted = true;
    }
  };

  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      if (current === section) {
        flushInsert();
      }
      current = header[1] ?? "";
      output.push(line);
      continue;
    }
    const assignment = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (assignment && current === section && assignment[1] === keyName) continue;
    output.push(line);
  }

  if (!inserted) {
    if (section.length > 0 && !lines.some((line) => new RegExp(`^\\s*\\[${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`).test(line))) {
      if (output.length > 0 && output[output.length - 1] !== "") output.push("");
      output.push(`[${section}]`);
    }
    output.push(newLine);
  }

  writeFileSync(path, output.join("\n"), { mode: 0o600 });
}
