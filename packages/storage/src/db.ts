import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_V3 } from "./schema-v3.js";
import { SCHEMA_V4 } from "./schema-v4.js";

export type Db = Database.Database;

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export interface OpenDatabaseOptions {
  path: string;
  backupBeforeMigrate?: boolean;
  backupDir?: string;
  readonly?: boolean;
  migrations?: Migration[];
}

export interface OpenDatabaseResult {
  db: Db;
  applied: number[];
  backupPath?: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  locale TEXT NOT NULL DEFAULT 'id',
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  git_remote TEXT,
  default_branch TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','closed','error')),
  model TEXT NOT NULL,
  permission_mode TEXT NOT NULL CHECK (permission_mode IN ('read-only','ask','accept-edits','trusted','custom')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX idx_sessions_project_status ON sessions(project_id, status);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
  idempotency_key TEXT,
  usage_json TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_turns_session ON turns(session_id, created_at);
CREATE UNIQUE INDEX idx_turns_idem ON turns(session_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content TEXT NOT NULL,
  content_json TEXT,
  token_count INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_messages_turn ON messages(turn_id, created_at);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid',
  tokenize='unicode61'
);
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  result_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','ok','error','denied')),
  exit_code INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tool_calls_turn ON tool_calls(turn_id);
CREATE INDEX idx_tool_calls_name ON tool_calls(tool_name, created_at);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_usage_session ON usage_events(session_id);
CREATE INDEX idx_usage_provider ON usage_events(provider, created_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  decision TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_resource ON audit_log(resource);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  payload_json TEXT NOT NULL,
  published_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_events_session ON events(session_id, seq);
CREATE INDEX idx_events_turn ON events(turn_id, seq);

CREATE TABLE config_kv (
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  scope_id TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (key, scope, scope_id)
);
`
  },
  {
    version: 2,
    name: "memory",
    sql: `
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global','project')),
  project_path TEXT,
  kind TEXT NOT NULL DEFAULT 'fact',
  text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_memories_scope ON memories(scope, project_path, updated_at DESC);
CREATE INDEX idx_memories_updated ON memories(updated_at DESC);

CREATE VIRTUAL TABLE memories_fts USING fts5(
  text,
  tags,
  content='memories',
  content_rowid='rowid',
  tokenize='unicode61'
);
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
  INSERT INTO memories_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
END;
`
  },
  {
    version: 3,
    name: "v1-schema",
    sql: SCHEMA_V3
  },
  {
    version: 4,
    name: "model-and-jobs",
    sql: SCHEMA_V4
  }
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function ensureSchemaTable(db: Db): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);`);
}

function pending(db: Db, migrations: Migration[]): Migration[] {
  const rows = db.prepare("SELECT version, checksum FROM schema_migrations").all() as Array<{ version: number; checksum: string }>;
  const applied = new Map(rows.map((row) => [row.version, row.checksum]));
  const todo: Migration[] = [];
  for (const migration of migrations) {
    const existing = applied.get(migration.version);
    if (existing === undefined) {
      todo.push(migration);
      continue;
    }
    if (existing !== checksum(migration.sql)) {
      throw new Error(`Checksum migrasi ${migration.version} tidak cocok`);
    }
  }
  return todo;
}

function backup(db: Db, backupDir: string): string {
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${backupDir}/rann-${stamp}.db`;
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

export function openDatabase(options: OpenDatabaseOptions): OpenDatabaseResult {
  const path = options.path;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  ensureSchemaTable(db);
  const migrations = options.migrations ?? MIGRATIONS;
  const todo = pending(db, migrations);
  let backupPath: string | undefined;
  if (todo.length > 0 && path !== ":memory:" && options.backupBeforeMigrate !== false && existsSync(path)) {
    const hasRows = (db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c > 0;
    if (hasRows) backupPath = backup(db, options.backupDir ?? `${dirname(path)}/backups`);
  }

  const applied: number[] = [];
  try {
    for (const migration of todo) {
      const run = db.transaction(() => {
        db.exec(migration.sql);
        db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(
          migration.version,
          migration.name,
          checksum(migration.sql),
          Date.now()
        );
      });
      run();
      applied.push(migration.version);
    }
  } catch (error) {
    db.close();
    if (path !== ":memory:" && backupPath && existsSync(backupPath)) {
      copyFileSync(backupPath, path);
      rmSync(`${path}-wal`, { force: true });
      rmSync(`${path}-shm`, { force: true });
      throw new Error(`Migrasi gagal dan database dipulihkan dari ${backupPath}: ${(error as Error).message}`, {
        cause: error
      });
    }
    throw error;
  }

  const result: OpenDatabaseResult = { db, applied };
  if (backupPath) result.backupPath = backupPath;
  return result;
}

export function integrityCheck(db: Db): { ok: boolean; problems: string[] } {
  const integrity = db.pragma("integrity_check", { simple: true }) as string;
  const fk = db.prepare("PRAGMA foreign_key_check").all() as unknown[];
  const problems: string[] = [];
  if (integrity !== "ok") problems.push(`integrity_check: ${integrity}`);
  if (fk.length > 0) problems.push(`foreign_key_check: ${fk.length} baris`);
  return { ok: problems.length === 0, problems };
}

export function schemaVersion(db: Db): number {
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  return row.v ?? 0;
}

export interface DatabaseInspection {
  ok: boolean;
  schemaVersion: number;
  problems: string[];
}

export function inspectDatabase(path: string): DatabaseInspection {
  if (!existsSync(path)) return { ok: false, schemaVersion: 0, problems: ["berkas database belum ada"] };
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const quick = db.pragma("quick_check", { simple: true }) as string;
    const problems: string[] = [];
    if (quick !== "ok") problems.push(`quick_check: ${quick}`);
    let version = 0;
    try {
      version = schemaVersion(db);
    } catch {
      problems.push("tabel schema_migrations tidak ditemukan");
    }
    return { ok: problems.length === 0, schemaVersion: version, problems };
  } finally {
    db.close();
  }
}
