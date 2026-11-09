/**
 * SQLite tidak bisa mengubah CHECK constraint, jadi tabel agents dibangun ulang
 * untuk menambah status `starting` dan `orphaned` (FR-061).
 */
export const SCHEMA_V14 = `
PRAGMA defer_foreign_keys = ON;
CREATE TABLE agents_v14 (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'worker',
  parent_id TEXT REFERENCES agents_v14(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('starting','idle','running','blocked','waiting','done','failed','cancelled','orphaned')),
  model TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'read-only' CHECK (permission_mode IN ('read-only','ask','accept-edits','trusted','custom')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT,
  parent_turn_id TEXT,
  profile TEXT,
  goal TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  path TEXT,
  steps INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  heartbeat_at INTEGER,
  result_json TEXT,
  finished_at INTEGER
);
INSERT INTO agents_v14 (
  id, profile_id, name, role, parent_id, status, model, permission_mode, metadata_json,
  created_at, updated_at, session_id, turn_id, parent_turn_id, profile, goal, depth, path,
  steps, cost_usd, heartbeat_at, result_json, finished_at
)
SELECT
  id, profile_id, name, role, parent_id, status, model, permission_mode, metadata_json,
  created_at, updated_at, session_id, turn_id, parent_turn_id, profile, goal, depth, path,
  steps, cost_usd, heartbeat_at, result_json, finished_at
FROM agents;
DROP TABLE agents;
ALTER TABLE agents_v14 RENAME TO agents;
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);
CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(status, heartbeat_at);
`;
