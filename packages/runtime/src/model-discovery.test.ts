import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configSchema } from "@rann/shared";
import { listCapabilityChanges, listModels, openDatabase, upsertModel, type Db } from "@rann/storage";
import { discoverAllProviders, discoverModels, lastDiscoveryAt } from "./model-discovery.js";
import { resolveDescriptor, seedRegistry } from "./models.js";

function fresh(): Db {
  const dir = mkdtempSync(join(tmpdir(), "rann-discovery-"));
  return openDatabase({ path: join(dir, "rann.db") }).db;
}

const config = configSchema.parse({
  provider: "mock",
  providers: {
    mock: { kind: "mock", default_model: "mock-1", models: ["mock-1"] }
  }
});

describe("discovery model", () => {
  it("menyimpan daftar model dari provider dan menandai sumber capability", async () => {
    const db = fresh();
    const result = await discoverModels(db, config, "mock", undefined, { now: 1_000 });
    expect(result.supported).toBe(true);
    expect(result.cached).toBe(false);
    expect(result.discovered).toEqual(["mock-1"]);
    expect(result.added).toEqual(["mock-1"]);
    expect(lastDiscoveryAt(db, "mock")).toBe(1_000);
    const row = listModels(db, "mock", { includeUnavailable: true })[0];
    expect(row?.available).toBe(1);
    expect(row?.capability_source).toBe("provider");
    const descriptor = resolveDescriptor(db, config, "mock", "mock-1");
    expect(descriptor.capabilitySource).toBe("provider");
    expect(descriptor.capabilitiesUnknown).toBe(false);
    expect(descriptor.capabilities.toolCalling).toBe(true);
  });

  it("memakai cache sampai melewati maxAge", async () => {
    const db = fresh();
    await discoverModels(db, config, "mock", undefined, { now: 10_000 });
    const cached = await discoverModels(db, config, "mock", undefined, { now: 11_000 });
    expect(cached.cached).toBe(true);
    expect(cached.fetched_at).toBe(10_000);
    const forced = await discoverModels(db, config, "mock", undefined, { now: 12_000, force: true });
    expect(forced.cached).toBe(false);
    expect(forced.fetched_at).toBe(12_000);
    const expired = await discoverModels(db, config, "mock", undefined, {
      now: 10_000 + 7 * 60 * 60 * 1_000
    });
    expect(expired.cached).toBe(false);
  });

  it("menandai model yang hilang sebagai tidak tersedia tanpa menghapusnya", async () => {
    const db = fresh();
    seedRegistry(db, config);
    upsertModel(db, {
      provider: "mock",
      name: "mock-lama",
      displayName: "mock-lama",
      contextWindow: 8_000,
      maxOutputTokens: 1_000,
      capabilities: { streaming: true, toolCalling: true },
      available: true,
      discoveredAt: 500
    });
    const result = await discoverModels(db, config, "mock", undefined, { now: 20_000, force: true });
    expect(result.unavailable).toEqual(["mock-lama"]);
    const rows = listModels(db, "mock", { includeUnavailable: true });
    const ghost = rows.find((row) => row.name === "mock-lama");
    expect(ghost?.available).toBe(0);
    expect(listModels(db, "mock").map((row) => row.name)).toEqual(["mock-1"]);
  });

  it("mencatat perubahan capability dari provider", async () => {
    const db = fresh();
    await discoverModels(db, config, "mock", undefined, { now: 1_000, force: true });
    const changes = listCapabilityChanges(db, "mock", "mock-1");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every((entry) => entry.source === "provider")).toBe(true);
    expect(changes.map((entry) => entry.capability)).toContain("toolCalling");
    const again = await discoverModels(db, config, "mock", undefined, { now: 2_000, force: true });
    expect(again.capability_changes).toBe(0);
  });

  it("melaporkan provider yang gagal tanpa menghentikan provider lain", async () => {
    const broken = configSchema.parse({
      provider: "mock",
      providers: {
        mock: { kind: "mock", models: ["mock-1"] },
        rusak: { kind: "openai-compatible", models: ["x"], api_key_env: "TIDAK_ADA_ENV" }
      }
    });
    const results = await discoverAllProviders(fresh(), broken, undefined, { force: true });
    const mock = results.find((entry) => entry.provider === "mock");
    const rusak = results.find((entry) => entry.provider === "rusak");
    expect(mock?.supported).toBe(true);
    expect(rusak?.supported).toBe(false);
    expect(rusak?.reason).toContain("E_");
  });
});
