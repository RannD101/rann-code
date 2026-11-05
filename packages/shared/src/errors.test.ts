import { describe, expect, it } from "vitest";
import { exitCodeFor, RannError, toRannError, toRpcError } from "./errors.js";

describe("errors", () => {
  it("memetakan kode ke exit code", () => {
    expect(exitCodeFor("E_INVALID_PARAMS")).toBe(2);
    expect(exitCodeFor("E_CONFIG_INVALID")).toBe(3);
    expect(exitCodeFor("E_PROVIDER_AUTH")).toBe(4);
    expect(exitCodeFor("E_PERMISSION")).toBe(5);
    expect(exitCodeFor("E_NOT_FOUND")).toBe(6);
    expect(exitCodeFor("E_CANCELLED")).toBe(8);
    expect(exitCodeFor("E_CONFLICT")).toBe(9);
    expect(exitCodeFor("E_INTERNAL")).toBe(1);
  });

  it("membawa data dan sifat retryable", () => {
    const error = new RannError("E_PROVIDER_RATE_LIMIT", "terlalu banyak", { data: { retry_after_ms: 1_000 } });
    expect(error.exitCode).toBe(4);
    expect(error.retryable).toBe(true);
    expect(error.data).toEqual({ retry_after_ms: 1_000 });
    expect(toRpcError(error)).toEqual({
      code: "E_PROVIDER_RATE_LIMIT",
      message: "terlalu banyak",
      data: { retry_after_ms: 1_000 }
    });
  });

  it("membungkus error tak dikenal sebagai E_INTERNAL", () => {
    const wrapped = toRannError(new Error("boom"));
    expect(wrapped.code).toBe("E_INTERNAL");
    expect(wrapped.message).toBe("boom");
    expect(toRannError("teks").message).toBe("teks");
    expect(toRannError(wrapped)).toBe(wrapped);
  });
});
