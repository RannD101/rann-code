import { describe, expect, it } from "vitest";
import { formatApprovalArgs } from "./approval.js";

describe("format args dialog izin", () => {
  it("menampilkan method untuk semua tool jaringan, bukan hanya http_request", () => {
    expect(formatApprovalArgs({ method: "POST", url: "https://contoh.test/a" })).toBe("POST https://contoh.test/a");
    expect(formatApprovalArgs({ method: "DELETE", domain: "api.contoh.test" })).toBe("DELETE api.contoh.test");
  });

  it("tidak memotong argumen di 10.000 karakter", () => {
    const args = { patch: "x".repeat(50_000) };
    const detail = formatApprovalArgs(args);
    expect(detail.length).toBeGreaterThan(49_000);
    expect(detail).not.toContain("karakter lagi");
  });

  it("memberi penanda saat melewati batas aman", () => {
    const detail = formatApprovalArgs({ patch: "y".repeat(120_000) });
    expect(detail).toContain("karakter lagi");
    expect(detail.length).toBeLessThan(101_000);
  });
});
