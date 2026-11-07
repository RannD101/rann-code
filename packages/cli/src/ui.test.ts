import { describe, expect, it } from "vitest";
import { contrastRatio, displayWidth, setTheme, stripAnsi, table, themeTokens, truncateWidth } from "./ui.js";

describe("tampilan terminal", () => {
  it("menghitung lebar karakter lebar dan escape", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("漢字")).toBe(4);
    expect(displayWidth("\u001b[31mmerah\u001b[0m")).toBe(5);
    expect(stripAnsi("\u001b[1mtebal\u001b[0m")).toBe("tebal");
  });

  it("memotong teks sesuai lebar tampilan", () => {
    expect(truncateWidth("abcdef", 4)).toBe("abc…");
    expect(truncateWidth("漢字漢字", 5)).toBe("漢字…");
    expect(truncateWidth("abc", 10)).toBe("abc");
  });

  it("menjaga tabel tetap sejajar untuk karakter lebar", () => {
    const rendered = table(["nama", "nilai"], [["漢字", "1"], ["ab", "2"]]);
    expect(rendered.split("\n")).toHaveLength(3);
    expect(rendered).toContain("漢字");
  });

  it("tema gelap dan terang memenuhi kontras teks utama", () => {
    setTheme("dark");
    expect(contrastRatio(themeTokens().foreground, "#0d1117")).toBeGreaterThan(7);
    setTheme("light");
    expect(contrastRatio(themeTokens().foreground, "#ffffff")).toBeGreaterThan(7);
    setTheme("auto");
  });
});
