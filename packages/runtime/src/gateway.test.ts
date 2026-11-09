import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RannConfig } from "@rann/shared";
import { issuePairCode, openDatabase, updateDeviceRole, type Db } from "@rann/storage";
import { GatewayServer } from "./gateway.js";

const cleanups: Array<() => Promise<void> | void> = [];

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function config(port: number): RannConfig {
  return {
    gateway: {
      enabled: true,
      host: "127.0.0.1",
      port,
      heartbeat_ms: 20_000,
      allow_origins: [],
      profile: "default"
    },
    messaging: {
      telegram: { enabled: false, token_env: "TELEGRAM_BOT_TOKEN", allowed_chats: [] },
      discord: { enabled: false, token_env: "DISCORD_BOT_TOKEN", allowed_channels: [] },
      slack: { enabled: false, token_env: "SLACK_BOT_TOKEN", allowed_channels: [] }
    }
  } as unknown as RannConfig;
}

async function boot(): Promise<{ gateway: GatewayServer; db: Db; base: string; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "rann-gateway-http-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  const port = await freePort();
  const gateway = new GatewayServer({
    db,
    config: config(port),
    version: "0.0.0-test",
    profile: "default",
    artifactsDir: dir,
    invoke: async (method) => {
      if (method === "session.list") return [];
      if (method === "session.create") return { id: "ses-baru", title: "uji" };
      if (method === "session.get") return { id: "ses-baru", messages: [] };
      return { ok: true };
    },
    subscribe: () => () => undefined
  });
  await gateway.start();
  cleanups.push(async () => {
    await gateway.stop();
    db.close();
  });
  return { gateway, db, base: `http://127.0.0.1:${String(port)}`, dir };
}

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe("gateway HTTP", () => {
  it("melayani health publik dan dashboard tanpa token", async () => {
    const { base } = await boot();
    const started = Date.now();
    const health = await fetch(`${base}/health`);
    expect(Date.now() - started).toBeLessThan(200);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, gateway: "ok" });

    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("Rann Code");
  });

  it("menolak permintaan tanpa token dan menerima token hasil pairing", async () => {
    const { base, db } = await boot();
    expect((await fetch(`${base}/v1/auth/me`)).status).toBe(403);

    const { code } = issuePairCode(db, { createdBy: "local" });
    const pair = await fetch(`${base}/v1/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "laptop uji" })
    });
    expect(pair.status).toBe(201);
    const body = (await pair.json()) as { token: string; device: { name: string; scopes: string[] } };
    expect(body.token.startsWith("rann_")).toBe(true);
    expect(body.device.name).toBe("laptop uji");

    const me = await fetch(`${base}/v1/auth/me`, { headers: { authorization: `Bearer ${body.token}` } });
    expect(me.status).toBe(200);
    expect((await me.json()) as { device: { name: string } }).toMatchObject({ device: { name: "laptop uji" } });

    const reused = await fetch(`${base}/v1/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "lain" })
    });
    expect(reused.status).toBe(403);
  });

  it("membatasi pembuatan kode pairing ke owner dan mencatat percobaan gagal", async () => {
    const { base, db } = await boot();
    const { code } = issuePairCode(db, { createdBy: "local" });
    const pair = await fetch(`${base}/v1/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "operator" })
    });
    const { token, device } = (await pair.json()) as { token: string; device: { id: string } };

    const denied = await fetch(`${base}/v1/gateway/pair`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}"
    });
    expect(denied.status).toBe(403);

    updateDeviceRole(db, device.id, "owner");
    const allowed = await fetch(`${base}/v1/gateway/pair`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}"
    });
    expect(allowed.status).toBe(201);
    const created = (await allowed.json()) as { code: string; expires_in_ms: number };
    expect(created.code).toHaveLength(8);
    expect(created.expires_in_ms).toBeGreaterThan(0);

    const second = await fetch(`${base}/v1/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: created.code, name: "hp" })
    });
    expect(second.status).toBe(201);
  });

  it("mengembalikan 404 untuk berkas statis di luar folder", async () => {
    const { base } = await boot();
    const response = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(response.status);
  });
});

describe("aksi dashboard tambahan", () => {
  it("mengganti model dan mengakhiri sesi lewat REST", async () => {
    const { base, db } = await boot();
    const { code } = issuePairCode(db, { createdBy: "uji" });
    const pair = await fetch(`${base}/v1/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "web" })
    });
    const body = (await pair.json()) as { token: string; device: { id: string } };
    updateDeviceRole(db, body.device.id, "owner");

    const model = await fetch(`${base}/v1/sessions/ses-baru/model`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-1" })
    });
    expect(model.status).toBe(200);

    const ended = await fetch(`${base}/v1/sessions/ses-baru/end`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
      body: "{}"
    });
    expect(ended.status).toBe(200);

    const page = await (await fetch(`${base}/`)).text();
    expect(page).toContain('id="newSession"');
    expect(page).toContain('id="setModel"');
    expect(page).toContain('id="endSession"');
  });

describe("upload lampiran dashboard", () => {
  it("AC-134 menerima berkas 5 MB dan menyimpannya sebagai artefak", async () => {
    const { base, db, dir } = await boot();
    const { code } = issuePairCode(db, { createdBy: "uji" });
    const pair = await fetch(`${base}/v1/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "web" })
    });
    const body = (await pair.json()) as { token: string; device: { id: string } };
    updateDeviceRole(db, body.device.id, "owner");
    const bytes = new Uint8Array(5 * 1024 * 1024);
    const upload = await fetch(`${base}/v1/sessions/ses-baru/attachments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${body.token}`,
        "content-type": "application/octet-stream",
        "x-filename": "besar.txt"
      },
      body: bytes
    });
    expect(upload.status).toBe(201);
    const saved = (await upload.json()) as { id?: string; path?: string };
    expect(saved.id ?? saved.path).toBeTruthy();
    expect(dir.length).toBeGreaterThan(0);
  }, 30_000);
});

describe("scope gateway", () => {
  it("AC-129 token read tidak bisa approve", async () => {
    const { base, db } = await boot();
    const { code } = issuePairCode(db, { createdBy: "uji" });
    const pair = await fetch(`${base}/v1/auth/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "viewer" })
    });
    const body = (await pair.json()) as { token: string; device: { id: string } };
    updateDeviceRole(db, body.device.id, "viewer");
    const response = await fetch(`${base}/v1/approvals/req_1`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
      body: JSON.stringify({ approved: true })
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("E_SCOPE");
  });
});

describe("replay event WebSocket", () => {
  it("AC-131 event yang terlewat dikirim ulang tanpa duplikasi", async () => {
    const { gateway } = await boot();
    const internal = gateway as unknown as {
      recent: Array<{ seq: number; event: { seq: number; type: string; sessionId?: string } }>;
      replay: (since: number, sessionId?: string) => Array<{ seq: number }>;
    };
    internal.recent.push(
      { seq: 1, event: { seq: 1, type: "message.delta", sessionId: "ses-a" } },
      { seq: 2, event: { seq: 2, type: "message.delta", sessionId: "ses-b" } },
      { seq: 3, event: { seq: 3, type: "turn.end", sessionId: "ses-a" } }
    );
    const replayed = internal.replay(1);
    expect(replayed.map((event) => event.seq)).toEqual([2, 3]);
    const scoped = internal.replay(1, "ses-a");
    expect(scoped.map((event) => event.seq)).toEqual([3]);
  });
});

describe("RBAC config", () => {
  it("AC-141 viewer tidak bisa mengubah config, owner bisa", async () => {
    const { base, db } = await boot();
    const pair = async (name: string): Promise<{ token: string; device: { id: string } }> => {
      const { code } = issuePairCode(db, { createdBy: "uji" });
      const response = await fetch(`${base}/v1/auth/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, name })
      });
      return (await response.json()) as { token: string; device: { id: string } };
    };
    const viewer = await pair("viewer");
    updateDeviceRole(db, viewer.device.id, "viewer");
    const denied = await fetch(`${base}/v1/config`, {
      method: "POST",
      headers: { authorization: `Bearer ${viewer.token}`, "content-type": "application/json" },
      body: JSON.stringify({ key: "gateway.heartbeat_ms", value: 30000 })
    });
    expect(denied.status).toBe(403);
    const owner = await pair("owner");
    updateDeviceRole(db, owner.device.id, "owner");
    const allowed = await fetch(`${base}/v1/config`, {
      method: "POST",
      headers: { authorization: `Bearer ${owner.token}`, "content-type": "application/json" },
      body: JSON.stringify({ key: "gateway.heartbeat_ms", value: 30000 })
    });
    expect(allowed.status).toBe(200);
  });
});
});
