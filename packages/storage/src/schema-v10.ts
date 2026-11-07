export const SCHEMA_V10 = `
ALTER TABLE agents ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE agents ADD COLUMN turn_id TEXT;
ALTER TABLE agents ADD COLUMN parent_turn_id TEXT;
ALTER TABLE agents ADD COLUMN profile TEXT;
ALTER TABLE agents ADD COLUMN goal TEXT;
ALTER TABLE agents ADD COLUMN depth INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN path TEXT;
ALTER TABLE agents ADD COLUMN steps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN heartbeat_at INTEGER;
ALTER TABLE agents ADD COLUMN result_json TEXT;
ALTER TABLE agents ADD COLUMN finished_at INTEGER;
CREATE INDEX idx_agents_session ON agents(session_id);
CREATE INDEX idx_agents_heartbeat ON agents(status, heartbeat_at);

CREATE TABLE subagent_messages (
  id TEXT PRIMARY KEY,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  refs_json TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_subagent_messages_to ON subagent_messages(to_agent, created_at);
`;
