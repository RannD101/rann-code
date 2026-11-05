import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RannError } from "@rann/shared";

export type SkillScope = "global" | "project" | "builtin";

export interface SkillInfo {
  name: string;
  description: string;
  scope: SkillScope;
  path?: string;
  version: string;
  updated_at: number;
}

export interface SkillContent extends SkillInfo {
  body: string;
}

interface SkillMeta {
  name?: string;
  description?: string;
  version?: string;
}

const BUILTIN_SKILLS: Array<{ name: string; description: string; version: string; body: string }> = [
  {
    name: "debug-sistematis",
    version: "1",
    description: "Gunakan saat ada bug, error, atau perilaku yang tidak sesuai. Menelusuri akar masalah sebelum mengubah kode.",
    body: [
      "1. Tulis gejala persis: pesan error, input, dan hasil yang diharapkan.",
      "2. Reproduksi dulu. Kalau tidak bisa direproduksi, jangan menebak perbaikan.",
      "3. Persempit lapisan: input, logika, IO, konfigurasi, atau lingkungan.",
      "4. Baca kode di jalur yang dilalui data, dari titik masuk sampai titik gagal.",
      "5. Ubah satu hal, lalu jalankan ulang bukti yang sama.",
      "6. Setelah hijau, jalankan tes lain yang mungkin terdampak.",
      "7. Catat penyebab dan perbaikan sebagai memori kalau pelajarannya tahan lama."
    ].join("\n")
  },
  {
    name: "review-kode",
    version: "1",
    description: "Gunakan saat memeriksa diff, PR, atau perubahan sebelum dirilis. Fokus pada bug nyata, bukan selera.",
    body: [
      "1. Baca tujuan perubahan dan tes yang menyertainya.",
      "2. Cari bug: input kosong, batas nilai, error yang ditelan, race condition, dan kebocoran resource.",
      "3. Periksa keamanan: path traversal, perintah shell, secret di log, dan izin yang terlalu luas.",
      "4. Periksa kompatibilitas: pemanggil lama, format data, dan migrasi.",
      "5. Jalankan tes yang relevan. Laporkan hasil nyata, bukan dugaan.",
      "6. Tulis temuan dengan path, baris, dampak, dan saran perbaikan konkret."
    ].join("\n")
  },
  {
    name: "catat-pelajaran",
    version: "1",
    description: "Gunakan setelah tugas rumit selesai. Memisahkan fakta tahan lama untuk memori dan alur berulang untuk skill.",
    body: [
      "Simpan ke memori kalau isinya preferensi user, fakta lingkungan, konvensi proyek, atau koreksi yang berlaku lagi.",
      "Buat skill kalau isinya langkah kerja yang akan diulang: urutan perintah, jebakan, dan cara verifikasi.",
      "Jangan simpan progres tugas, output sementara, atau rahasia.",
      "Tulis memori sebagai fakta pendek. Tulis skill sebagai instruksi bernomor yang bisa dijalankan."
    ].join("\n")
  }
];

function splitFrontmatter(raw: string): { meta: SkillMeta; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw.trim() };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw.trim() };
  const header = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "").trim();
  const meta: SkillMeta = {};
  for (const line of header.split(/\r?\n/)) {
    const match = /^([a-zA-Z_]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1]!;
    const value = match[2]!.replace(/^["']|["']$/g, "").trim();
    if (key === "name" || key === "description" || key === "version") meta[key] = value;
  }
  return { meta, body };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseSkillFile(path: string, fallbackName: string, scope: SkillScope): SkillContent | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const { meta, body } = splitFrontmatter(raw);
  const name = slug(meta.name ?? fallbackName);
  if (!name) return undefined;
  return {
    name,
    description: meta.description ?? "",
    version: meta.version ?? "1",
    scope,
    path,
    updated_at: statSync(path).mtimeMs,
    body
  };
}

function readDirSkills(dir: string, scope: SkillScope): SkillContent[] {
  if (!existsSync(dir)) return [];
  const skills: SkillContent[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const parsed = parseSkillFile(join(dir, entry.name, "SKILL.md"), entry.name, scope);
    if (parsed) skills.push(parsed);
  }
  return skills;
}

export class SkillStore {
  private readonly globalDir: string;
  private readonly projectDir: string;

  constructor(profileDir: string, projectPath: string) {
    this.globalDir = join(profileDir, "skills");
    this.projectDir = join(projectPath, ".rann", "skills");
  }

  private all(): SkillContent[] {
    const byName = new Map<string, SkillContent>();
    for (const skill of BUILTIN_SKILLS) {
      byName.set(skill.name, { ...skill, scope: "builtin", updated_at: 0 });
    }
    for (const skill of readDirSkills(this.globalDir, "global")) byName.set(skill.name, skill);
    for (const skill of readDirSkills(this.projectDir, "project")) byName.set(skill.name, skill);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  list(limit = 40): SkillInfo[] {
    return this.all()
      .slice(0, limit)
      .map(({ body: _body, ...info }) => info);
  }

  catalog(limit = 40): string {
    const skills = this.list(limit);
    if (skills.length === 0) return "";
    return [
      "SKILL LOKAL (katalog, bukan isi penuh):",
      ...skills.map((skill) => `- ${skill.name} (${skill.scope}): ${skill.description}`),
      "Baca isi skill dengan tool skill action=view sebelum memakainya."
    ].join("\n");
  }

  view(name: string): SkillContent | undefined {
    const key = slug(name);
    return this.all().find((skill) => skill.name === key);
  }

  create(input: {
    name: string;
    description: string;
    body: string;
    scope?: "global" | "project";
    overwrite?: boolean;
  }): SkillInfo {
    const name = slug(input.name);
    if (!/^[a-z0-9][a-z0-9-_]{1,63}$/.test(name)) {
      throw new RannError("E_TOOL_INVALID_ARGS", "Nama skill harus 2-64 karakter: huruf kecil, angka, tanda hubung.");
    }
    if (BUILTIN_SKILLS.some((skill) => skill.name === name)) {
      throw new RannError("E_TOOL_INVALID_ARGS", `Nama skill bawaan tidak boleh ditimpa: ${name}`);
    }
    const description = input.description.trim();
    if (description.length < 12) throw new RannError("E_TOOL_INVALID_ARGS", "Deskripsi skill minimal 12 karakter dan sebutkan kapan dipakai.");
    const body = input.body.trim();
    if (body.length < 20) throw new RannError("E_TOOL_INVALID_ARGS", "Isi skill minimal 20 karakter.");
    if (body.length > 60_000) throw new RannError("E_TOOL_INVALID_ARGS", "Isi skill maksimal 60.000 karakter.");
    const scope = input.scope ?? "project";
    const dir = scope === "global" ? this.globalDir : this.projectDir;
    const target = join(dir, name, "SKILL.md");
    if (existsSync(target) && input.overwrite !== true) {
      throw new RannError("E_TOOL_FAILED", `Skill ${name} sudah ada. Set overwrite=true untuk mengganti.`);
    }
    mkdirSync(join(dir, name), { recursive: true, mode: 0o700 });
    const content = [
      "---",
      `name: ${name}`,
      `description: ${description.replace(/\r?\n/g, " ")}`,
      "version: 1",
      "---",
      "",
      body,
      ""
    ].join("\n");
    writeFileSync(target, content, { encoding: "utf8", mode: 0o600 });
    return this.view(name)!;
  }

  remove(name: string, scope: "global" | "project" = "project"): boolean {
    const key = slug(name);
    if (BUILTIN_SKILLS.some((skill) => skill.name === key)) {
      throw new RannError("E_PERMISSION", `Skill bawaan tidak bisa dihapus: ${key}`);
    }
    const dir = scope === "global" ? this.globalDir : this.projectDir;
    const target = join(dir, key);
    if (!existsSync(target)) return false;
    rmSync(target, { recursive: true, force: true });
    return true;
  }

  paths(): { global: string; project: string } {
    return { global: this.globalDir, project: this.projectDir };
  }
}
