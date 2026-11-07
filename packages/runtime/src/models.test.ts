import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configSchema } from "@rann/shared";
import { getModel, listModels, openDatabase, type Db } from "@rann/storage";
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
      capabilities: { vision: false }
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
  });

  it("memberi harga nol dan $? saat harga tidak diketahui", () => {
    const descriptor = builtinDescriptor("rann", "model-tanpa-harga");
    expect(descriptor.pricing).toBeUndefined();
    expect(costFor(descriptor, 1000, 1000)).toBeNull();
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
