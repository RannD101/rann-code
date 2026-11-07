export const SCHEMA_V4 = `
ALTER TABLE turns ADD COLUMN model TEXT;
ALTER TABLE turns ADD COLUMN cost_usd REAL;

ALTER TABLE usage_events ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN provider_request_id TEXT;
ALTER TABLE usage_events ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unknown';

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  queue TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled','dead')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  idempotency_key TEXT,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  heartbeat_at INTEGER,
  next_run_at INTEGER NOT NULL,
  last_error TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_jobs_claim ON jobs(status, queue, priority, next_run_at);
CREATE UNIQUE INDEX idx_jobs_idem ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_jobs_lease ON jobs(status, lease_expires_at);

CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_job_events_job ON job_events(job_id, created_at);

ALTER TABLE scheduler_jobs ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE scheduler_jobs ADD COLUMN misfire_policy TEXT NOT NULL DEFAULT 'run_once';
ALTER TABLE scheduler_jobs ADD COLUMN overlap_policy TEXT NOT NULL DEFAULT 'skip';
ALTER TABLE scheduler_jobs ADD COLUMN catch_up INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scheduler_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;

ALTER TABLE job_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE job_runs ADD COLUMN scheduled_for INTEGER;
ALTER TABLE job_runs ADD COLUMN duration_ms INTEGER;
`;
