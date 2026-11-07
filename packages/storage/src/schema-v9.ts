export const SCHEMA_V9 = `
CREATE TABLE IF NOT EXISTS messaging_state (
  channel TEXT PRIMARY KEY,
  cursor TEXT,
  updated_at INTEGER NOT NULL
);
`;
