import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFileTransaction, searchCode } from "./code-tools.js";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "rann-code-tools-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export function hitung() {\n  return 1;\n}\n", "utf8");
  writeFileSync(join(root, "src", "b.ts"), "// hitung dua\nconst x = 2;\n", "utf8");
  writeFileSync(join(root, "src", "c.md"), "# hitung\n", "utf8");
  mkdirSync(join(root, "node_modules"), { recursive: true });
  writeFileSync(join(root, "node_modules", "x.ts"), "hitung\n", "utf8");
  return root;
}

describe("pencarian kode", () => {
  it("mencari teks, menghormati ignore, dan membatasi hasil", () => {
    const root = repo();
    const result = searchCode(root, "hitung", { maxResults: 10 });
    expect(result.matches.map((item) => item.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.md"]);
    expect(result.matches[0]).toMatchObject({ line: 1, reason: "kecocokan persis" });
    expect(result.scanned).toBe(3);
  });

  it("mendukung regex dan filter glob", () => {
    const root = repo();
    const result = searchCode(root, "export\\s+function", { regex: true, glob: "**/*.ts" });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.path).toBe("src/a.ts");
  });

  it("memberi penjelasan saat hasil kosong", () => {
    const root = repo();
    const result = searchCode(root, "tidak-ada-sama-sekali");
    expect(result.matches).toHaveLength(0);
    expect(result.note).toContain("Tidak ada kecocokan");
  });
});

describe("transaksi berkas", () => {
  it("menulis beberapa berkas dan melaporkan status", () => {
    const root = repo();
    const before = readFileSync(join(root, "src", "a.ts"), "utf8");
    const result = applyFileTransaction(root, [
      { path: "src/a.ts", content: `${before}// tambahan\n` },
      { path: "src/baru.ts", content: "export const baru = true;\n" }
    ]);
    expect(result.rolled_back).toBe(false);
    expect(result.files.find((item) => item.path === "src/a.ts")?.status).toBe("updated");
    expect(result.files.find((item) => item.path === "src/baru.ts")?.status).toBe("created");
    expect(readFileSync(join(root, "src", "baru.ts"), "utf8")).toContain("baru");
  });

  it("menolak transaksi bila hash berubah sebelum eksekusi", () => {
    const root = repo();
    const original = readFileSync(join(root, "src", "a.ts"), "utf8");
    writeFileSync(join(root, "src", "a.ts"), `${original}// diubah\n`, "utf8");
    expect(() =>
      applyFileTransaction(root, [
        { path: "src/a.ts", content: "x", expected_sha256: "hash-lama" }
      ])
    ).toThrowError(/berubah sejak dibaca/);
  });

  it("dry run tidak menyentuh berkas", () => {
    const root = repo();
    const before = readFileSync(join(root, "src", "a.ts"), "utf8");
    const result = applyFileTransaction(root, [{ path: "src/a.ts", content: "ganti" }], { dryRun: true });
    expect(result.files[0]?.status).toBe("updated");
    expect(readFileSync(join(root, "src", "a.ts"), "utf8")).toBe(before);
  });
});
