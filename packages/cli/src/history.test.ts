import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryStore, isPrivatePrompt } from "./history.js";

const directories: string[] = [];

function store(cwd = "/tmp/proyek"): HistoryStore {
  const dir = mkdtempSync(join(tmpdir(), "rann-history-"));
  directories.push(dir);
  return new HistoryStore(dir, cwd);
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("riwayat prompt", () => {
  it("menyimpan dan memuat ulang per proyek", () => {
    const first = store("/tmp/proyek-a");
    first.add("jelaskan repo ini");
    first.add("buat tes untuk parser");
    const second = new HistoryStore(dirname(first.path), "/tmp/proyek-a");
    expect(second.all().map((entry) => entry.text)).toEqual(["jelaskan repo ini", "buat tes untuk parser"]);
  });

  it("memisahkan riwayat antar folder", () => {
    const first = store("/tmp/proyek-a");
    first.add("pesan a");
    const second = store("/tmp/proyek-b");
    expect(second.all()).toHaveLength(0);
  });

  it("tidak menyimpan prompt privat atau rahasia", () => {
    const history = store();
    expect(history.add("[private] jangan simpan ini")).toBe(false);
    expect(history.add("api key sk-abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(history.add("password: rahasia123")).toBe(false);
    expect(history.add("halo biasa")).toBe(true);
    expect(history.all()).toHaveLength(1);
  });

  it("mendeteksi pola rahasia", () => {
    expect(isPrivatePrompt("token=abc123456")).toBe(true);
    expect(isPrivatePrompt("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(isPrivatePrompt("tolong baca berkas ini")).toBe(false);
  });

  it("mencari dengan fuzzy dan batas waktu", () => {
    const history = store();
    history.add("perbaiki parser argumen");
    history.add("tulis dokumentasi");
    expect(history.search({ search: "prsr" }).map((entry) => entry.text)).toEqual(["perbaiki parser argumen"]);
    expect(history.search({ from: Date.now() + 60_000 })).toHaveLength(0);
  });

  it("menghapus semua riwayat", () => {
    const history = store();
    history.add("satu");
    history.add("dua");
    expect(history.clear()).toBe(2);
    expect(history.all()).toHaveLength(0);
    expect(new HistoryStore(dirname(history.path), "/tmp/proyek").all()).toHaveLength(0);
  });
});
