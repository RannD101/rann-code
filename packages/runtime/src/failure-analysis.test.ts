import { RannError } from "@rann/shared";
import { describe, expect, it } from "vitest";
import { analyzeFailure } from "./failure-analysis.js";

describe("analyzeFailure", () => {
  it("mengategorikan error auth sebagai tidak bisa diulang", () => {
    const result = analyzeFailure(new RannError("E_PROVIDER_AUTH", "kunci salah"), { provider: "rann", step: 2 });
    expect(result).toMatchObject({ category: "auth", retryable: false });
    expect(result.cause).toContain("provider rann");
    expect(result.cause).toContain("langkah 2");
  });

  it("menandai rate limit dan timeout sebagai bisa diulang", () => {
    expect(analyzeFailure(new RannError("E_PROVIDER_RATE_LIMIT", "429")).retryable).toBe(true);
    expect(analyzeFailure(new RannError("E_TIMEOUT", "lambat")).category).toBe("timeout");
  });

  it("memberi saran untuk konteks penuh dan pembatalan", () => {
    expect(analyzeFailure(new RannError("E_CONTEXT_OVERFLOW", "penuh")).action).toContain("context window");
    expect(analyzeFailure(new RannError("E_CANCELLED", "stop")).category).toBe("cancelled");
  });

  it("memakai kategori unknown untuk kode yang belum dipetakan", () => {
    expect(analyzeFailure(new RannError("E_STORAGE", "rusak"))).toMatchObject({ category: "unknown", retryable: false });
  });
});
