/**
 * Migrasi 12: memori prosedural dan jejak pemakaian memori.
 */
export const SCHEMA_V12 = `
CREATE TABLE procedures (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_path TEXT,
  agent TEXT,
  name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  prerequisites TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL,
  verification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','active','stale','rejected')),
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_procedures_name ON procedures(profile_id, COALESCE(project_path, ''), name);
CREATE INDEX idx_procedures_status ON procedures(status, updated_at DESC);

CREATE TABLE agent_memory_access (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  memory_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  allowed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_agent_memory_access ON agent_memory_access(profile_id, agent, memory_id);
`;
