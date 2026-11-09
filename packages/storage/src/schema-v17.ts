/** Tabel embedding memori terpisah agar kegagalan embedding bisa di-retry (AC-071). */
export const SCHEMA_V17 = `
CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id TEXT PRIMARY KEY REFERENCES memory_entries(id) ON DELETE CASCADE,
  vector_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready','pending')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_status ON memory_embeddings(status, next_retry_at);
`;
