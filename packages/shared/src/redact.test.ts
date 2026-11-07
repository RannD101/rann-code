import { describe, expect, it } from "vitest";
import { redactSecrets, redactText } from "./redact.js";

describe("redactSecrets", () => {
  it("menyamarkan nilai berdasarkan nama kunci", () => {
    const result = redactSecrets({ api_key: "apa-saja", password: "rahasia", nested: { access_token: "x" }, safe: "boleh" });
    expect(result).toEqual({ api_key: "[REDACTED]", password: "[REDACTED]", nested: { access_token: "[REDACTED]" }, safe: "boleh" });
  });

  it("menyamarkan pola token dan kredensial di URL", () => {
    expect(redactText("pakai sk-abcdefghijklmn dan rd-rann-1234567890")).toBe("pakai [REDACTED] dan [REDACTED]");
    expect(redactText("https://user:pass@proxy.example:8080")).toBe("https://[REDACTED]@proxy.example:8080");
  });

  it("tidak mengubah angka, null, atau array biasa", () => {
    expect(redactSecrets([1, null, "aman"])).toEqual([1, null, "aman"]);
  });
});
