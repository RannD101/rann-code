import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RpcClient } from "./client.js";
import { startDaemon } from "./daemon.js";

async function waitForJob(client: RpcClient, id: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await client.request<Record<string, unknown>>("background.get", { id });
    if (["done", "failed", "dead", "cancelled"].includes(String(job.status))) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${id} tidak selesai dalam ${timeoutMs} ms`);
}

describe("background lewat RPC", () => {
  it("menjalankan job shell dan menyimpan keluarannya", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-bg-home-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const job = await client.request<{ id: string }>("background.enqueue", {
        kind: "shell",
        text: "printf 'halo-dari-background'",
        idempotencyKey: "shell-uji-1"
      });
      const done = await waitForJob(client, job.id);
      expect(done.status).toBe("done");
      expect(JSON.parse(String(done.result_json))).toMatchObject({ stdout: "halo-dari-background", code: 0 });

      const duplicate = await client.request<{ id: string }>("background.enqueue", {
        kind: "shell",
        text: "printf 'halo-dari-background'",
        idempotencyKey: "shell-uji-1"
      });
      expect(duplicate.id).toBe(job.id);
    } finally {
      client.close();
      await daemon.stop();
    }
  });

  it("menjalankan prompt di sesi yang sudah ada sampai turn selesai", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-bg-home-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: home,
        title: "Background prompt",
        permissionMode: "trusted"
      });
      const job = await client.request<{ id: string }>("background.enqueue", {
        kind: "prompt",
        text: "balas singkat",
        sessionId: session.id
      });
      const done = await waitForJob(client, job.id);
      expect(done.status).toBe("done");
      const result = JSON.parse(String(done.result_json)) as Record<string, unknown>;
      expect(result.sessionId).toBe(session.id);
      expect(result.turnId).toBeTypeOf("string");
      expect(result.status).toBe("done");
    } finally {
      client.close();
      await daemon.stop();
    }
  });

  it("menolak sesi yang tidak ada dan job yang tidak dikenal", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-bg-home-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      await expect(
        client.request("background.enqueue", { kind: "prompt", text: "halo", sessionId: "sesi-palsu" })
      ).rejects.toMatchObject({ code: "E_SESSION_NOT_FOUND" });
      await expect(client.request("background.get", { id: "bg-palsu" })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    } finally {
      client.close();
      await daemon.stop();
    }
  });

  it("menjalankan scheduler manual dan menyimpan riwayat", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-bg-home-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const scheduler = await client.request<{ id: string; name: string }>("scheduler.add", {
        name: "uji-manual",
        schedule: "every:1h",
        command: "shell:printf terjadwal",
        timezone: "Asia/Jakarta"
      });
      const started = await client.request<{ job: { id: string } }>("scheduler.run", { id: scheduler.id });
      const done = await waitForJob(client, started.job.id);
      expect(done.status).toBe("done");
      expect(JSON.parse(String(done.result_json))).toMatchObject({ stdout: "terjadwal" });

      const history = await client.request<Array<Record<string, unknown>>>("scheduler.history", { id: scheduler.id });
      expect(history[0]?.status).toBe("done");
      expect(String(history[0]?.output)).toContain("terjadwal");
      await client.request("scheduler.remove", { id: scheduler.id });
      await expect(client.request("scheduler.history", { id: scheduler.id })).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    } finally {
      client.close();
      await daemon.stop();
    }
  });

  it("menolak jadwal dengan timezone atau cron yang tidak valid", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-bg-home-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      await expect(
        client.request("scheduler.add", { name: "rusak", schedule: "every:5m", command: "shell:true", timezone: "Mars/Olympus" })
      ).rejects.toMatchObject({ code: "E_INTERNAL" });
      await expect(
        client.request("scheduler.add", { name: "rusak-2", schedule: "0 7 *", command: "shell:true" })
      ).rejects.toMatchObject({ code: "E_INTERNAL" });
    } finally {
      client.close();
      await daemon.stop();
    }
  });
});
