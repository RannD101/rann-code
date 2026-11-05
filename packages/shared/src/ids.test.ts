import { describe, expect, it } from "vitest";
import { isId, newId } from "./ids.js";

describe("ids", () => {
  it("membuat id dengan prefiks yang benar", () => {
    const id = newId("ses");
    expect(id.startsWith("ses_")).toBe(true);
    expect(id).toHaveLength(24);
    expect(isId(id, "ses")).toBe(true);
    expect(isId(id, "turn")).toBe(false);
  });

  it("menghasilkan id unik", () => {
    const ids = new Set(Array.from({ length: 2_000 }, () => newId("msg")));
    expect(ids.size).toBe(2_000);
  });

  it("menolak id yang salah bentuk", () => {
    expect(isId("ses_")).toBe(false);
    expect(isId("ses_iiiiiiiiiiiiiiiiiiii")).toBe(false);
    expect(isId("nope_0123456789abcdefghjk", "ses")).toBe(false);
  });
});
