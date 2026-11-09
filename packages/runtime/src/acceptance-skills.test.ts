import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillStore } from "./skills.js";
import { checkAgentDepth } from "./subagent-profiles.js";

function store(): SkillStore {
  return new SkillStore(mkdtempSync(join(tmpdir(), "rann-ac-prof-")), mkdtempSync(join(tmpdir(), "rann-ac-proj-")));
}

describe("acceptance skill", () => {
  it("AC-079 memilih skill relevan dengan alasan dan tidak mengaktifkan yang tidak relevan", () => {
    const s = store();
    s.create({ name: "presentasi", description: "Gunakan saat menguji skill ini", body: "Buat slide presentasi yang rapi dan mudah dibaca.", triggers: ["presentasi"], scope: "project" });
    s.create({ name: "debug", description: "Gunakan saat menguji skill ini", body: "Cari akar bug sebelum mengubah kode produksi.", triggers: ["debug"], scope: "project" });
    const selected = s.select("buat presentasi produk");
    expect(selected.skills.map((skill) => skill.name)).toContain("presentasi");
    expect(selected.skills.map((skill) => skill.name)).not.toContain("debug");
    expect(selected.reasons.join(" ")).toContain("presentasi");
  });

  it("AC-081 validasi dan dry-run tidak menulis berkas", () => {
    const s = store();
    const validation = s.validate({ name: "dry", description: "Gunakan saat menguji skill ini", body: "Langkah yang cukup panjang untuk validasi skill ini." });
    expect(validation.ok).toBe(true);
    s.create({ name: "dry", description: "Gunakan saat menguji skill ini", body: "Langkah yang cukup panjang untuk validasi skill ini.", scope: "project", dryRun: true });
    expect(s.view("dry")).toBeUndefined();
  });

  it("AC-082 versi naik dan versi lama bisa dipulihkan", () => {
    const s = store();
    s.create({ name: "versi", description: "Gunakan saat menguji skill ini", body: "Isi versi satu yang cukup panjang untuk validasi.", scope: "project" });
    s.create({ name: "versi", description: "Gunakan saat menguji skill ini", body: "Isi versi dua yang cukup panjang untuk validasi.", scope: "project", overwrite: true });
    expect(s.view("versi")?.version).toBe("1.0.1");
    expect(s.history("versi").map((item) => item.version)).toContain("1.0.0");
    const restored = s.restore("versi", "1.0.0");
    expect(restored.version).toBe("1.0.0");
    expect(restored.body).toContain("versi satu");
  });

  it("AC-083 dependensi dimuat lebih dulu dan dependensi hilang ditolak", () => {
    const s = store();
    s.create({ name: "anak", description: "Gunakan saat menguji skill ini", body: "Isi anak yang cukup panjang untuk validasi skill.", scope: "project" });
    s.create({ name: "induk", description: "Gunakan saat menguji skill ini", body: "Pakai anak sebagai langkah pertama yang cukup panjang.", dependencies: ["anak"], scope: "project" });
    const text = s.loadForTask("pakai induk", { include: ["induk"] });
    expect(text.indexOf("### Skill anak")).toBeLessThan(text.indexOf("### Skill induk"));
    expect(() =>
      s.create({ name: "yatim", description: "Gunakan saat menguji skill ini", body: "Butuh dependensi hilang yang cukup panjang.", dependencies: ["hilang"], scope: "project" })
    ).toThrow(/dependensi/);
  });

  it("AC-059 kedalaman subagent dibatasi dengan E_AGENT_DEPTH", () => {
    expect(() => checkAgentDepth(3, 3)).toThrowError(/maksimum/);
    try {
      checkAgentDepth(3, 3);
    } catch (error) {
      expect((error as { code?: string }).code).toBe("E_AGENT_DEPTH");
    }
    expect(() => checkAgentDepth(2, 3)).not.toThrow();
  });

  it("AC-078 hanya SKILL.md dimuat awal dan referensi dibaca sesuai kebutuhan", () => {
    const s = store();
    s.create({ name: "ref", description: "Gunakan saat menguji referensi", body: "Isi utama yang cukup panjang untuk validasi.", scope: "project" });
    const dir = join(dirname(s.view("ref")!.path!), "references");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "detail.md"), "ISI_REFERENSI_RAHASIA");
    expect(s.view("ref")?.references).toContain("detail.md");
    expect(s.catalog()).not.toContain("ISI_REFERENSI_RAHASIA");
    expect(s.readAsset("ref", "detail.md")).toContain("ISI_REFERENSI_RAHASIA");
    expect(s.view("ref")?.tokens).toBeGreaterThan(0);
  });

  it("AC-085 update menolak sumber lebih lama dari versi lokal", () => {
    const s = store();
    s.create({ name: "lokal", description: "Gunakan saat menguji versi lokal", body: "Isi lokal versi satu yang cukup panjang.", scope: "project" });
    s.create({ name: "lokal", description: "Gunakan saat menguji versi lokal", body: "Isi lokal versi dua yang cukup panjang.", scope: "project", overwrite: true });
    const source = join(mkdtempSync(join(tmpdir(), "rann-skill-old-")), "lokal");
    mkdirSync(source, { recursive: true });
    writeFileSync(
      join(source, "SKILL.md"),
      "---\nname: lokal\ndescription: Sumber lama\nversion: 1.0.0\n---\nIsi lama yang cukup panjang untuk validasi.\n"
    );
    expect(() => s.update("lokal", source)).toThrow(/lebih lama/);
  });
});
