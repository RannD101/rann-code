import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachmentText, prepareAttachments } from "./attachments.js";

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rann-attachment-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("lampiran", () => {
  it("menyimpan teks sebagai artefak berhash dan mengekstrak isinya", () => {
    const root = temp();
    const workspace = join(root, "project");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "catatan.md"), "# Catatan\nisi penting\n");
    const [attachment] = prepareAttachments([{ path: "catatan.md" }], workspace, join(root, "artifacts"));
    expect(attachment?.kind).toBe("text");
    expect(attachment?.name).toBe("catatan.md");
    expect(attachment?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(attachment?.path).toContain("artifacts/attachments");
    expect(attachmentText(attachment!)).toContain("isi penting");
  });

  it("mengenali gambar dari magic bytes, bukan ekstensi", () => {
    const root = temp();
    const workspace = join(root, "project");
    mkdirSync(workspace);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    writeFileSync(join(workspace, "screenshot.bin"), png);
    const [attachment] = prepareAttachments([{ path: "screenshot.bin", name: "layar.png" }], workspace, join(root, "artifacts"));
    expect(attachment?.kind).toBe("image");
    expect(attachment?.mime).toBe("image/png");
    expect(attachment?.name).toBe("layar.png");
  });

  it("menolak path di luar workspace, symlink, dan tipe biner", () => {
    const root = temp();
    const workspace = join(root, "project");
    mkdirSync(workspace);
    writeFileSync(join(root, "rahasia.txt"), "jangan dibaca");
    expect(() => prepareAttachments([{ path: "../rahasia.txt" }], workspace, join(root, "artifacts"))).toThrow(/di luar workspace/);
    writeFileSync(join(workspace, "biner.bin"), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    expect(() => prepareAttachments([{ path: "biner.bin" }], workspace, join(root, "artifacts"))).toThrow(/tidak didukung/);
  });

  it("menolak total lampiran di atas 50 MB", () => {
    const root = temp();
    const workspace = join(root, "project");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "huge.txt"), Buffer.alloc(20 * 1024 * 1024 + 1, 0x61));
    expect(() => prepareAttachments([{ path: "huge.txt" }], workspace, join(root, "artifacts"))).toThrow(/melebihi 20 MB/);
  });
});
