/**
 * Migrasi 13: discovery model dan jejak perubahan capability.
 *
 * Model hasil discovery provider perlu bisa ditandai `unavailable` tanpa
 * menghapusnya, dan setiap perubahan capability harus punya sumber yang bisa
 * diaudit. Tanpa kolom ini, daftar model hanya cermin config dan perubahan
 * capability manual tidak meninggalkan jejak.
 */
export const SCHEMA_V13 = `
ALTER TABLE models ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
ALTER TABLE models ADD COLUMN discovered_at INTEGER;
ALTER TABLE models ADD COLUMN capability_source TEXT NOT NULL DEFAULT 'catalog';
CREATE TABLE IF NOT EXISTS model_capability_log (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  capability TEXT NOT NULL,
  old_value INTEGER,
  new_value INTEGER NOT NULL,
  source TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_model_capability_log_model ON model_capability_log(provider, model, changed_at DESC);
`;
