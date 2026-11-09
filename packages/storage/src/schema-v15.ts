/**
 * Menghubungkan perangkat gateway ke pengguna lokal supaya role dan scopes
 * mengikuti identitas pengguna, bukan nilai statis saat pairing (FR-141).
 */
export const SCHEMA_V15 = `
ALTER TABLE gateway_devices ADD COLUMN user_id TEXT REFERENCES gateway_users(id);
CREATE INDEX IF NOT EXISTS idx_gateway_devices_user ON gateway_devices(user_id);
`;
