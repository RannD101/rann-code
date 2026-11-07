export const SCHEMA_V8 = `
CREATE TABLE gateway_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  profile TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('owner','operator','viewer','approver')),
  scopes TEXT NOT NULL DEFAULT 'read',
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX idx_gateway_devices_profile ON gateway_devices(profile, revoked_at);

CREATE TABLE gateway_pair_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_gateway_pair_expiry ON gateway_pair_codes(expires_at);

CREATE TABLE gateway_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('owner','operator','viewer','approver')),
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE TABLE gateway_sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES gateway_devices(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'web',
  channel_key TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_gateway_sessions_key ON gateway_sessions(device_id, channel, channel_key);
CREATE INDEX idx_gateway_sessions_session ON gateway_sessions(session_id);

CREATE TABLE gateway_messages (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  channel TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT NOT NULL,
  external_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_gateway_messages_channel ON gateway_messages(channel, channel_key, created_at);
`;
