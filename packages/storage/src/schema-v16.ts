/**
 * Tambah status `stale` pada memory_entries. Tabel dibangun ulang karena
 * SQLite tidak bisa mengubah CHECK, lalu FTS dan trigger dibuat ulang.
 */
export const SCHEMA_V16 = `
PRAGMA defer_foreign_keys = ON;
DROP TRIGGER IF EXISTS memory_entries_ai;
DROP TRIGGER IF EXISTS memory_entries_ad;
DROP TRIGGER IF EXISTS memory_entries_au;
CREATE TABLE memory_entries_v16 (
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
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','expired','deleted','stale')),
  expires_at INTEGER,
  last_used_at INTEGER,
  hash TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO memory_entries_v16 (
  id, profile_id, scope, project_id, session_id, project_path, kind, title, text, tags,
  source, confidence, importance, status, expires_at, last_used_at, hash, version, created_at, updated_at
)
SELECT
  id, profile_id, scope, project_id, session_id, project_path, kind, title, text, tags,
  source, confidence, importance, status, expires_at, last_used_at, hash, version, created_at, updated_at
FROM memory_entries;
DROP TABLE memory_entries;
ALTER TABLE memory_entries_v16 RENAME TO memory_entries;
CREATE INDEX IF NOT EXISTS idx_memory_entries_scope ON memory_entries(profile_id, scope, project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_project_path ON memory_entries(project_path, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_status ON memory_entries(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_entries_expires ON memory_entries(expires_at) WHERE expires_at IS NOT NULL;
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
INSERT INTO memory_fts(memory_fts) VALUES ('rebuild');
`;
