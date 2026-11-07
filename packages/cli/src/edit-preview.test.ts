import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewEdit } from "./edit-preview.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "rann-preview-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("preview edit", () => {
  it("menghitung baris tambah dan hapus untuk fs_edit", () => {
    const preview = previewEdit("fs_edit", { path: "a.ts", old: "satu\ndua\ntiga", new: "satu\nDIGANTI\ntiga" }, workspace());
    expect(preview).not.toBeNull();
    expect(preview?.added).toBe(1);
    expect(preview?.removed).toBe(1);
    expect(preview?.lines).toEqual(["- dua", "+ DIGANTI"]);
  });

  it("membandingkan isi berkas lama untuk write_file", () => {
    const cwd = workspace();
    writeFileSync(join(cwd, "app.ts"), "alpha\nbeta\n", "utf8");
    const preview = previewEdit("write_file", { path: "app.ts", content: "alpha\ngamma\n" }, cwd);
    expect(preview?.path).toBe("app.ts");
    expect(preview?.added).toBe(1);
    expect(preview?.removed).toBe(1);
  });

  it("mengembalikan null untuk tool yang bukan edit", () => {
    expect(previewEdit("shell_run", { command: "ls" }, workspace())).toBeNull();
  });
});
