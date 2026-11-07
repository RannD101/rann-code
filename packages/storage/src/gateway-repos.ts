import { createHash, randomBytes } from "node:crypto";
import { newId } from "@rann/shared";
import type { Db } from "./db.js";

export type GatewayRole = "owner" | "operator" | "viewer" | "approver";
export type GatewayScope = "read" | "run" | "approve" | "admin";

export interface GatewayDeviceRow {
  id: string;
  name: string;
  profile: string;
  role: GatewayRole;
  scopes: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

export interface GatewayDeviceView {
  id: string;
  name: string;
  profile: string;
  role: GatewayRole;
  scopes: GatewayScope[];
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

const ROLE_SCOPES: Record<GatewayRole, GatewayScope[]> = {
  owner: ["read", "run", "approve", "admin"],
  operator: ["read", "run", "approve"],
  approver: ["read", "approve"],
  viewer: ["read"]
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIR_TTL_MS = 10 * 60_000;

export function scopesForRole(role: GatewayRole): GatewayScope[] {
  return [...ROLE_SCOPES[role]];
}

export function hasScope(scopes: GatewayScope[], wanted: GatewayScope): boolean {
  return scopes.includes("admin") || scopes.includes(wanted);
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += CODE_ALPHABET[bytes[index]! % CODE_ALPHABET.length];
  }
  return out;
}

export function issuePairCode(
  db: Db,
  input: { createdBy: string; ttlMs?: number } = { createdBy: "local" }
): { code: string; expiresAt: number } {
  const at = Date.now();
  const code = randomCode();
  const expiresAt = at + Math.min(Math.max(input.ttlMs ?? PAIR_TTL_MS, 60_000), PAIR_TTL_MS);
  db.prepare("DELETE FROM gateway_pair_codes WHERE expires_at <= ? OR used_at IS NOT NULL").run(at);
  db.prepare(
    "INSERT INTO gateway_pair_codes (id, code_hash, created_by, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)"
  ).run(newId("pair"), hashToken(code), input.createdBy, expiresAt, at);
  return { code, expiresAt };
}

export function redeemPairCode(
  db: Db,
  input: { code: string; name: string; profile?: string; role?: GatewayRole }
): { device: GatewayDeviceView; token: string } | { error: "invalid" | "expired" | "used" } {
  const codeHash = hashToken(input.code.trim().toUpperCase());
  const row = db.prepare("SELECT * FROM gateway_pair_codes WHERE code_hash = ?").get(codeHash) as
    | { id: string; expires_at: number; used_at: number | null }
    | undefined;
  if (!row) return { error: "invalid" };
  if (row.used_at !== null) return { error: "used" };
  if (row.expires_at <= Date.now()) return { error: "expired" };
  const role = input.role ?? "operator";
  const token = `rann_${randomBytes(32).toString("base64url")}`;
  const at = Date.now();
  const id = newId("dev");
  const transaction = db.transaction(() => {
    const marked = db
      .prepare("UPDATE gateway_pair_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
      .run(at, row.id);
    if (marked.changes !== 1) throw new Error("pair code already used");
    db.prepare(
      `INSERT INTO gateway_devices (id, name, profile, role, scopes, token_hash, created_at, last_seen_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      id,
      input.name.slice(0, 80) || "perangkat",
      input.profile ?? "default",
      role,
      scopesForRole(role).join(","),
      hashToken(token),
      at,
      at
    );
  });
  try {
    transaction();
  } catch {
    return { error: "used" };
  }
  const device = getDevice(db, id);
  if (!device) return { error: "invalid" };
  return { device, token };
}

function toView(row: GatewayDeviceRow): GatewayDeviceView {
  return {
    id: row.id,
    name: row.name,
    profile: row.profile,
    role: row.role,
    scopes: row.scopes.split(",").filter(Boolean) as GatewayScope[],
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    revoked_at: row.revoked_at
  };
}

export function getDevice(db: Db, id: string): GatewayDeviceView | undefined {
  const row = db.prepare("SELECT * FROM gateway_devices WHERE id = ?").get(id) as GatewayDeviceRow | undefined;
  return row ? toView(row) : undefined;
}

export function authenticate(
  db: Db,
  token: string,
  profile = "default"
): GatewayDeviceView | undefined {
  if (!token.startsWith("rann_")) return undefined;
  const row = db.prepare("SELECT * FROM gateway_devices WHERE token_hash = ?").get(hashToken(token)) as
    | GatewayDeviceRow
    | undefined;
  if (!row || row.revoked_at !== null || row.profile !== profile) return undefined;
  db.prepare("UPDATE gateway_devices SET last_seen_at = ? WHERE id = ?").run(Date.now(), row.id);
  return toView(row);
}

export function listDevices(db: Db): GatewayDeviceView[] {
  return (db.prepare("SELECT * FROM gateway_devices ORDER BY created_at DESC").all() as GatewayDeviceRow[]).map(toView);
}

export function revokeDevice(db: Db, id: string): boolean {
  const changed = db
    .prepare("UPDATE gateway_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(Date.now(), id);
  return changed.changes === 1;
}

export function updateDeviceRole(db: Db, id: string, role: GatewayRole): GatewayDeviceView | undefined {
  db.prepare("UPDATE gateway_devices SET role = ?, scopes = ? WHERE id = ?").run(
    role,
    scopesForRole(role).join(","),
    id
  );
  return getDevice(db, id);
}

export function getMappedSession(
  db: Db,
  deviceId: string,
  channel: string,
  channelKey: string
): string | undefined {
  const row = db
    .prepare("SELECT session_id FROM gateway_sessions WHERE device_id = ? AND channel = ? AND channel_key = ?")
    .get(deviceId, channel, channelKey) as { session_id: string } | undefined;
  return row?.session_id;
}

export function mapSession(
  db: Db,
  input: { deviceId: string; sessionId: string; channel: string; channelKey: string }
): void {
  const at = Date.now();
  const existing = getMappedSession(db, input.deviceId, input.channel, input.channelKey);
  if (existing) {
    db.prepare(
      "UPDATE gateway_sessions SET session_id = ?, updated_at = ? WHERE device_id = ? AND channel = ? AND channel_key = ?"
    ).run(input.sessionId, at, input.deviceId, input.channel, input.channelKey);
    return;
  }
  db.prepare(
    `INSERT INTO gateway_sessions (id, device_id, session_id, channel, channel_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(newId("gws"), input.deviceId, input.sessionId, input.channel, input.channelKey, at, at);
}

export function recordGatewayMessage(
  db: Db,
  input: { deviceId?: string; channel: string; channelKey: string; direction: "in" | "out"; body: string; externalId?: string }
): void {
  db.prepare(
    `INSERT INTO gateway_messages (id, device_id, channel, channel_key, direction, body, external_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("msgx"),
    input.deviceId ?? null,
    input.channel,
    input.channelKey,
    input.direction,
    input.body.slice(0, 100_000),
    input.externalId ?? null,
    Date.now()
  );
}

export function gatewayStats(db: Db): {
  devices: number;
  active_devices: number;
  sessions: number;
  messages: number;
} {
  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { c: number }).c;
  return {
    devices: count("SELECT COUNT(*) AS c FROM gateway_devices"),
    active_devices: count("SELECT COUNT(*) AS c FROM gateway_devices WHERE revoked_at IS NULL"),
    sessions: count("SELECT COUNT(*) AS c FROM gateway_sessions"),
    messages: count("SELECT COUNT(*) AS c FROM gateway_messages")
  };
}
