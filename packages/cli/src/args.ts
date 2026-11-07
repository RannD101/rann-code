export interface ParsedArgs {
  command?: string;
  subcommand?: string;
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

const SUBCOMMAND_COMMANDS = new Set(["daemon", "config", "provider", "db", "memory", "skill", "secret", "route"]);

const VALUE_FLAGS = new Set([
  "prompt",
  "title",
  "model",
  "provider",
  "permission",
  "key",
  "value",
  "limit",
  "status",
  "session",
  "home",
  "profile",
  "base-url",
  "key-env",
  "type",
  "output-format",
  "scope",
  "kind",
  "tags",
  "text",
  "description",
  "body-file",
  "body",
  "project",
  "env",
  "policy"
]);

function setFlag(flags: ParsedArgs["flags"], key: string, value: string | boolean): void {
  const current = flags[key];
  if (current === undefined) {
    flags[key] = value;
    return;
  }
  if (Array.isArray(current)) {
    current.push(String(value));
    return;
  }
  flags[key] = [String(current), String(value)];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { positionals: [], flags: {} };
  let index = 0;

  if (argv[0] !== undefined && !argv[0].startsWith("-")) {
    result.command = argv[0];
    index = 1;
    if (SUBCOMMAND_COMMANDS.has(result.command) && argv[1] !== undefined && !argv[1].startsWith("-")) {
      result.subcommand = argv[1];
      index = 2;
    }
  }

  while (index < argv.length) {
    const token = argv[index]!;
    if (token === "--") {
      result.positionals.push(...argv.slice(index + 1));
      break;
    }
    if (token === "-p") {
      const value = argv[index + 1];
      if (value !== undefined && !value.startsWith("-")) {
        setFlag(result.flags, "prompt", value);
        index += 2;
      } else {
        setFlag(result.flags, "prompt", true);
        index += 1;
      }
      continue;
    }
    if (token === "-v" || token === "--version") {
      setFlag(result.flags, "version", true);
      index += 1;
      continue;
    }
    if (token === "-h" || token === "--help") {
      setFlag(result.flags, "help", true);
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        setFlag(result.flags, body.slice(0, eq), body.slice(eq + 1));
        index += 1;
        continue;
      }
      const next = argv[index + 1];
      if (VALUE_FLAGS.has(body) && next !== undefined && !next.startsWith("-")) {
        setFlag(result.flags, body, next);
        index += 2;
        continue;
      }
      setFlag(result.flags, body, true);
      index += 1;
      continue;
    }
    result.positionals.push(token);
    index += 1;
  }
  return result;
}

export function flagString(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[value.length - 1];
  return undefined;
}

export function flagBool(args: ParsedArgs, key: string): boolean {
  const value = args.flags[key];
  if (Array.isArray(value)) return value.includes("true") || value.includes("1");
  return value === true || value === "true" || value === "1";
}
