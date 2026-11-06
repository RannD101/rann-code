/**
 * Migrasi 3: skema data V1.
 *
 * Tabel lama yang sudah dipakai (profiles, projects, sessions, turns, messages,
 * tool_calls, usage_events, audit_log, events, config_kv) dipertahankan.
 * Tabel memories dimigrasikan ke memory_entries dengan kolom yang dibutuhkan
 * PRD, lalu FTS lama diganti memory_fts.
 */
export const SCHEMA_V3 = `
INSERT INTO profiles (id, name, locale, settings_json, created_at, updated_at)
SELECT 'prof_default', 'default', 'id', '{}',
       CAST(strftime('%s', 'now') AS INTEGER) * 1000,
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE name = 'default');

CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('global','project','session')),
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  project_path TEXT,
  kind TEXT NOT NULL DEFAULT 'fact',
  title TEXT,
  text TEXT NOT NULL,
  content TEXT GENERATED ALWAYS AS (text) VIRTUAL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  importance REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','expired','deleted')),
  expires_at INTEGER,
  last_used_at INTEGER,
  hash TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_memory_entries_scope ON memory_entries(profile_id, scope, project_id, updated_at DESC);
CREATE INDEX idx_memory_entries_project_path ON memory_entries(project_path, updated_at DESC);
CREATE INDEX idx_memory_entries_status ON memory_entries(status, updated_at DESC);
CREATE INDEX idx_memory_entries_expires ON memory_entries(expires_at) WHERE expires_at IS NOT NULL;

INSERT INTO memory_entries
  (id, profile_id, scope, project_id, session_id, project_path, kind, title, text, tags, source,
   confidence, importance, status, expires_at, last_used_at, hash, version, created_at, updated_at)
SELECT id, 'prof_default', scope, NULL, NULL, project_path, kind, NULL, text, tags, source,
       1.0, 0.5, 'active', NULL, NULL, NULL, 1, created_at, updated_at
FROM memories;

DROP TRIGGER IF EXISTS memories_ai;
DROP TRIGGER IF EXISTS memories_ad;
DROP TRIGGER IF EXISTS memories_au;
DROP TABLE IF EXISTS memories_fts;
DROP TABLE memories;

CREATE VIRTUAL TABLE memory_fts USING fts5(
  text,
  tags,
  content='memory_entries',
  content_rowid='rowid',
  tokenize='unicode61'
);
CREATE TRIGGER memory_entries_ai AFTER INSERT ON memory_entries BEGIN
  INSERT INTO memory_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
END;
CREATE TRIGGER memory_entries_ad AFTER DELETE ON memory_entries BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
END;
CREATE TRIGGER memory_entries_au AFTER UPDATE ON memory_entries BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text, tags) VALUES ('delete', old.rowid, old.text, old.tags);
  INSERT INTO memory_fts(rowid, text, tags) VALUES (new.rowid, new.text, new.tags);
END;

CREATE TABLE memory_links (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'related',
  created_at INTEGER NOT NULL,
  UNIQUE (from_id, to_id, relation)
);
CREATE INDEX idx_memory_links_from ON memory_links(from_id);
CREATE INDEX idx_memory_links_to ON memory_links(to_id);

CREATE TABLE memory_events (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created','updated','deleted','retrieved','expired','merged','restored')),
  actor TEXT NOT NULL DEFAULT 'system',
  before_json TEXT,
  after_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_memory_events_memory ON memory_events(memory_id, created_at DESC);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','blocked','done','failed','cancelled')),
  version INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_plans_session ON plans(session_id, created_at DESC);
CREATE INDEX idx_plans_status ON plans(status, updated_at DESC);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'worker',
  parent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','blocked','waiting','done','failed','cancelled')),
  model TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'read-only' CHECK (permission_mode IN ('read-only','ask','accept-edits','trusted','custom')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_agents_parent ON agents(parent_id);
CREATE INDEX idx_agents_status ON agents(status);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  assignee_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','blocked','done','failed','cancelled','paused')),
  priority INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);
CREATE INDEX idx_tasks_session ON tasks(session_id, created_at);
CREATE INDEX idx_tasks_plan ON tasks(plan_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_agent_id, status);

CREATE TABLE task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','skipped','cancelled')),
  input_json TEXT,
  output_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  UNIQUE (task_id, idx)
);
CREATE INDEX idx_task_steps_task ON task_steps(task_id, idx);

CREATE TABLE plan_nodes (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES plan_nodes(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'step',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','running','done','failed','skipped','blocked')),
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_plan_nodes_plan ON plan_nodes(plan_id, created_at);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('queued','running','done','failed','cancelled')),
  usage_json TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_runs_agent ON agent_runs(agent_id, created_at DESC);
CREATE INDEX idx_agent_runs_session ON agent_runs(session_id, created_at DESC);

CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  from_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('task','message','result','error','cancel')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_messages_run ON agent_messages(run_id, created_at);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  path TEXT,
  source TEXT NOT NULL DEFAULT 'local',
  version TEXT NOT NULL DEFAULT '1.0.0',
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (profile_id, name)
);
CREATE INDEX idx_skills_source ON skills(source, enabled);

CREATE TABLE skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (skill_id, version)
);

CREATE TABLE tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  permission TEXT NOT NULL DEFAULT 'read' CHECK (permission IN ('read','write','execute','network','dangerous')),
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  idempotent INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'builtin',
  enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tools_category ON tools(category, enabled);

CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  command TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]',
  env_json TEXT NOT NULL DEFAULT '{}',
  cwd TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('stopped','starting','ready','error')),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL DEFAULT '1.0.0',
  path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE hooks (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  matcher TEXT,
  command TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_hooks_event ON hooks(event, enabled, priority);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  base_url TEXT,
  api_key_ref TEXT,
  default_model TEXT,
  models_json TEXT NOT NULL DEFAULT '[]',
  headers_json TEXT NOT NULL DEFAULT '{}',
  timeout_ms INTEGER NOT NULL DEFAULT 120000,
  stream INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT,
  context_window INTEGER,
  max_output_tokens INTEGER,
  input_price REAL,
  output_price REAL,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider_id, name)
);
CREATE INDEX idx_models_provider ON models(provider_id);

CREATE TABLE model_capabilities (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT 'true',
  created_at INTEGER NOT NULL,
  UNIQUE (model_id, capability)
);

CREATE TABLE routing_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  requested_model TEXT,
  selected_model TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  fallback_chain_json TEXT NOT NULL DEFAULT '[]',
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_routing_logs_session ON routing_logs(session_id, created_at DESC);

CREATE TABLE scheduler_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schedule TEXT NOT NULL,
  command TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_scheduler_jobs_next ON scheduler_jobs(enabled, next_run_at);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES scheduler_jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  started_at INTEGER,
  ended_at INTEGER,
  output TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_job_runs_job ON job_runs(job_id, created_at DESC);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'turn' CHECK (kind IN ('turn','manual','pre_tool','post_tool','pre_restore')),
  state_json TEXT NOT NULL DEFAULT '{}',
  git_ref TEXT,
  files_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_checkpoints_session ON checkpoints(session_id, created_at DESC);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  tool_call_id TEXT REFERENCES tool_calls(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  path TEXT NOT NULL,
  hash TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_session ON artifacts(session_id, created_at DESC);

CREATE TABLE path_leases (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  owner_agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL
);
CREATE INDEX idx_path_leases_expires ON path_leases(expires_at);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  tool_call_id TEXT REFERENCES tool_calls(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow','deny','always')),
  scope TEXT NOT NULL DEFAULT 'once' CHECK (scope IN ('once','session','always')),
  reason TEXT,
  decided_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX idx_approvals_lookup ON approvals(session_id, tool_name, args_hash, created_at DESC);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','committed','rolled_back','failed')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_transactions_session ON transactions(session_id, created_at DESC);

CREATE TABLE file_changes (
  id TEXT PRIMARY KEY,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  before_text TEXT,
  after_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','reverted','failed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_file_changes_transaction ON file_changes(transaction_id);
CREATE INDEX idx_file_changes_path ON file_changes(path, created_at DESC);

ALTER TABLE audit_log ADD COLUMN session_id TEXT;
ALTER TABLE audit_log ADD COLUMN turn_id TEXT;
ALTER TABLE audit_log ADD COLUMN tool_call_id TEXT;
ALTER TABLE audit_log ADD COLUMN trace_id TEXT;
CREATE INDEX idx_audit_session ON audit_log(session_id, created_at DESC);

ALTER TABLE turns ADD COLUMN trace_id TEXT;
ALTER TABLE events ADD COLUMN trace_id TEXT;
ALTER TABLE usage_events ADD COLUMN trace_id TEXT;
ALTER TABLE usage_events ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_usage_trace ON usage_events(trace_id);
`;
