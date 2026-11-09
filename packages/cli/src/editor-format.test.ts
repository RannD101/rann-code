import { describe, expect, it } from "vitest";
import { nextIndent } from "./line-editor.js";

describe("indentasi multiline", () => {
  it("menambah indentasi setelah blok dibuka", () => {
    expect(nextIndent("function uji() {", false)).toBe("  ");
    expect(nextIndent("  if (x) {", false)).toBe("    ");
    expect(nextIndent("kunci:", false)).toBe("  ");
  });

  it("mempertahankan indentasi baris biasa", () => {
    expect(nextIndent("  const a = 1;", false)).toBe("  ");
    expect(nextIndent("", false)).toBe("");
  });

  it("memakai dua spasi di dalam blok kode", () => {
    expect(nextIndent("```ts", true)).toBe("  ");
    expect(nextIndent("  kode", true)).toBe("    ");
  });
});
