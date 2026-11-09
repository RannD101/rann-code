import { describe, expect, it } from "vitest";
import { MarkdownStream, renderMarkdownLine } from "./markdown.js";
import { stripAnsi } from "./ui.js";

describe("markdown terminal", () => {
  it("merender heading, inline code, dan tautan", () => {
    const state = { inFence: false };
    expect(stripAnsi(renderMarkdownLine("## Judul", state))).toBe("Judul");
    expect(stripAnsi(renderMarkdownLine("pakai `pnpm test` sekarang", state))).toBe("pakai pnpm test sekarang");
    expect(stripAnsi(renderMarkdownLine("[dok](https://example.com)", state))).toBe("dok (https://example.com)");
  });

  it("mempertahankan isi blok kode apa adanya", () => {
    const state = { inFence: false };
    expect(stripAnsi(renderMarkdownLine("```ts", state))).toBe("╭─ ts");
    expect(stripAnsi(renderMarkdownLine("const x = **bukan bold**;", state))).toBe("│ const x = **bukan bold**;");
    expect(stripAnsi(renderMarkdownLine("```", state))).toBe("╰─");
  });

  it("hanya mengeluarkan baris yang sudah selesai", () => {
    const stream = new MarkdownStream();
    expect(stream.push("satu\ndua")).toBe("satu\n");
    expect(stream.flush()).toBe("dua\n");
  });
});
