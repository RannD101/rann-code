import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RpcClient } from "./client.js";
import { startDaemon } from "./daemon.js";

describe("hook SessionEnd", () => {
  it("dipancarkan saat sesi ditutup lewat RPC", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-hook-session-"));
    mkdirSync(join(home, "config"), { recursive: true });
    const marker = join(home, "end.txt");
    writeFileSync(
      join(home, "config", "config.toml"),
      [
        'provider = "mock"',
        "[model]",
        'default = "mock-1"',
        "[[hooks]]",
        'event = "SessionEnd"',
        'kind = "command"',
        `command = "printf selesai >> ${marker}"`,
        ""
      ].join("\n")
    );
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const session = await client.request<{ id: string }>("session.create", {
        projectPath: mkdtempSync(join(tmpdir(), "rann-hook-proj-")),
        permissionMode: "trusted"
      });
      const result = await client.request<{ ended: boolean }>("session.end", { sessionId: session.id });
      expect(result.ended).toBe(true);
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, "utf8")).toContain("selesai");
    } finally {
      await client.close();
      await daemon.stop();
    }
  }, 30_000);
});
