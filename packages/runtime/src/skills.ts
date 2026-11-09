import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RannError } from "@rann/shared";

export type SkillScope = "global" | "project" | "builtin";

export interface SkillInfo {
  name: string;
  description: string;
  scope: SkillScope;
  path?: string;
  version: string;
  updated_at: number;
  triggers: string[];
  dependencies: string[];
  source?: string;
  active: boolean;
  checksum?: string;
}

export interface SkillContent extends SkillInfo {
  body: string;
  /** Perkiraan token isi SKILL.md yang dimuat; referensi dihitung saat dibaca. */
  tokens?: number;
  references?: string[];
  scripts?: string[];
}

export interface SkillSelection {
  skills: SkillContent[];
  reasons: string[];
}

interface SkillMeta {
  name?: string;
  description?: string;
  version?: string;
  triggers?: string[];
  dependencies?: string[];
  source?: string;
}

interface UsageRecord {
  uses: number;
  successes: number;
  failures: number;
  last_used_at: number;
}

const BUILTIN_SKILLS: Array<{ name: string; description: string; version: string; triggers: string[]; body: string }> = [
  {
    name: "debug-sistematis",
    version: "1.0.0",
    triggers: ["bug", "error", "gagal", "crash", "debug", "tidak sesuai"],
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
    version: "1.0.0",
    triggers: ["review", "diff", "pull request", "pr", "audit kode"],
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
    version: "1.0.0",
    triggers: ["pelajaran", "post-mortem", "setelah selesai", "retro"],
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
    if (key === "name" || key === "description" || key === "version" || key === "source") meta[key] = value;
    if (key === "trigger" || key === "triggers" || key === "dependencies") {
      const list = value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      if (key === "dependencies") meta.dependencies = list;
      else meta.triggers = list;
    }
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

function semverBump(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return "1.0.1";
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
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
    version: meta.version ?? "1.0.0",
    scope,
    path,
    updated_at: statSync(path).mtimeMs,
    body,
    triggers: meta.triggers ?? [],
    dependencies: meta.dependencies ?? [],
    ...(meta.source ? { source: meta.source } : {}),
    active: true,
    checksum: hashText(raw)
  };
}

function readDirSkills(dir: string, scope: SkillScope): SkillContent[] {
  if (!existsSync(dir)) return [];
  const skills: SkillContent[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "versions") continue;
    const parsed = parseSkillFile(join(dir, entry.name, "SKILL.md"), entry.name, scope);
    if (parsed) skills.push(parsed);
  }
  return skills;
}

function parseVersion(value: string): number[] {
  return value.replace(/^v/, "").split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

function versionSatisfies(installed: string, constraint: string): boolean {
  if (!constraint || constraint === "*" || constraint === "latest") return true;
  const base = parseVersion(constraint.replace(/^[\^~]|>=|<=|>|</, ""));
  const current = parseVersion(installed);
  const compare = (a: number[], b: number[]): number => {
    for (let index = 0; index < 3; index += 1) {
      if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
    }
    return 0;
  };
  if (constraint.startsWith("^")) return compare(current, base) >= 0 && current[0] === base[0];
  if (constraint.startsWith("~")) return compare(current, base) >= 0 && current[0] === base[0] && current[1] === base[1];
  if (constraint.startsWith(">=")) return compare(current, base) >= 0;
  if (constraint.startsWith(">")) return compare(current, base) > 0;
  if (constraint.startsWith("<=")) return compare(current, base) <= 0;
  if (constraint.startsWith("<")) return compare(current, base) < 0;
  return compare(current, base) === 0;
}

export class SkillStore {
  private readonly globalDir: string;
  private readonly projectDir: string;
  private readonly projectPath: string;
  private selected: SkillSelection = { skills: [], reasons: [] };

  constructor(profileDir: string, projectPath: string) {
    this.globalDir = join(profileDir, "skills");
    this.projectDir = join(projectPath, ".rann", "skills");
    this.projectPath = projectPath;
  }

  private all(): SkillContent[] {
    const byName = new Map<string, SkillContent>();
    for (const skill of BUILTIN_SKILLS) {
      byName.set(skill.name, { ...skill, scope: "builtin", updated_at: 0, active: true, dependencies: [] });
    }
    for (const skill of readDirSkills(this.globalDir, "global")) byName.set(skill.name, skill);
    for (const skill of readDirSkills(this.projectDir, "project")) byName.set(skill.name, skill);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Nama yang ada di dua scope sekaligus; project menang, tetapi bentrok dilaporkan. */
  conflicts(): Array<{ name: string; scopes: SkillScope[] }> {
    const found = new Map<string, SkillScope[]>();
    for (const skill of [...readDirSkills(this.globalDir, "global"), ...readDirSkills(this.projectDir, "project")]) {
      const scopes = found.get(skill.name) ?? [];
      scopes.push(skill.scope);
      found.set(skill.name, scopes);
    }
    return [...found.entries()]
      .filter(([, scopes]) => scopes.length > 1)
      .map(([name, scopes]) => ({ name, scopes }));
  }

  list(limit = 40): SkillInfo[] {
    const activeNames = new Set(this.selected.skills.map((skill) => skill.name));
    return this.all()
      .slice(0, limit)
      .map(({ body: _body, ...info }) => ({ ...info, active: activeNames.size === 0 ? info.active : activeNames.has(info.name) }));
  }

  catalog(limit = 40): string {
    const skills = this.list(limit);
    if (skills.length === 0) return "";
    return [
      "SKILL LOKAL (katalog, bukan isi penuh):",
      ...skills.map((skill) => {
        const triggers = skill.triggers.length > 0 ? ` | trigger: ${skill.triggers.join(", ")}` : "";
        return `- ${skill.name} (${skill.scope}, v${skill.version}): ${skill.description}${triggers}`;
      }),
      "Baca isi skill dengan tool skill action=view sebelum memakainya."
    ].join("\n");
  }

  async runScript(
    name: string,
    script: string,
    args: string[] = [],
    options: {
      timeoutMs?: number;
      signal?: AbortSignal;
      /** Broker tool untuk skrip; menerima nama tool dan argumen, mengembalikan output. */
      broker?: (tool: string, args: unknown) => Promise<unknown>;
    } = {}
  ): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    const skill = this.view(name);
    if (!skill) throw new RannError("E_TOOL_NOT_FOUND", `Skill tidak ditemukan: ${name}`);
    if (!skill.path) throw new RannError("E_TOOL_FAILED", `Skill builtin ${name} tidak punya skrip`);
    if (!/^[a-zA-Z0-9._-]+$/.test(script)) throw new RannError("E_TOOL_INVALID_ARGS", "nama skrip hanya huruf, angka, titik, garis bawah, atau strip");
    const root = dirname(skill.path);
    const file = resolve(root, "scripts", script);
    if (!file.startsWith(`${resolve(root, "scripts")}/`) || !existsSync(file)) throw new RannError("E_NOT_FOUND", `Skrip tidak ditemukan: ${script}`);
    const timeout = Math.min(Math.max(options.timeoutMs ?? 30_000, 1_000), 600_000);
    const started = Date.now();
    const socketPath = options.broker ? join(tmpdir(), `rann-skill-${randomBytes(6).toString("hex")}.sock`) : undefined;
    const token = options.broker ? randomBytes(16).toString("hex") : undefined;
    const brokerServer = options.broker
      ? createServer((request, response) => {
          const reply = (status: number, body: unknown): void => {
            response.writeHead(status, { "content-type": "application/json" });
            response.end(JSON.stringify(body));
          };
          if (request.url !== "/tool" || request.headers.authorization !== `Bearer ${token}`) {
            reply(403, { error: "token broker tidak valid" });
            return;
          }
          let raw = "";
          request.on("data", (chunk) => {
            raw += String(chunk);
            if (raw.length > 1_000_000) request.destroy();
          });
          request.on("end", () => {
            void (async () => {
              try {
                const parsed = JSON.parse(raw || "{}") as { tool?: string; args?: unknown };
                if (!parsed.tool) {
                  reply(400, { error: "tool wajib diisi" });
                  return;
                }
                reply(200, { ok: true, output: await options.broker!(parsed.tool, parsed.args ?? {}) });
              } catch (error) {
                reply(200, { ok: false, error: (error as Error).message });
              }
            })();
          });
        })
      : undefined;
    if (brokerServer && socketPath) {
      await new Promise<void>((resolve) => brokerServer.listen(socketPath, resolve));
    }
    const cleanup = (): void => {
      brokerServer?.close();
      if (socketPath) {
        try {
          unlinkSync(socketPath);
        } catch {
          // socket mungkin sudah hilang
        }
      }
    };
    try {
      return await new Promise((done, reject) => {
      const child = spawn(file, args, {
        cwd: this.projectPath,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          TMPDIR: process.env.TMPDIR ?? "",
          RANN_SKILL: name,
          RANN_PROJECT: this.projectPath,
          ...(socketPath ? { RANN_TOOL_BROKER_SOCKET: socketPath } : {}),
          ...(token ? { RANN_TOOL_BROKER_TOKEN: token } : {})
        },
        stdio: ["ignore", "pipe", "pipe"],
        signal: options.signal
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (result: { ok: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        done(result);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ ok: false, exitCode: 124, stdout: stdout.slice(0, 200_000), stderr: `${stderr.slice(0, 200_000)}\nskrip melewati timeout ${timeout} ms`.trim(), durationMs: Date.now() - started });
      }, timeout);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > 400_000) child.kill("SIGKILL");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (stderr.length > 400_000) child.kill("SIGKILL");
      });
      child.on("error", (error) => reject(new RannError("E_TOOL_FAILED", `Skrip gagal dijalankan: ${error.message}`)));
      child.on("close", (code) => finish({ ok: code === 0, exitCode: code ?? 1, stdout: stdout.slice(0, 200_000), stderr: stderr.slice(0, 200_000), durationMs: Date.now() - started }));
      });
    } finally {
      cleanup();
    }
  }

  view(name: string): SkillContent | undefined {
    const key = slug(name);
    const skill = this.all().find((item) => item.name === key);
    if (!skill?.path) return skill;
    const listDir = (dir: string): string[] => {
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .sort();
      } catch {
        return [];
      }
    };
    const baseDir = skill.path.endsWith("SKILL.md") ? dirname(skill.path) : skill.path;
    return {
      ...skill,
      tokens: Math.ceil(skill.body.length / 4),
      references: listDir(join(baseDir, "references")),
      scripts: listDir(join(baseDir, "scripts"))
    };
  }

  /**
   * Pilih maksimal tiga skill berdasarkan trigger dan deskripsi.
   * Riwayat keberhasilan dipakai sebagai pengali skor, bukan penentu tunggal.
   */
  select(task: string, options: { max?: number; include?: string[]; exclude?: string[] } = {}): SkillSelection {
    const text = task.toLowerCase();
    const include = new Set((options.include ?? []).map(slug));
    const exclude = new Set((options.exclude ?? []).map(slug));
    const usage = this.readUsage();
    const scored: Array<{ skill: SkillContent; score: number; reason: string }> = [];

    for (const skill of this.all()) {
      if (exclude.has(skill.name)) continue;
      const turns = usage[skill.name];
      const successRate = turns && turns.uses > 0 ? turns.successes / turns.uses : 0.5;
      let score = 0;
      const reasons: string[] = [];
      if (include.has(skill.name)) {
        score += 100;
        reasons.push("dipilih pengguna");
      }
      for (const trigger of skill.triggers) {
        if (trigger.length > 1 && text.includes(trigger.toLowerCase())) {
          score += 6;
          reasons.push(`trigger "${trigger}"`);
        }
      }
      for (const word of skill.description.toLowerCase().split(/[^a-z0-9]+/)) {
        if (word.length > 3 && text.includes(word)) score += 1;
      }
      if (score <= 0) continue;
      score += successRate * 2;
      if (turns && turns.uses > 0) reasons.push(`riwayat ${turns.successes}/${turns.uses}`);
      scored.push({ skill, score, reason: reasons.join(", ") || "kecocokan deskripsi" });
    }

    scored.sort((a, b) => b.score - a.score);
    const limit = Math.max(1, Math.min(options.max ?? 3, 10));
    const picked = scored.slice(0, limit);
    this.selected = {
      skills: picked.map((item) => item.skill),
      reasons: picked.map((item) => `${item.skill.name}: ${item.reason}`)
    };
    return this.selected;
  }

  loadForTask(task: string, options: { max?: number; include?: string[]; exclude?: string[] } = {}): string {
    const selection = this.select(task, options);
    if (selection.skills.length === 0) return "";
    const ordered = this.withDependencies(selection.skills);
    const blocks = ordered.map((skill) => `### Skill ${skill.name} v${skill.version}\n${skill.body}`);
    return [
      "SKILL YANG DIPILIH UNTUK TUGAS INI:",
      ...selection.reasons.map((reason) => `- ${reason}`),
      ...blocks
    ].join("\n\n");
  }

  recordUse(name: string, success: boolean): void {
    const usage = this.readUsage();
    const key = slug(name);
    const record = usage[key] ?? { uses: 0, successes: 0, failures: 0, last_used_at: 0 };
    record.uses += 1;
    if (success) record.successes += 1;
    else record.failures += 1;
    record.last_used_at = Date.now();
    usage[key] = record;
    this.writeUsage(usage);
  }

  private usagePath(): string {
    return join(this.globalDir, ".usage.json");
  }

  private readUsage(): Record<string, UsageRecord> {
    try {
      return JSON.parse(readFileSync(this.usagePath(), "utf8")) as Record<string, UsageRecord>;
    } catch {
      return {};
    }
  }

  private writeUsage(usage: Record<string, UsageRecord>): void {
    mkdirSync(this.globalDir, { recursive: true, mode: 0o700 });
    writeFileSync(this.usagePath(), JSON.stringify(usage, null, 2), { mode: 0o600 });
  }

  /** Urutkan dependensi lebih dulu dan tolak siklus atau dependensi hilang. */
  withDependencies(skills: SkillContent[]): SkillContent[] {
    const byName = new Map(this.all().map((skill) => [skill.name, skill]));
    const result: SkillContent[] = [];
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (skill: SkillContent, chain: string[]): void => {
      if (done.has(skill.name)) return;
      if (visiting.has(skill.name)) throw new RannError("E_TOOL_FAILED", `Siklus dependensi: ${[...chain, skill.name].join(" -> ")}`);
      visiting.add(skill.name);
      for (const dependency of skill.dependencies) {
        const at = dependency.lastIndexOf("@");
        const base = (at > 0 ? dependency.slice(0, at) : dependency.replace(/[@^~].*$/, "")).trim();
        const constraint = at > 0 ? dependency.slice(at + 1).trim() : "";
        const found = byName.get(slug(base));
        if (!found) throw new RannError("E_TOOL_FAILED", `Skill ${skill.name} butuh ${base} yang tidak terpasang`);
        if (constraint && !versionSatisfies(found.version, constraint)) {
          throw new RannError("E_TOOL_FAILED", `Skill ${skill.name} butuh ${base} versi ${constraint}, terpasang ${found.version}`);
        }
        visit(found, [...chain, skill.name]);
      }
      visiting.delete(skill.name);
      done.add(skill.name);
      result.push(skill);
    };
    for (const skill of skills) visit(skill, []);
    return result;
  }

  validate(input: { name: string; description: string; body: string; triggers?: string[]; dependencies?: string[] }): {
    ok: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!/^[a-z0-9][a-z0-9-_]{1,63}$/.test(slug(input.name))) errors.push("nama harus 2-64 karakter huruf kecil, angka, atau tanda hubung");
    if (input.description.trim().length < 12) errors.push("deskripsi minimal 12 karakter dan sebutkan kapan dipakai");
    if (input.body.trim().length < 20) errors.push("isi minimal 20 karakter");
    if ((input.triggers ?? []).length === 0) warnings.push("trigger kosong, skill tidak akan terpilih otomatis");
    for (const dependency of input.dependencies ?? []) {
      if (!this.view(dependency)) errors.push(`dependensi tidak ditemukan: ${dependency}`);
    }
    for (const match of input.body.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1]!;
      if (/^https?:/.test(target) || target.startsWith("#")) continue;
      warnings.push(`referensi berkas tidak diverifikasi: ${target}`);
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  create(input: {
    name: string;
    description: string;
    body: string;
    scope?: "global" | "project";
    overwrite?: boolean;
    triggers?: string[];
    dependencies?: string[];
    source?: string;
    actor?: string;
    reason?: string;
    dryRun?: boolean;
    active?: boolean;
  }): SkillInfo {
    const name = slug(input.name);
    if (BUILTIN_SKILLS.some((skill) => skill.name === name)) {
      throw new RannError("E_TOOL_INVALID_ARGS", `Nama skill bawaan tidak boleh ditimpa: ${name}`);
    }
    const validation = this.validate({ ...input, name });
    if (!validation.ok) throw new RannError("E_TOOL_INVALID_ARGS", validation.errors.join("; "));
    const scope = input.scope ?? "project";
    const dir = scope === "global" ? this.globalDir : this.projectDir;
    const target = join(dir, name, "SKILL.md");
    const existing = existsSync(target) ? parseSkillFile(target, name, scope) : undefined;
    if (existing && input.overwrite !== true) {
      throw new RannError("E_TOOL_FAILED", `Skill ${name} sudah ada. Set overwrite=true untuk mengganti.`);
    }
    const version = existing ? semverBump(existing.version) : "1.0.0";
    if (input.dryRun === true) {
      return {
        name,
        description: input.description.trim(),
        scope,
        version,
        updated_at: Date.now(),
        triggers: input.triggers ?? [],
        dependencies: input.dependencies ?? [],
        active: input.active ?? true,
        ...(input.source ? { source: input.source } : {})
      };
    }
    mkdirSync(join(dir, name), { recursive: true, mode: 0o700 });
    if (existing) {
      const versionsDir = join(dir, name, "versions");
      mkdirSync(versionsDir, { recursive: true, mode: 0o700 });
      copyFileSync(target, join(versionsDir, `${existing.version}-${Date.now()}.md`));
      this.appendChangelog(join(dir, name), {
        version,
        previous: existing.version,
        actor: input.actor ?? "user",
        reason: input.reason ?? "diperbarui",
        at: Date.now()
      });
    }
    const content = [
      "---",
      `name: ${name}`,
      `description: ${input.description.trim().replace(/\r?\n/g, " ")}`,
      `version: ${version}`,
      `trigger: ${(input.triggers ?? []).join(", ")}`,
      `dependencies: ${(input.dependencies ?? []).join(", ")}`,
      ...(input.source ? [`source: ${input.source}`] : []),
      "---",
      "",
      input.body.trim(),
      ""
    ].join("\n");
    writeFileSync(target, content, { encoding: "utf8", mode: 0o600 });
    return this.view(name)!;
  }

  edit(name: string, patch: { body?: string; description?: string; triggers?: string[]; reason?: string; actor?: string }): SkillInfo {
    const existing = this.view(name);
    if (!existing) throw new RannError("E_NOT_FOUND", `Skill tidak ditemukan: ${name}`);
    if (existing.scope === "builtin") throw new RannError("E_PERMISSION", "Skill bawaan tidak bisa diedit langsung");
    return this.create({
      name: existing.name,
      description: patch.description ?? existing.description,
      body: patch.body ?? existing.body,
      scope: existing.scope === "project" ? "project" : "global",
      overwrite: true,
      triggers: patch.triggers ?? existing.triggers,
      dependencies: existing.dependencies,
      source: existing.source,
      reason: patch.reason ?? "diedit",
      actor: patch.actor ?? "user"
    });
  }

  history(name: string): Array<{ version: string; file: string; at: number }> {
    const skill = this.view(name);
    if (!skill?.path) return [];
    const dir = join(skill.path, "..", "versions");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => {
        const [version = "0.0.0", stamp = "0"] = file.replace(/\.md$/, "").split("-");
        return { version, file: join(dir, file), at: Number(stamp) };
      })
      .sort((a, b) => b.at - a.at);
  }

  changelog(name: string): Array<{ version: string; previous: string; actor: string; reason: string; at: number }> {
    const skill = this.view(name);
    if (!skill?.path) return [];
    try {
      const raw = readFileSync(join(skill.path, "..", "CHANGELOG.jsonl"), "utf8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { version: string; previous: string; actor: string; reason: string; at: number })
        .reverse();
    } catch {
      return [];
    }
  }

  rollback(name: string, version?: string): SkillInfo {
    const skill = this.view(name);
    if (!skill?.path) throw new RannError("E_NOT_FOUND", `Skill tidak ditemukan: ${name}`);
    const history = this.history(name);
    const target = version ? history.find((item) => item.version === version) : history[0];
    if (!target) throw new RannError("E_NOT_FOUND", `Versi tidak ditemukan: ${version ?? "terbaru"}`);
    const raw = readFileSync(target.file, "utf8");
    const { meta, body } = splitFrontmatter(raw);
    return this.create({
      name: skill.name,
      description: meta.description ?? skill.description,
      body,
      scope: skill.scope === "global" ? "global" : "project",
      overwrite: true,
      triggers: meta.triggers ?? skill.triggers,
      dependencies: meta.dependencies ?? skill.dependencies,
      reason: `rollback ke ${target.version}`,
      actor: "user"
    });
  }

  private appendChangelog(dir: string, entry: { version: string; previous: string; actor: string; reason: string; at: number }): void {
    const path = join(dir, "CHANGELOG.jsonl");
    let existing = "";
    try {
      existing = readFileSync(path, "utf8");
    } catch {
      existing = "";
    }
    writeFileSync(path, `${existing}${JSON.stringify(entry)}\n`, { mode: 0o600 });
  }

  /** Pasang skill dari folder lokal atau Git HTTPS. Sumber dicatat untuk update. */
  install(source: string, options: { scope?: "global" | "project"; name?: string; approve?: boolean } = {}): SkillInfo {
    const scope = options.scope ?? "project";
    const dir = scope === "global" ? this.globalDir : this.projectDir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const staging = join(dir, `.install-${Date.now()}`);
    if (/^https:\/\/.+\.git$/.test(source) || /^git@/.test(source)) {
      if (options.approve !== true) throw new RannError("E_APPROVAL_REQUIRED", "Instalasi dari Git butuh persetujuan eksplisit");
      execFileSync("git", ["clone", "--depth", "1", source, staging], { stdio: "pipe", timeout: 120_000 });
    } else if (/^https:\/\//.test(source)) {
      if (options.approve !== true) throw new RannError("E_APPROVAL_REQUIRED", "Instalasi tarball HTTPS butuh persetujuan eksplisit");
      const [rawUrl, fragment] = source.split("#sha256=");
      const url = rawUrl ?? source;
      if (!/\.(tgz|tar\.gz)(\?|$)/i.test(url)) throw new RannError("E_TOOL_INVALID_ARGS", "URL HTTPS harus menunjuk tarball .tgz atau .tar.gz");
      const archive = `${staging}.tgz`;
      execFileSync("curl", ["-fsSL", "--max-time", "120", url, "-o", archive], { stdio: "pipe", timeout: 130_000 });
      const digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
      if (fragment && fragment.toLowerCase() !== digest) {
        rmSync(archive, { force: true });
        throw new RannError("E_TOOL_FAILED", `Checksum tarball tidak cocok: ${digest}`);
      }
      mkdirSync(staging, { recursive: true, mode: 0o700 });
      execFileSync("tar", ["-xzf", archive, "-C", staging, "--strip-components=1"], { stdio: "pipe", timeout: 60_000 });
      rmSync(archive, { force: true });
    } else {
      const resolved = resolve(source);
      if (!existsSync(resolved)) throw new RannError("E_NOT_FOUND", `Sumber skill tidak ditemukan: ${source}`);
      cpSync(resolved, staging, { recursive: true });
    }
    const skillFile = join(staging, "SKILL.md");
    if (!existsSync(skillFile)) {
      rmSync(staging, { recursive: true, force: true });
      throw new RannError("E_TOOL_INVALID_ARGS", "SKILL.md tidak ada di sumber");
    }
    const parsed = parseSkillFile(skillFile, options.name ?? "skill", scope);
    if (!parsed) {
      rmSync(staging, { recursive: true, force: true });
      throw new RannError("E_TOOL_INVALID_ARGS", "Frontmatter skill tidak valid");
    }
    const target = join(dir, parsed.name);
    if (existsSync(target)) {
      rmSync(staging, { recursive: true, force: true });
      throw new RannError("E_TOOL_FAILED", `Skill ${parsed.name} sudah ada. Pakai update.`);
    }
    cpSync(staging, target, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    return this.view(parsed.name)!;
  }

  /** Pulihkan versi lama dari folder versions tanpa menghapus riwayat. */
  restore(name: string, version: string): SkillInfo {
    const skill = this.view(name);
    if (!skill?.path) throw new RannError("E_NOT_FOUND", `Skill tidak ditemukan: ${name}`);
    const entry = this.history(name).find((item) => item.version === version);
    if (!entry) throw new RannError("E_NOT_FOUND", `Versi ${version} tidak ada untuk skill ${name}`);
    copyFileSync(entry.file, skill.path);
    return this.view(name)!;
  }

  update(name: string, source?: string): SkillInfo {
    const skill = this.view(name);
    if (!skill?.path) throw new RannError("E_NOT_FOUND", `Skill tidak ditemukan: ${name}`);
    const origin = source ?? skill.source;
    if (!origin) throw new RannError("E_TOOL_INVALID_ARGS", "Skill tidak punya sumber untuk update");
    const installedDir = join(skill.path, "..");
    const temp = `${installedDir}.update-${Date.now()}`;
    if (/^https:\/\/.+\.git$/.test(origin)) {
      execFileSync("git", ["clone", "--depth", "1", origin, temp], { stdio: "pipe", timeout: 120_000 });
    } else {
      cpSync(resolve(origin), temp, { recursive: true });
    }
    const fresh = parseSkillFile(join(temp, "SKILL.md"), name, skill.scope);
    if (!fresh) {
      rmSync(temp, { recursive: true, force: true });
      throw new RannError("E_TOOL_INVALID_ARGS", "Sumber update tidak punya SKILL.md valid");
    }
    if (fresh.version === skill.version) {
      rmSync(temp, { recursive: true, force: true });
      return skill;
    }
    const parse = (value: string): number[] => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
    const nextVersion = parse(fresh.version);
    const currentVersion = parse(skill.version);
    for (let index = 0; index < 3; index += 1) {
      if ((nextVersion[index] ?? 0) < (currentVersion[index] ?? 0)) {
        rmSync(temp, { recursive: true, force: true });
        throw new RannError("E_APPROVAL_REQUIRED", `Sumber ${fresh.version} lebih lama dari versi lokal ${skill.version}`);
      }
      if ((nextVersion[index] ?? 0) > (currentVersion[index] ?? 0)) break;
    }
    const freshBody = fresh.body;
    const freshDescription = fresh.description;
    const freshTriggers = fresh.triggers;
    const freshDependencies = fresh.dependencies;
    rmSync(temp, { recursive: true, force: true });
    return this.create({
      name: fresh.name,
      description: freshDescription,
      body: freshBody,
      scope: skill.scope === "global" ? "global" : "project",
      overwrite: true,
      triggers: freshTriggers,
      dependencies: freshDependencies,
      source: origin,
      reason: "update dari sumber",
      actor: "user"
    });
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

  readAsset(name: string, file: string, kind: "references" | "scripts" = "references"): string | undefined {
    const skill = this.view(name);
    if (!skill?.path) return undefined;
    const base = join(skill.path.endsWith("SKILL.md") ? dirname(skill.path) : skill.path, kind);
    const target = resolve(base, file);
    if (target !== base && !target.startsWith(base + "/")) throw new RannError("E_PERMISSION", `Path aset skill keluar folder ${kind}`);
    if (!existsSync(target)) return undefined;
    return readFileSync(target, "utf8");
  }

  paths(): { global: string; project: string } {
    return { global: this.globalDir, project: this.projectDir };
  }
}
