import { existsSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets, type RannConfig } from "@rann/shared";
import {
  listSchedulers,
  listSessions,
  listTasks,
  summarizeUsage,
  sumCostSince,
  type Db
} from "@rann/storage";
import type { LoadedConfig } from "@rann/shared";
import type { Layout } from "./paths.js";
import { SkillStore } from "./skills.js";
import { toolSpecs } from "./tools/index.js";

function count(db: Db, table: string, where = "", ...params: unknown[]): number {
  try {
    return (db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get(...params) as { c: number }).c;
  } catch {
    return 0;
  }
}

function rows<T>(db: Db, sql: string, ...params: unknown[]): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

function startOfToday(): number {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(key|token|secret|password|passwd|credential|authorization|cookie)/i.test(key)) {
      output[key] = item === undefined || item === null || item === "" ? item : "[REDACTED]";
      continue;
    }
    output[key] = redactDeep(item);
  }
  return output;
}

export function overview(db: Db): Record<string, unknown> {
  const today = startOfToday();
  const costToday = sumCostSince(db, today);
  const costTotal = sumCostSince(db, 0);
  return {
    counts: {
      sessions: count(db, "sessions"),
      sessions_active: count(db, "sessions", "WHERE status = 'active'"),
      turns: count(db, "turns"),
      turns_today: count(db, "turns", "WHERE created_at >= ?", today),
      tasks: count(db, "tasks"),
      tasks_running: count(db, "tasks", "WHERE status = 'running'"),
      cost_today: costToday.knownUsd,
      cost_total: costTotal.knownUsd,
      jobs_queued: count(db, "jobs", "WHERE status = 'queued'"),
      jobs_running: count(db, "jobs", "WHERE status = 'running'"),
      schedulers: count(db, "scheduler_jobs"),
      schedulers_active: count(db, "scheduler_jobs", "WHERE enabled = 1"),
      devices: count(db, "gateway_devices"),
      devices_active: count(db, "gateway_devices", "WHERE revoked_at IS NULL"),
      audit: count(db, "audit_log")
    },
    recent: rows(
      db,
      "SELECT type, session_id, created_at FROM events ORDER BY seq DESC LIMIT 12"
    )
  };
}

export function dashboardData(
  db: Db,
  config: LoadedConfig,
  layout: Layout,
  page: string,
  params: { sessionId?: string; limit?: number } = {}
): Record<string, unknown> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  if (page === "overview") return overview(db);
  if (page === "sessions") {
    return { items: listSessions(db, { limit }) };
  }
  if (page === "tasks") {
    const items = params.sessionId
      ? listTasks(db, params.sessionId)
      : rows(db, "SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?", limit);
    return { items };
  }
  if (page === "agents") {
    return { items: rows(db, "SELECT * FROM agents ORDER BY updated_at DESC LIMIT ?", limit) };
  }
  if (page === "plans") {
    return {
      items: rows(db, "SELECT * FROM plans ORDER BY updated_at DESC LIMIT ?", limit)
    };
  }
  if (page === "models") {
    return {
      items: rows(
        db,
        `SELECT models.id, models.name, models.display_name, models.context_window, models.input_price, models.output_price,
                providers.name AS provider
         FROM models JOIN providers ON providers.id = models.provider_id
         ORDER BY providers.name, models.name LIMIT ?`,
        limit
      )
    };
  }
  if (page === "providers") {
    return {
      items: rows(
        db,
        "SELECT name, kind, base_url, default_model, enabled FROM providers ORDER BY name LIMIT ?",
        limit
      )
    };
  }
  if (page === "skills") {
    const store = new SkillStore(layout.profileDir, config.projectPath);
    return { items: store.list(limit) };
  }
  if (page === "memory") {
    return {
      items: rows(
        db,
        "SELECT id, text AS content, scope, kind, importance, created_at FROM memory_entries ORDER BY created_at DESC LIMIT ?",
        limit
      )
    };
  }
  if (page === "tools") {
    const recorded = rows(
      db,
      "SELECT name, category, permission AS risk, enabled FROM tools ORDER BY name LIMIT ?",
      limit
    );
    if (recorded.length > 0) return { items: recorded };
    return {
      items: toolSpecs()
        .slice(0, limit)
        .map((spec) => ({ name: spec.name, category: "builtin", risk: "baca", enabled: 1 }))
    };
  }
  if (page === "mcp") {
    const configured = Object.entries(config.config.mcp.servers).map(([name, server]) => ({
      name,
      command: server.command,
      status: server.enabled ? "configured" : "nonaktif",
      enabled: server.enabled ? 1 : 0
    }));
    const recorded = rows(
      db,
      "SELECT name, command, status, enabled FROM mcp_servers ORDER BY name LIMIT ?",
      limit
    );
    return { items: recorded.length > 0 ? recorded : configured };
  }
  if (page === "plugins") {
    return {
      items: rows(db, "SELECT name, version, enabled, path FROM plugins ORDER BY name LIMIT ?", limit)
    };
  }
  if (page === "scheduler") {
    return { items: listSchedulers(db) };
  }
  if (page === "logs") {
    return {
      items: rows(
        db,
        "SELECT seq AS id, type, session_id, created_at, data_json AS payload FROM events ORDER BY seq DESC LIMIT ?",
        limit
      )
    };
  }
  if (page === "usage") {
    return {
      items: summarizeUsage(db, params.sessionId),
      total: sumCostSince(db, 0),
      today: sumCostSince(db, startOfToday())
    };
  }
  if (page === "permissions") {
    return {
      mode: config.config.permissions.mode,
      workspace_only: config.config.permissions.workspace_only,
      allow: config.config.permissions.allow,
      deny: config.config.permissions.deny
    };
  }
  if (page === "settings") {
    return {
      config: redactDeep(config.config) as RannConfig,
      files: [
        join(config.home, "config", "config.toml"),
        join(layout.profileDir, "config.toml"),
        ...(config.projectPath ? [join(config.projectPath, ".rann", "config.toml")] : [])
      ].filter((path) => existsSync(path)),
      db: { path: layout.dbPath, schema: count(db, "schema_migrations") }
    };
  }
  if (page === "gateway") {
    return {
      devices: rows(db, "SELECT * FROM gateway_devices ORDER BY created_at DESC LIMIT ?", limit),
      stats: {
        devices: count(db, "gateway_devices"),
        active_devices: count(db, "gateway_devices", "WHERE revoked_at IS NULL"),
        sessions: count(db, "gateway_sessions"),
        messages: count(db, "gateway_messages")
      },
      status: {
        running: config.config.gateway.enabled,
        host: config.config.gateway.host,
        port: config.config.gateway.port
      }
    };
  }
  return { items: [] };
}

export function configSummary(config: LoadedConfig, layout: Layout): Record<string, unknown> {
  return {
    config: redactSecrets(JSON.stringify(redactDeep(config.config))),
    files: config.files,
    home: layout.home,
    profile: layout.profile,
    project: config.projectPath
  };
}
