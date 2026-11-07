import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authenticate,
  createSession,
  gatewayStats,
  getMappedSession,
  hasScope,
  hashToken,
  issuePairCode,
  listDevices,
  mapSession,
  openDatabase,
  recordGatewayMessage,
  redeemPairCode,
  revokeDevice,
  scopesForRole,
  updateDeviceRole,
  type Db
} from "./index.js";

const opened: Db[] = [];

function setup(): Db {
  const dir = mkdtempSync(join(tmpdir(), "rann-gateway-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe("gateway storage", () => {
  it("memetakan role ke scope dan admin mencakup semua", () => {
    expect(scopesForRole("owner")).toEqual(["read", "run", "approve", "admin"]);
    expect(scopesForRole("operator")).toEqual(["read", "run", "approve"]);
    expect(scopesForRole("approver")).toEqual(["read", "approve"]);
    expect(scopesForRole("viewer")).toEqual(["read"]);
    expect(hasScope(["read"], "approve")).toBe(false);
    expect(hasScope(["admin"], "run")).toBe(true);
  });

  it("menukar kode pairing sekali saja", () => {
    const db = setup();
    const { code, expiresAt } = issuePairCode(db, { createdBy: "local" });
    expect(code).toHaveLength(8);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const first = redeemPairCode(db, { code, name: "laptop" });
    expect("token" in first).toBe(true);
    if (!("token" in first)) return;
    expect(first.token.startsWith("rann_")).toBe(true);
    expect(first.device.role).toBe("operator");
    expect(authenticate(db, first.token)?.id).toBe(first.device.id);

    const second = redeemPairCode(db, { code, name: "lain" });
    expect(second).toEqual({ error: "used" });
  });

  it("menolak kode kedaluwarsa dan kode asing", () => {
    const db = setup();
    const { code } = issuePairCode(db, { createdBy: "local" });
    db.prepare("UPDATE gateway_pair_codes SET expires_at = ? WHERE code_hash = ?").run(Date.now() - 1, hashToken(code));
    expect(redeemPairCode(db, { code, name: "laptop" })).toEqual({ error: "expired" });
    expect(redeemPairCode(db, { code: "ZZZZZZZZ", name: "laptop" })).toEqual({ error: "invalid" });
  });

  it("mencabut perangkat memutus autentikasi dan mengubah role memperbarui scope", () => {
    const db = setup();
    const { code } = issuePairCode(db, { createdBy: "local" });
    const result = redeemPairCode(db, { code, name: "hp" });
    if (!("token" in result)) throw new Error("pairing gagal");

    const promoted = updateDeviceRole(db, result.device.id, "owner");
    expect(promoted?.scopes).toEqual(["read", "run", "approve", "admin"]);
    expect(authenticate(db, result.token)?.role).toBe("owner");

    expect(revokeDevice(db, result.device.id)).toBe(true);
    expect(revokeDevice(db, result.device.id)).toBe(false);
    expect(authenticate(db, result.token)).toBeUndefined();
    expect(listDevices(db)[0]?.revoked_at).toBeTypeOf("number");
  });

  it("memetakan sesi per kanal dan mencatat pesan", () => {
    const db = setup();
    const { code } = issuePairCode(db, { createdBy: "local" });
    const result = redeemPairCode(db, { code, name: "web" });
    if (!("token" in result)) throw new Error("pairing gagal");

    expect(getMappedSession(db, result.device.id, "web", "utama")).toBeUndefined();
    const sessionOne = createSession(db, { title: "satu", model: "mock", permissionMode: "ask" });
    const sessionTwo = createSession(db, { title: "dua", model: "mock", permissionMode: "ask" });
    mapSession(db, { deviceId: result.device.id, sessionId: sessionOne.id, channel: "web", channelKey: "utama" });
    expect(getMappedSession(db, result.device.id, "web", "utama")).toBe(sessionOne.id);
    mapSession(db, { deviceId: result.device.id, sessionId: sessionTwo.id, channel: "web", channelKey: "utama" });
    expect(getMappedSession(db, result.device.id, "web", "utama")).toBe(sessionTwo.id);

    recordGatewayMessage(db, { deviceId: result.device.id, channel: "web", channelKey: "utama", direction: "in", body: "halo" });
    recordGatewayMessage(db, { channel: "telegram", channelKey: "42", direction: "out", body: "balas" });
    expect(gatewayStats(db)).toMatchObject({ devices: 1, active_devices: 1, sessions: 1, messages: 2 });
  });
});
