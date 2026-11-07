import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "./models.js";
import { CAPABILITIES } from "./models.js";
import { classifyRoute, routeModel } from "./router.js";

function descriptor(overrides: Partial<ModelDescriptor> & Pick<ModelDescriptor, "id" | "provider" | "model">): ModelDescriptor {
  return {
    displayName: overrides.model,
    aliases: [],
    contextWindow: 128_000,
    maxOutputTokens: 8_000,
    capabilities: Object.fromEntries(CAPABILITIES.map((name) => [name, true])) as ModelDescriptor["capabilities"],
    quality: { coding: 0.5, reasoning: 0.5, writing: 0.5 },
    latencyClass: "standard",
    ...overrides
  };
}

describe("router", () => {
  it("mengklasifikasikan tugas coding dan review", () => {
    expect(classifyRoute("tolong refactor file ini dan perbaiki test")).toBe("coding");
    expect(classifyRoute("audit keamanan endpoint login")).toBe("review");
    expect(classifyRoute("halo, apa kabar")).toBe("answer");
  });

  it("membuang model tanpa tool calling untuk coding", () => {
    const noTools = descriptor({
      id: "murah/tanpa-tool",
      provider: "murah",
      model: "tanpa-tool",
      capabilities: { ...descriptor({ id: "x", provider: "x", model: "x" }).capabilities, toolCalling: false },
      quality: { coding: 0.9, reasoning: 0.9, writing: 0.9 }
    });
    const decision = routeModel({
      prompt: "ubah file ini",
      descriptors: [noTools, descriptor({ id: "besar/coder", provider: "besar", model: "coder" })]
    });
    expect(decision.taskClass).toBe("coding");
    expect(decision.chosen).toBe("besar/coder");
    expect(decision.rejected[0]?.reason).toMatch(/toolCalling/);
  });

  it("memilih model reasoning lebih kuat meski lebih mahal", () => {
    const murah = descriptor({
      id: "murah/cepat",
      provider: "murah",
      model: "cepat",
      quality: { coding: 0.4, reasoning: 0.4, writing: 0.4 },
      pricing: { inputPerMTok: 1, outputPerMTok: 1, currency: "USD", source: "uji", updatedAt: "2026-11-07" }
    });
    const pintar = descriptor({
      id: "pintar/nalar",
      provider: "pintar",
      model: "nalar",
      quality: { coding: 0.9, reasoning: 0.95, writing: 0.8 },
      pricing: { inputPerMTok: 15, outputPerMTok: 60, currency: "USD", source: "uji", updatedAt: "2026-11-07" }
    });
    const decision = routeModel({ prompt: "analisis arsitektur sistem ini", descriptors: [murah, pintar] });
    expect(decision.taskClass).toBe("reasoning");
    expect(decision.chosen).toBe("pintar/nalar");
  });

  it("menghormati pin dan alias", () => {
    const murah = descriptor({ id: "a/murah", provider: "a", model: "murah", aliases: ["fast"] });
    const pintar = descriptor({ id: "b/pintar", provider: "b", model: "pintar" });
    const pinned = routeModel({ prompt: "halo", descriptors: [murah, pintar], pinned: "fast" });
    expect(pinned.chosen).toBe("a/murah");
    expect(pinned.pinned).toBe(true);
  });

  it("memberi peringatan saat semua kandidat melebihi batas biaya", () => {
    const mahal = descriptor({
      id: "a/mahal",
      provider: "a",
      model: "mahal",
      pricing: { inputPerMTok: 10, outputPerMTok: 10, currency: "USD", source: "uji", updatedAt: "2026-11-07" }
    });
    const decision = routeModel({ prompt: "halo", descriptors: [mahal], maxCostPerTask: 0.01 });
    expect(decision.chosen).toBe("a/mahal");
    expect(decision.warning).toMatch(/termurah/);
  });
});
