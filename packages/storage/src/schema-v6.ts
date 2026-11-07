export const SCHEMA_V6 = `
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  criteria_json TEXT NOT NULL DEFAULT '[]',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  progress_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','failed','cancelled','superseded')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user','replan','agent')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_goals_active ON goals(session_id) WHERE status = 'active';
CREATE INDEX idx_goals_session ON goals(session_id, updated_at DESC);
`;
