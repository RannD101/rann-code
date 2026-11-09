import { describe, expect, it } from "vitest";
import { RETRY_MATRIX, canRetry, retryDelay, retryPolicy } from "./retry-matrix.js";

const timeout = { code: "E_TIMEOUT" };

describe("matriks retry", () => {
  it("memakai angka dari ARCHITECTURE 13.3", () => {
    expect(retryPolicy("provider.chat")).toMatchObject({
      attempts: 3,
      backoffMs: [1000, 2000, 4000],
      jitterMs: 250,
      idempotency: "required"
    });
    expect(RETRY_MATRIX["provider.stream"].attempts).toBe(2);
    expect(RETRY_MATRIX["tool.http"].idempotency).toBe("get-only");
    expect(RETRY_MATRIX["tool.shell"].attempts).toBe(1);
    expect(RETRY_MATRIX["tool.shell"].idempotency).toBe("never");
    expect(RETRY_MATRIX["db.busy"].idempotency).toBe("required");
    expect(RETRY_MATRIX["mcp.request"].idempotency).toBe("depends");
    expect(RETRY_MATRIX["db.busy"].retryableCodes).toContain("SQLITE_BUSY");
  });

  it("hanya mengulang kode error yang ada di daftar target", () => {
    expect(canRetry("provider.chat", { attempt: 1, error: { code: "E_PROVIDER_RATE_LIMIT" } })).toBe(true);
    expect(canRetry("provider.chat", { attempt: 1, error: { code: "E_PROVIDER_AUTH" } })).toBe(false);
    expect(canRetry("provider.chat", { attempt: 3, error: { code: "E_PROVIDER_RATE_LIMIT" } })).toBe(false);
    expect(canRetry("db.busy", { attempt: 1, error: { message: "SQLITE_BUSY: database is locked" } })).toBe(true);
  });

  it("menolak retry untuk operasi yang tidak boleh diulang", () => {
    expect(canRetry("tool.shell", { attempt: 1, error: timeout })).toBe(false);
    expect(canRetry("tool.http", { attempt: 1, error: timeout, method: "POST" })).toBe(false);
    expect(canRetry("tool.http", { attempt: 1, error: timeout, method: "get" })).toBe(true);
    expect(canRetry("mcp.request", { attempt: 1, error: timeout })).toBe(false);
    expect(canRetry("mcp.request", { attempt: 1, error: timeout, idempotent: true })).toBe(true);
    const controller = new AbortController();
    controller.abort();
    expect(canRetry("provider.chat", { attempt: 1, error: timeout, signal: controller.signal })).toBe(false);
  });

  it("menghitung jeda dengan backoff, retry-after, dan jitter", () => {
    expect(retryDelay("provider.chat", 1, undefined, () => 0)).toBe(1000);
    expect(retryDelay("provider.chat", 2, undefined, () => 0)).toBe(2000);
    expect(retryDelay("provider.chat", 9, undefined, () => 0)).toBe(4000);
    expect(retryDelay("provider.chat", 1, 7000, () => 0)).toBe(7000);
    expect(retryDelay("provider.chat", 1, 90_000, () => 0)).toBe(60_000);
    expect(retryDelay("provider.chat", 1, undefined, () => 0.999)).toBe(1250);
    expect(retryDelay("db.busy", 1, undefined, () => 0)).toBe(50);
  });
});
