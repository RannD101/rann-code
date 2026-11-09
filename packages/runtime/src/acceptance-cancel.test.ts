import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@rann/shared";
import { RpcClient } from "./client.js";
import { startDaemon } from "./daemon.js";

describe("cancel turn", () => {
  it("AC-012 turn berhenti <= 2 detik saat dibatalkan", async () => {
    process.env.RANN_MOCK_SCENARIO = "slow";
    const home = mkdtempSync(join(tmpdir(), "rann-ac-cancel-"));
    const project = mkdtempSync(join(tmpdir(), "rann-ac-cancel-proj-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const session = await client.request<{ id: string }>("session.create", { projectPath: project, permissionMode: "trusted" });
      const end = new Promise<EventEnvelope>((resolve) => {
        const off = client.onEvent((event) => {
          if (event.type === "turn.end") {
            off();
            resolve(event);
          }
        });
      });
      await client.request("session.send", { sessionId: session.id, text: "halo" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const started = Date.now();
      await client.request("session.cancel", { sessionId: session.id });
      const event = await end;
      expect(Date.now() - started).toBeLessThan(2_000);
      expect((event.data as { status?: string }).status).toBe("cancelled");
    } finally {
      delete process.env.RANN_MOCK_SCENARIO;
      await client.close();
      await daemon.stop();
    }
  }, 30_000);
});
