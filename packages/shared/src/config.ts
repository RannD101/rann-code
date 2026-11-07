import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { RannError } from "./errors.js";

export const providerConfigSchema = z.object({
  kind: z.enum(["openai-compatible", "openai-chat", "openai-responses", "anthropic", "gemini", "mock"]).default("openai-compatible"),
  base_url: z.string().url().optional(),
  api_key_env: z.string().min(1).optional(),
  api_key_file: z.string().min(1).optional(),
  api_key_ref: z.string().min(1).optional(),
  default_model: z.string().min(1).optional(),
  models: z.array(z.string().min(1)).default([]),
  timeout_ms: z.number().int().positive().max(600_000).default(120_000),
  headers: z.record(z.string()).default({}),
  stream: z.boolean().default(true)
});

export const permissionsSchema = z.object({
  mode: z.enum(["read-only", "ask", "accept-edits", "trusted", "custom"]).default("ask"),
  workspace_only: z.boolean().default(true),
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([])
});

export const configSchema = z.object({
  profile: z.string().min(1).default("default"),
  model: z
    .object({
      default: z.string().min(1).default("auto"),
      fallback: z.array(z.string().min(1)).default([])
    })
    .default({}),
  provider: z.string().min(1).default("mock"),
  providers: z.record(providerConfigSchema).default({}),
  models: z
    .record(
      z.object({
        context_window: z.number().int().positive().max(10_000_000).optional(),
        max_output_tokens: z.number().int().positive().max(1_000_000).optional(),
        capabilities: z.record(z.boolean()).default({}),
        input_price: z.number().nonnegative().optional(),
        output_price: z.number().nonnegative().optional(),
        cache_read_price: z.number().nonnegative().optional(),
        cache_write_price: z.number().nonnegative().optional(),
        aliases: z.array(z.string()).default([])
      })
    )
    .default({}),
  permissions: permissionsSchema.default({}),
  agent: z
    .object({
      max_steps: z.number().int().positive().max(200).default(24),
      max_runtime_ms: z.number().int().positive().max(86_400_000).default(7_200_000),
      heartbeat_ms: z.number().int().min(1_000).max(10_000).default(5_000),
      system_extra: z.string().default("")
    })
    .default({}),
  memory: z
    .object({
      enabled: z.boolean().default(true),
      prompt_chars: z.number().int().positive().max(32_000).default(6_000),
      retrieve: z.number().int().positive().max(50).default(8)
    })
    .default({}),
  skills: z
    .object({
      enabled: z.boolean().default(true),
      catalog_limit: z.number().int().positive().max(200).default(40)
    })
    .default({}),
  subagents: z
    .object({
      enabled: z.boolean().default(true),
      max_steps: z.number().int().positive().max(50).default(10),
      max_per_turn: z.number().int().positive().max(10).default(3),
      max_depth: z.number().int().min(1).max(3).default(2),
      max_children: z.number().int().min(1).max(16).default(8),
      heartbeat_ms: z.number().int().min(1_000).max(60_000).default(5_000),
      permission_mode: z.enum(["read-only", "ask", "accept-edits", "trusted", "custom"]).default("read-only"),
      model: z.string().min(1).optional()
    })
    .default({}),
  background: z
    .object({
      concurrency: z.number().int().min(1).max(8).default(2),
      poll_ms: z.number().int().min(100).max(60_000).default(1_000),
      lease_ms: z.number().int().min(10_000).max(600_000).default(60_000),
      max_runtime_ms: z.number().int().min(60_000).max(86_400_000).default(3_600_000)
    })
    .default({}),
  scheduler: z
    .object({
      poll_ms: z.number().int().min(100).max(60_000).default(1_000)
    })
    .default({}),
  context: z
    .object({
      max_tokens: z.number().int().positive().max(1_000_000).default(24_000),
      keep_recent: z.number().int().positive().max(200).default(20),
      summary_chars: z.number().int().positive().max(32_000).default(6_000)
    })
    .default({}),
  routing: z
    .object({
      mode: z.enum(["auto", "manual"]).default("manual"),
      policy: z.string().default("balanced"),
      pinned: z.string().min(1).optional(),
      prefer: z.array(z.string()).default([]),
      min_quality: z.number().min(0).max(1).optional(),
      max_cost_per_task: z.number().nonnegative().optional(),
      strict_budget: z.boolean().default(false)
    })
    .default({}),
  budget: z
    .object({
      max_tokens_per_turn: z.number().int().nonnegative().default(0),
      max_tokens_per_day: z.number().int().nonnegative().default(0),
      max_usd_per_day: z.number().nonnegative().default(0)
    })
    .default({}),
  mcp: z
    .object({
      enabled: z.boolean().default(true),
      servers: z
        .record(
          z.object({
            command: z.string().min(1),
            args: z.array(z.string()).default([]),
            env: z.record(z.string()).default({}),
            cwd: z.string().min(1).optional(),
            enabled: z.boolean().default(true),
            timeout_ms: z.number().int().positive().max(120_000).default(20_000)
          })
        )
        .default({})
    })
    .default({}),
  ui: z
    .object({
      color: z.boolean().default(true),
      language: z.enum(["id", "en"]).default("id")
    })
    .default({}),
  storage: z
    .object({
      path: z.string().min(1).optional(),
      backup_before_migrate: z.boolean().default(true),
      retention_days: z.number().int().positive().default(30)
    })
    .default({}),
  logging: z.object({ level: z.enum(["debug", "info", "warn", "error", "silent"]).default("info") }).default({}),
  gateway: z
    .object({
      enabled: z.boolean().default(false),
      host: z.string().default("127.0.0.1"),
      port: z.number().int().positive().max(65535).default(8787),
      public_url: z.string().url().optional(),
      tls_cert: z.string().optional(),
      tls_key: z.string().optional(),
      heartbeat_ms: z.number().int().min(5_000).max(120_000).default(20_000),
      allow_origins: z.array(z.string()).default([]),
      profile: z.string().default("default")
    })
    .default({}),
  hooks: z
    .array(
      z.object({
        event: z.enum([
          "SessionStart",
          "SessionEnd",
          "UserPromptSubmit",
          "PreToolUse",
          "PostToolUse",
          "ToolError",
          "PreTask",
          "PostTask",
          "AgentSpawn",
          "AgentComplete",
          "MemoryWrite",
          "SkillLoad",
          "ContextCompact",
          "Stop",
          "PreCompact",
          "Notification"
        ]),
        kind: z.enum(["command", "http", "script", "plugin"]).default("command"),
        command: z.string().optional(),
        url: z.string().url().optional(),
        path: z.string().optional(),
        plugin: z.string().optional(),
        timeout_ms: z.number().int().min(100).max(120_000).default(10_000),
        on_error: z.enum(["block", "warn", "ignore"]).default("warn"),
        priority: z.number().int().min(-1_000).max(1_000).default(0),
        enabled: z.boolean().default(true),
        permissions: z.array(z.string()).default([])
      })
    )
    .default([]),
  plugins: z
    .object({
      enabled: z.boolean().default(true),
      allow_unsigned: z.boolean().default(false)
    })
    .default({}),
  messaging: z
    .object({
      telegram: z
        .object({
          enabled: z.boolean().default(false),
          token_env: z.string().default("TELEGRAM_BOT_TOKEN"),
          allowed_chats: z.array(z.string()).default([])
        })
        .default({}),
      discord: z
        .object({
          enabled: z.boolean().default(false),
          token_env: z.string().default("DISCORD_BOT_TOKEN"),
          public_key: z.string().optional(),
          allowed_channels: z.array(z.string()).default([])
        })
        .default({}),
      slack: z
        .object({
          enabled: z.boolean().default(false),
          token_env: z.string().default("SLACK_BOT_TOKEN"),
          signing_secret_env: z.string().default("SLACK_SIGNING_SECRET"),
          allowed_channels: z.array(z.string()).default([])
        })
        .default({})
    })
    .default({})
});

export type RannConfig = z.infer<typeof configSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
export type PermissionMode = RannConfig["permissions"]["mode"];

export type ConfigSource = "default" | "global" | "profile" | "project" | "env" | "flag";

export interface LoadedConfig {
  config: RannConfig;
  sources: Record<string, ConfigSource>;
  files: string[];
  home: string;
  projectPath: string;
}

export interface LoadConfigOptions {
  home: string;
  projectPath?: string;
  env?: NodeJS.ProcessEnv;
  overrides?: Partial<{ model: string; provider: string; permissionMode: PermissionMode; color: boolean }>;
}

const DEFAULT_CONFIG = configSchema.parse({});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readToml(path: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new RannError("E_CONFIG_INVALID", `Config tidak bisa dibaca: ${path}`, { cause: error });
  }
  try {
    const parsed = parseToml(raw);
    if (!isPlainObject(parsed)) {
      throw new Error("Isi TOML bukan objek");
    }
    return parsed;
  } catch (error) {
    throw new RannError("E_CONFIG_INVALID", `TOML tidak valid di ${path}: ${(error as Error).message}`, { cause: error });
  }
}

function markSources(patch: Record<string, unknown>, source: ConfigSource, into: Record<string, ConfigSource>, prefix = ""): void {
  for (const [key, value] of Object.entries(patch)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      markSources(value, source, into, path);
    } else {
      into[path] = source;
    }
  }
}

export function loadConfig(options: LoadConfigOptions): LoadedConfig {
  const env = options.env ?? process.env;
  const home = resolve(options.home);
  const projectPath = resolve(options.projectPath ?? process.cwd());
  const sources: Record<string, ConfigSource> = {};
  markSources(DEFAULT_CONFIG as unknown as Record<string, unknown>, "default", sources);

  let merged: Record<string, unknown> = DEFAULT_CONFIG as unknown as Record<string, unknown>;
  const files: string[] = [];

  const globalPath = join(home, "config", "config.toml");
  if (existsSync(globalPath)) {
    const patch = readToml(globalPath);
    merged = deepMerge(merged, patch);
    markSources(patch, "global", sources);
    files.push(globalPath);
  }

  const activeProfile = env.RANN_PROFILE ?? (typeof merged.profile === "string" ? merged.profile : "default");
  const profilePath = join(home, "profiles", activeProfile, "config.toml");
  if (existsSync(profilePath)) {
    const patch = readToml(profilePath);
    merged = deepMerge(merged, patch);
    markSources(patch, "profile", sources);
    files.push(profilePath);
  }

  const projectConfig = join(projectPath, ".rann", "config.toml");
  if (existsSync(projectConfig)) {
    const patch = readToml(projectConfig);
    merged = deepMerge(merged, patch);
    markSources(patch, "project", sources);
    files.push(projectConfig);
  }

  const envPatch: Record<string, unknown> = {};
  if (env.RANN_PROFILE) envPatch.profile = env.RANN_PROFILE;
  if (env.RANN_MODEL) envPatch.model = { default: env.RANN_MODEL };
  if (env.RANN_PROVIDER) envPatch.provider = env.RANN_PROVIDER;
  if (env.RANN_PERMISSION_MODE) envPatch.permissions = { mode: env.RANN_PERMISSION_MODE };
  if (env.RANN_LOG_LEVEL) envPatch.logging = { level: env.RANN_LOG_LEVEL };
  if (env.RANN_NO_COLOR && env.RANN_NO_COLOR !== "0") envPatch.ui = { color: false };
  if (Object.keys(envPatch).length > 0) {
    merged = deepMerge(merged, envPatch);
    markSources(envPatch, "env", sources);
  }

  const flagPatch: Record<string, unknown> = {};
  if (options.overrides?.model) flagPatch.model = { default: options.overrides.model };
  if (options.overrides?.provider) flagPatch.provider = options.overrides.provider;
  if (options.overrides?.permissionMode) flagPatch.permissions = { mode: options.overrides.permissionMode };
  if (options.overrides?.color !== undefined) flagPatch.ui = { color: options.overrides.color };
  if (Object.keys(flagPatch).length > 0) {
    merged = deepMerge(merged, flagPatch);
    markSources(flagPatch, "flag", sources);
  }

  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new RannError("E_CONFIG_INVALID", `Config tidak valid: ${detail}`, {
      data: { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }
    });
  }

  return { config: parsed.data, sources, files, home, projectPath };
}

export function explainKey(loaded: LoadedConfig, key: string): { key: string; value: unknown; source: ConfigSource } {
  const parts = key.split(".").filter(Boolean);
  let value: unknown = loaded.config;
  for (const part of parts) {
    if (!isPlainObject(value) || !(part in value)) {
      throw new RannError("E_NOT_FOUND", `Kunci config tidak ditemukan: ${key}`);
    }
    value = value[part];
  }
  return { key, value, source: loaded.sources[key] ?? "default" };
}

export function providerFor(config: RannConfig, name?: string): ProviderConfig {
  const providerName = name ?? config.provider;
  const provider = config.providers[providerName];
  if (providerName === "mock" && !provider) {
    return providerConfigSchema.parse({ kind: "mock", default_model: "mock-1" });
  }
  if (!provider) {
    throw new RannError("E_CONFIG_INVALID", `Provider tidak dikenal: ${providerName}`, { data: { provider: providerName } });
  }
  return provider;
}
