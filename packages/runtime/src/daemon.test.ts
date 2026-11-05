import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@rann/shared";
import { RpcClient } from "./client.js";
import { startDaemon } from "./daemon.js";

describe("daemon dan RPC", () => {
  it("menjalankan turn mock dari klien sampai selesai", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-daemon-"));
    const project = mkdtempSync(join(tmpdir(), "rann-project-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);

    try {
      const health = await client.request<{ status: string; database: { schema_version: number } }>("health");
      expect(health.status).toBe("ok");
      expect(health.database.schema_version).toBeGreaterThan(0);

      const events: EventEnvelope[] = [];
      const completed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("turn tidak selesai dalam 10 detik")), 10_000);
        client.onEvent((event) => {
          events.push(event);
          if (event.type === "turn.completed") {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      const session = await client.request<{ id: string }>("session.create", {
        projectPath: project,
        title: "Uji integrasi",
        permissionMode: "trusted"
      });
      const { turnId } = await client.request<{ turnId: string }>("session.send", {
        sessionId: session.id,
        text: "halo dunia"
      });
      await completed;

      const text = events
        .filter((event) => event.type === "message.delta" && event.turnId === turnId)
        .map((event) => String(event.data.text ?? ""))
        .join("");
      expect(text).toBe("Balasan mock: halo dunia");

      const detail = await client.request<{ messages: Array<{ role: string; content: string }> }>("session.get", {
        sessionId: session.id
      });
      expect(detail.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(detail.messages[1]?.content).toBe("Balasan mock: halo dunia");

      const turn = await client.request<{ status: string; usage_json: string }>("turn.get", { turnId });
      expect(turn.status).toBe("done");
      expect(JSON.parse(turn.usage_json)).toMatchObject({ outputTokens: expect.any(Number) });
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 20_000);

  it("meminta izin lewat event dan mengingat pilihan selalu", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-approval-"));
    const project = mkdtempSync(join(tmpdir(), "rann-approval-proj-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    let approvals = 0;

    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: project,
        permissionMode: "ask"
      });
      const waitTurn = (): Promise<void> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("turn tidak selesai")), 10_000);
          const off = client.onEvent((event) => {
            if (event.type === "approval.requested") {
              approvals += 1;
              const requestId = String(event.data.request_id ?? "");
              void client
                .request("permission.respond", { requestId, approved: true, remember: true })
                .catch(() => undefined);
            }
            if (event.type === "turn.completed" || event.type === "turn.failed") {
              clearTimeout(timer);
              off();
              resolve();
            }
          });
        });

      const first = waitTurn();
      await client.request("session.send", {
        sessionId: session.id,
        text: 'tool:fs_write {"path":"satu.txt","content":"satu\\n"}'
      });
      await first;
      expect(readFileSync(join(project, "satu.txt"), "utf8")).toBe("satu\n");

      const second = waitTurn();
      await client.request("session.send", {
        sessionId: session.id,
        text: 'tool:fs_write {"path":"dua.txt","content":"dua\\n"}'
      });
      await second;
      expect(readFileSync(join(project, "dua.txt"), "utf8")).toBe("dua\n");
      expect(approvals).toBe(1);
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 30_000);

  it("menolak izin tidak menulis berkas dan bertanya lagi di turn berikutnya", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-deny-"));
    const project = mkdtempSync(join(tmpdir(), "rann-deny-proj-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    let approvals = 0;

    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: project,
        permissionMode: "ask"
      });
      const runDenied = (path: string): Promise<void> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("turn tidak selesai")), 10_000);
          const off = client.onEvent((event) => {
            if (event.type === "approval.requested") {
              approvals += 1;
              const requestId = String(event.data.request_id ?? "");
              void client.request("permission.respond", { requestId, approved: false }).catch(() => undefined);
            }
            if (event.type === "turn.completed" || event.type === "turn.failed") {
              clearTimeout(timer);
              off();
              resolve();
            }
          });
          void client
            .request("session.send", { sessionId: session.id, text: `tool:fs_write {"path":"${path}","content":"x\\n"}` })
            .catch((error: unknown) => {
              clearTimeout(timer);
              off();
              reject(error as Error);
            });
        });

      await runDenied("tolak-satu.txt");
      expect(existsSync(join(project, "tolak-satu.txt"))).toBe(false);
      expect(approvals).toBe(1);

      await runDenied("tolak-dua.txt");
      expect(existsSync(join(project, "tolak-dua.txt"))).toBe(false);
      expect(approvals).toBe(2);
    } finally {
      client.close();
      await daemon.stop();
    }
  }, 30_000);
});
