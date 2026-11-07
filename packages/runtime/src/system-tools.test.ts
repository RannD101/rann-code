import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { documentExtract, sqliteQuery, systemInfo } from "./system-tools.js";
import { assertPublicUrl } from "./web.js";

describe("system tools", () => {
  it("menjalankan query SQLite read-only dan menolak write", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-db-"));
    const path = join(dir, "data.db");
    const db = new BetterSqlite3(path);
    db.exec("CREATE TABLE item (id INTEGER PRIMARY KEY, nama TEXT); INSERT INTO item (nama) VALUES ('satu'), ('dua');");
    db.close();
    const result = sqliteQuery(path, "SELECT id, nama FROM item ORDER BY id");
    expect(result.columns).toEqual(["id", "nama"]);
    expect(result.rows).toEqual([[1, "satu"], [2, "dua"]]);
    expect(() => sqliteQuery(path, "DELETE FROM item")).toThrow(/hanya boleh SELECT/i);
    expect(() => sqliteQuery(path, "SELECT 1; DROP TABLE item")).toThrow();
  });

  it("mengekstrak teks berkas dan membaca sistem", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-doc-"));
    const path = join(dir, "catatan.md");
    writeFileSync(path, "# Judul\n\nIsi dokumen.");
    expect(documentExtract(path).text).toContain("Isi dokumen");
    const info = systemInfo();
    expect(String(info.node)).toMatch(/^v/);
    expect(String(info.platform).length).toBeGreaterThan(0);
  });

  it("memblokir URL privat", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/admin")).rejects.toMatchObject({ code: "E_PERMISSION" });
    await expect(assertPublicUrl("http://localhost:8080")).rejects.toMatchObject({ code: "E_PERMISSION" });
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toMatchObject({ code: "E_PERMISSION" });
  });
});
