import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configSchema } from "@rann/shared";
import { getModel, listCapabilityChanges, listModels, openDatabase, type Db } from "@rann/storage";
import { builtinDescriptor, costFor, mergeCapabilities, registrySnapshot, resolveDescriptor, seedRegistry } from "./models.js";

function fresh(): Db {
  const dir = mkdtempSync(join(tmpdir(), "rann-models-"));
  return openDatabase({ path: join(dir, "rann.db") }).db;
}

const config = configSchema.parse({
  provider: "rann",
  providers: {
    rann: {
      kind: "openai-compatible",
      base_url: "https://example.test/v1",
      default_model: "rann/gpt-6-astra",
      models: ["rann/gpt-6-astra"]
    }
  },
  models: {
    "rann/rann/gpt-6-astra": {
      context_window: 300_000,
      capabilities: { vision: false },
      aliases: ["astra"]
    }
  }
});

describe("model registry", () => {
  it("mengisi registry dari config dan menghormati override", () => {
    const db = fresh();
    seedRegistry(db, config);
    const row = getModel(db, "rann", "rann/gpt-6-astra");
    expect(row?.context_window).toBe(300_000);
    const descriptor = resolveDescriptor(db, config, "rann", "rann/gpt-6-astra");
    expect(descriptor.contextWindow).toBe(300_000);
    expect(descriptor.capabilities.toolCalling).toBe(true);
    expect(descriptor.capabilities.vision).toBe(false);
    expect(listModels(db, "rann")).toHaveLength(1);
    expect(registrySnapshot(db, config)).toHaveLength(1);
    expect(registrySnapshot(db, config)[0]?.aliases).toEqual(["astra"]);
    expect(resolveDescriptor(db, config, "rann", "astra").model).toBe("rann/gpt-6-astra");
  });

  it("memberi harga nol dan $? saat harga tidak diketahui", () => {
    const descriptor = builtinDescriptor("rann", "model-tanpa-harga");
    expect(descriptor.pricing).toBeUndefined();
    expect(costFor(descriptor, 1000, 1000)).toBeNull();
  });

  it("menghitung biaya cache read dan write", () => {
    const descriptor = builtinDescriptor("x", "cache-model");
    const priced = {
      ...descriptor,
      pricing: {
        inputPerMTok: 10,
        outputPerMTok: 30,
        cacheReadPerMTok: 1,
        cacheWritePerMTok: 12.5,
        currency: "USD" as const,
        source: "uji",
        updatedAt: "2026-11-07"
      }
    };
    // 1 juta token input, 1 juta output, 1 juta cache read, 1 juta cache write = 10 + 30 + 1 + 12.5
    expect(costFor(priced, 1_000_000, 1_000_000, 1_000_000, 1_000_000)).toBe(53.5);
    // Harga cache tidak diisi memakai harga input, bukan nol.
    const tanpaHargaCache = { ...priced, pricing: { ...priced.pricing, cacheReadPerMTok: undefined, cacheWritePerMTok: undefined } };
    expect(costFor(tanpaHargaCache, 1_000_000, 0, 1_000_000, 0)).toBe(20);
  });

  it("meneruskan harga cache lewat override", () => {
    const descriptor = resolveDescriptor(fresh(), config, "rann", "rann/gpt-6-astra", {
      inputPrice: 3,
      outputPrice: 15,
      cacheReadPrice: 0.3,
      cacheWritePrice: 3.75
    });
    expect(descriptor.pricing).toMatchObject({
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75
    });
  });

  it("menggabungkan capability tanpa menghapus default", () => {
    const merged = mergeCapabilities(builtinDescriptor("x", "m").capabilities, { vision: true, audio: false });
    expect(merged.vision).toBe(true);
    expect(merged.audio).toBe(false);
    expect(merged.streaming).toBe(true);
  });

  it("menganggap model tanpa tool calling tidak bisa memakai tool", () => {
    const descriptor = resolveDescriptor(fresh(), config, "rann", "rann/gpt-6-astra", {
      capabilities: { toolCalling: false }
    });
    expect(descriptor.capabilities.toolCalling).toBe(false);
  });
});

describe("capability yang belum diketahui", () => {
  it("hanya mengasumsikan streaming untuk model di luar katalog", () => {
    const descriptor = builtinDescriptor("rann", "model-misterius-9");
    expect(descriptor.capabilities.streaming).toBe(true);
    expect(descriptor.capabilities.toolCalling).toBe(false);
    expect(descriptor.capabilities.structuredOutput).toBe(false);
    expect(descriptor.capabilitiesUnknown).toBe(true);
    expect(descriptor.capabilitySource).toBe("assumed");
  });

  it("mencatat sumber capability dari config dan log perubahannya", () => {
    const db = fresh();
    seedRegistry(db, config);
    const descriptor = resolveDescriptor(db, config, "rann", "rann/gpt-6-astra");
    expect(descriptor.capabilitySource).toBe("config");
    expect(descriptor.capabilitiesUnknown).toBe(false);
    const changes = listCapabilityChanges(db, "rann", "rann/gpt-6-astra");
    expect(changes).toHaveLength(1);
    expect(changes[0]?.capability).toBe("vision");
    expect(changes[0]?.new_value).toBe(0);
    expect(changes[0]?.source).toBe("config");
    seedRegistry(db, config);
    expect(listCapabilityChanges(db, "rann", "rann/gpt-6-astra")).toHaveLength(1);
  });
});
