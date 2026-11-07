export const SCHEMA_V7 = `
CREATE TABLE turn_runtime (
  turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','stalled','done','failed','cancelled')),
  max_runtime_ms INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  last_heartbeat_at INTEGER NOT NULL,
  stalled_at INTEGER,
  stall_reason TEXT,
  ended_at INTEGER
);
CREATE INDEX idx_turn_runtime_status ON turn_runtime(status, last_heartbeat_at);
`;
