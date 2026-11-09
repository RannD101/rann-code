import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RpcClient } from "./client.js";
import { startDaemon } from "./daemon.js";

describe("override config per sesi", () => {
  it("menyimpan max_steps dan skill policy lalu mengembalikannya", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-rpc-session-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: mkdtempSync(join(tmpdir(), "rann-proj-")),
        permissionMode: "ask"
      });
      const configured = await client.request<{ overrides: Record<string, unknown> }>("session.configure", {
        sessionId: session.id,
        model: "mock-1",
        permission_mode: "trusted",
        max_steps: 3,
        skills_force: ["debug-sistematis"],
        skills_deny: ["code-review"]
      });
      expect(configured.overrides).toMatchObject({ max_steps: 3, skills_force: ["debug-sistematis"] });
      const fetched = await client.request<{ metadata_json: string }>("session.get", { sessionId: session.id });
      expect(JSON.parse(fetched.metadata_json).overrides.max_steps).toBe(3);
    } finally {
      await client.close();
      await daemon.stop();
    }
  }, 30_000);
});
