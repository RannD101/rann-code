import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RpcClient } from "./client.js";
import { startDaemon } from "./daemon.js";

describe("RPC model discovery", () => {
  it("mengekspos discovery, capability log, dan daftar model tidak tersedia", async () => {
    const home = mkdtempSync(join(tmpdir(), "rann-rpc-model-"));
    const daemon = await startDaemon({ home, version: "0.0.0-test" });
    const client = await RpcClient.connect(daemon.layout.socketPath);
    try {
      const first = await client.request<{
        provider: string;
        supported: boolean;
        discovered: string[];
        added: string[];
      }>("model.discover", { provider: "mock" });
      expect(first.supported).toBe(true);
      expect(first.discovered).toEqual(["mock-1"]);
      expect(first.added).toEqual(["mock-1"]);

      const cached = await client.request<{ cached: boolean; fetched_at: number }>("model.discover", {
        provider: "mock"
      });
      expect(cached.cached).toBe(true);

      const all = await client.request<{ results: Array<{ provider: string }> }>("model.discover", { force: true });
      expect(all.results.map((entry) => entry.provider)).toContain("mock");

      const changes = await client.request<{ changes: Array<{ capability: string; source: string }> }>(
        "model.capabilities",
        { provider: "mock", model: "mock-1" }
      );
      expect(changes.changes.length).toBeGreaterThan(0);
      expect(changes.changes.every((entry) => entry.source === "provider")).toBe(true);

      const list = await client.request<{
        models: string[];
        descriptors: Array<{ id: string; capabilitySource: string; capabilitiesUnknown: boolean }>;
        unavailable: string[];
      }>("model.list");
      const mockDescriptor = list.descriptors.find((entry) => entry.id === "mock/mock-1");
      expect(mockDescriptor?.capabilitySource).toBe("provider");
      expect(mockDescriptor?.capabilitiesUnknown).toBe(false);
      expect(Array.isArray(list.unavailable)).toBe(true);
    } finally {
      await client.close();
      await daemon.stop();
    }
  }, 30_000);
});
