import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFileCheckpoint,
  listFileCheckpoints,
  pruneFileCheckpoints,
  restoreFileCheckpoint
} from "./checkpoint-files.js";

function setup(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "rann-cp-"));
  const dir = join(root, ".rann", "checkpoints");
  mkdirSync(dir, { recursive: true });
  return { root, dir };
}

describe("checkpoint berkas", () => {
  it("membuat snapshot dan mengembalikan seluruh berkas", () => {
    const { root, dir } = setup();
    writeFileSync(join(root, "a.txt"), "satu", "utf8");
    writeFileSync(join(root, "b.txt"), "dua", "utf8");
    const manifest = createFileCheckpoint(root, dir, { label: "sebelum ubah" });
    expect(manifest.files.map((file) => file.path).sort()).toEqual(["a.txt", "b.txt"]);

    writeFileSync(join(root, "a.txt"), "berubah", "utf8");
    writeFileSync(join(root, "b.txt"), "berubah juga", "utf8");
    const result = restoreFileCheckpoint(root, dir, manifest.id, { force: true });
    expect(result.restored.sort()).toEqual(["a.txt", "b.txt"]);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("satu");
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("dua");
  });

  it("menolak rollback bila berkas berubah tanpa force", () => {
    const { root, dir } = setup();
    writeFileSync(join(root, "a.txt"), "awal", "utf8");
    const manifest = createFileCheckpoint(root, dir);
    writeFileSync(join(root, "a.txt"), "diubah user", "utf8");
    expect(() => restoreFileCheckpoint(root, dir, manifest.id)).toThrowError(/berubah setelah checkpoint/);
  });

  it("mendaftar dan membersihkan checkpoint lama", () => {
    const { root, dir } = setup();
    writeFileSync(join(root, "a.txt"), "x", "utf8");
    const first = createFileCheckpoint(root, dir, { label: "satu" });
    const second = createFileCheckpoint(root, dir, { label: "dua" });
    expect(listFileCheckpoints(dir).map((item) => item.id)).toEqual([second.id, first.id]);
    expect(pruneFileCheckpoints(dir, 1)).toBe(1);
    expect(listFileCheckpoints(dir).map((item) => item.id)).toEqual([second.id]);
  });
});
