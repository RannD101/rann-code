import { RannError } from "@rann/shared";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function checkAgentDepth(depth: number, maxDepth: number): void {
  if (depth >= maxDepth) {
    throw new RannError("E_AGENT_DEPTH", `Kedalaman subagent maksimum ${maxDepth} tercapai`, {
      data: { depth, max_depth: maxDepth }
    });
  }
}

export interface SubagentProfile {
  name: string;
  description: string;
  when: string;
  output: string;
  systemPrompt: string;
  tools: string[] | "*";
  permission: "read-only" | "accept-edits";
  maxSteps: number;
  model?: string;
  triggers: string[];
  memory: boolean;
  source: "builtin" | "user" | "project";
}

const BASE_RULES = [
  "Kamu adalah subagent yang bekerja untuk satu tujuan sempit.",
  "Jangan meminta konfirmasi ke pengguna, kamu tidak punya kanal ke pengguna.",
  "Selesaikan tujuan, lalu balas dengan ringkasan bukti: berkas, perintah, hasil.",
  "Kalau gagal, jelaskan sebab sebenarnya dan apa yang sudah dicoba.",
  "Jangan mengubah berkas di luar tujuan."
].join(" ");

function profile(input: Omit<SubagentProfile, "source" | "memory" | "output"> & { memory?: boolean; output?: string }): SubagentProfile {
  return {
    ...input,
    output: input.output ?? "Ringkasan bukti: berkas dan baris yang dibaca atau diubah, perintah yang dijalankan, hasil nyata, dan risiko yang tersisa.",
    memory: input.memory ?? true,
    source: "builtin"
  };
}

export const BUILTIN_PROFILES: SubagentProfile[] = [
  profile({
    name: "explore",
    description: "Memetakan kode dan menjawab pertanyaan tentang isi repo.",
    when: "Butuh pemahaman cepat atas struktur, alur, atau dependensi.",
    systemPrompt: `${BASE_RULES} Fokus membaca: cari berkas relevan, rangkum alur, sebut path dan nomor baris. Jangan mengedit.`,
    tools: ["fs_read", "fs_list", "fs_glob", "search_code", "repo_map", "git_read"],
    permission: "read-only",
    maxSteps: 10,
    triggers: ["cari", "jelaskan", "pahami", "struktur", "di mana", "explore", "rangkum"]
  }),
  profile({
    name: "planner",
    description: "Menyusun rencana implementasi berurutan dengan risiko.",
    when: "Tugas besar perlu dipecah sebelum menyentuh kode.",
    systemPrompt: `${BASE_RULES} Hasilkan rencana bernomor: langkah, berkas yang disentuh, verifikasi, risiko. Jangan menulis kode produksi.`,
    tools: ["fs_read", "fs_list", "fs_glob", "search_code", "repo_map", "git_read"],
    permission: "read-only",
    maxSteps: 8,
    triggers: ["rencana", "plan", "pecah", "arsitektur", "desain"]
  }),
  profile({
    name: "coder",
    description: "Menerapkan perubahan kode kecil dan terverifikasi.",
    when: "Perubahan sudah jelas dan perlu dieksekusi.",
    systemPrompt: `${BASE_RULES} Terapkan perubahan sekecil mungkin, lalu jalankan pemeriksaan yang relevan. Laporkan diff dan hasil perintah.`,
    tools: ["fs_read", "fs_list", "fs_glob", "search_code", "fs_write", "fs_edit", "apply_patch", "shell_run", "project_check", "git_read"],
    permission: "accept-edits",
    maxSteps: 12,
    triggers: ["implementasi", "perbaiki", "ubah", "tulis kode", "refactor", "buat"]
  }),
  profile({
    name: "debugger",
    description: "Menelusuri akar masalah dari gejala dan bukti.",
    when: "Ada error, tes gagal, atau perilaku menyimpang.",
    systemPrompt: `${BASE_RULES} Mulai dari reproduksi, kumpulkan bukti, uji hipotesis satu per satu, lalu usulkan perbaikan minimal. Sebut akar sebab, bukan gejalanya.`,
    tools: ["fs_read", "fs_list", "fs_glob", "search_code", "shell_run", "project_check", "git_read"],
    permission: "read-only",
    maxSteps: 12,
    triggers: ["error", "gagal", "bug", "debug", "kenapa", "crash", "tes merah", "perbaiki bug", "fix bug"]
  }),
  profile({
    name: "reviewer",
    description: "Meninjau diff untuk bug, risiko, dan kelengkapan tes.",
    when: "Sebelum commit atau setelah perubahan besar.",
    systemPrompt: `${BASE_RULES} Tinjau diff terhadap tujuan. Laporkan temuan berurut keparahan dengan path, baris, dampak, dan saran perbaikan. Jangan mengedit.`,
    tools: ["fs_read", "git_read", "project_check", "search_code"],
    permission: "read-only",
    maxSteps: 10,
    triggers: ["review", "tinjau", "audit", "periksa diff", "cek kualitas"]
  }),
  profile({
    name: "tester",
    description: "Menulis dan menjalankan tes untuk perilaku yang berubah.",
    when: "Perlu bukti otomatis bahwa perubahan bekerja.",
    systemPrompt: `${BASE_RULES} Tulis tes yang gagal sebelum perbaikan bila memungkinkan, jalankan, lalu laporkan hasil nyata. Jangan mengaku lulus tanpa keluaran.`,
    tools: ["fs_read", "fs_glob", "search_code", "fs_write", "fs_edit", "shell_run", "project_check", "git_read"],
    permission: "accept-edits",
    maxSteps: 12,
    triggers: ["tes", "test", "uji", "coverage", "verifikasi"]
  }),
  profile({
    name: "researcher",
    description: "Mengumpulkan informasi dari web dan dokumentasi.",
    when: "Butuh fakta eksternal, API, atau pembanding.",
    systemPrompt: `${BASE_RULES} Kumpulkan sumber, kutip URL, pisahkan fakta dan dugaan. Jangan mengarang.`,
    tools: ["fs_read", "fs_glob", "search_code", "repo_map"],
    permission: "read-only",
    maxSteps: 10,
    triggers: ["riset", "cari di web", "dokumentasi", "bandingkan", "referensi"]
  }),
  profile({
    name: "writer",
    description: "Menulis dokumentasi dan teks produk yang rapi.",
    when: "Perlu dokumentasi, changelog, atau teks publikasi.",
    systemPrompt: `${BASE_RULES} Tulis dalam bahasa yang diminta, tanpa basa-basi, tanpa klaim tanpa bukti. Simpan ke berkas bila diminta.`,
    tools: ["fs_read", "fs_write", "fs_edit", "search_code"],
    permission: "accept-edits",
    maxSteps: 8,
    triggers: ["tulis", "dokumentasi", "changelog", "artikel", "readme"]
  }),
  profile({
    name: "architect",
    description: "Merancang batas modul, alur data, dan keputusan teknis.",
    when: "Perlu desain sebelum implementasi atau keputusan arsitektur.",
    systemPrompt: `${BASE_RULES} Petakan batasan, pilihan, trade-off, dan keputusan. Sebut berkas dan antarmuka yang terpengaruh. Jangan menulis kode produksi.`,
    tools: ["fs_read", "fs_list", "fs_glob", "search_code", "repo_map", "git_read"],
    permission: "read-only",
    maxSteps: 10,
    triggers: ["arsitektur", "desain sistem", "batas modul", "trade-off", "keputusan teknis", "architect"],
    output: "Keputusan arsitektur, alternatif yang ditolak, konsekuensi, dan berkas yang perlu berubah."
  }),
  profile({
    name: "coding",
    description: "Alias peran implementasi untuk perubahan lintas bahasa.",
    when: "Tugas implementasi umum tanpa spesialisasi frontend atau backend.",
    systemPrompt: `${BASE_RULES} Terapkan perubahan sekecil yang jelas, jaga gaya repo, lalu jalankan pemeriksaan. Laporkan diff dan hasil nyata.`,
    tools: ["fs_read", "fs_list", "fs_glob", "search_code", "fs_write", "fs_edit", "apply_patch", "shell_run", "project_check", "git_read"],
    permission: "accept-edits",
    maxSteps: 12,
    triggers: ["coding", "kode", "implementasi", "buat fitur", "ubah logika"],
    output: "Diff ringkas, berkas yang berubah, perintah verifikasi, dan hasilnya."
  }),
  profile({
    name: "frontend",
    description: "Mengerjakan UI, komponen, gaya, dan aksesibilitas.",
    when: "Perubahan menyentuh tampilan, komponen, CSS, atau interaksi browser.",
    systemPrompt: `${BASE_RULES} Jaga konsistensi desain yang ada, aksesibilitas, dan perilaku responsif. Uji di browser bila memungkinkan. Jangan mengubah backend tanpa alasan.`,
    tools: ["fs_read", "fs_list", "fs_glob", "search_code", "fs_write", "fs_edit", "apply_patch", "shell_run", "browser", "project_check", "git_read"],
    permission: "accept-edits",
    maxSteps: 12,
    triggers: ["frontend", "ui", "komponen", "css", "tampilan", "react", "aksesibilitas"],
    output: "Komponen yang berubah, perilaku sebelum dan sesudah, serta bukti render atau tes."
  }),
  profile({
    name: "backend",
    description: "Mengerjakan API, database, antrean, dan logika server.",
    when: "Perubahan menyentuh endpoint, skema data, migrasi, atau proses latar.",
    systemPrompt: `${BASE_RULES} Jaga kompatibilitas data, validasi di tepi, dan penanganan error. Sertakan migrasi bila skema berubah dan uji jalur gagal.`,
    tools: ["fs_read", "fs_list", "fs_glob", "search_code", "fs_write", "fs_edit", "apply_patch", "shell_run", "project_check", "git_read"],
    permission: "accept-edits",
    maxSteps: 12,
    triggers: ["backend", "api", "endpoint", "database", "migrasi", "server", "sql"],
    output: "Endpoint atau skema yang berubah, migrasi, tes jalur sukses dan gagal, serta risiko data."
  }),
  profile({
    name: "documentation",
    description: "Menulis dan memperbarui dokumentasi dari fakta repo.",
    when: "Perlu README, panduan, changelog, atau docstring yang akurat.",
    systemPrompt: `${BASE_RULES} Baca kode dan perintah nyata sebelum menulis. Jangan memakai placeholder atau klaim yang tidak bisa dibuktikan. Tulis dalam bahasa yang diminta.`,
    tools: ["fs_read", "fs_list", "fs_glob", "search_code", "fs_write", "fs_edit", "project_check", "git_read"],
    permission: "accept-edits",
    maxSteps: 10,
    triggers: ["dokumentasi", "readme", "panduan", "changelog", "docstring", "documentation"],
    output: "Berkas dokumentasi yang berubah dan daftar fakta repo yang menjadi sumbernya."
  }),
  profile({
    name: "security",
    description: "Meninjau risiko keamanan pada kode sendiri.",
    when: "Ada perubahan yang menyentuh auth, input, berkas, atau jaringan.",
    systemPrompt: `${BASE_RULES} Cari injeksi, kebocoran secret, SSRF, path traversal, otorisasi hilang, dan race. Laporkan dampak nyata dan bukti.`,
    tools: ["fs_read", "fs_glob", "search_code", "git_read", "shell_run"],
    permission: "read-only",
    maxSteps: 10,
    triggers: ["keamanan", "security", "injeksi", "auth", "secret", "celah"]
  })
];

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith("---\n")) return { meta: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { meta, body: text.slice(end + 4).replace(/^\n/, "") };
}

function fromFile(path: string, source: "user" | "project"): SubagentProfile | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const { meta, body } = parseFrontmatter(text);
  const name = meta.name ?? path.replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/, "") ?? "";
  if (!name || body.trim().length === 0) return undefined;
  const tools = (meta.tools ?? "").trim();
  return {
    name,
    description: meta.description ?? body.trim().split("\n")[0]!.slice(0, 160),
    when: meta.when ?? "",
    output: meta.output ?? "Ringkasan bukti: berkas dan baris, perintah, hasil, dan risiko yang tersisa.",
    systemPrompt: body.trim(),
    tools: tools === "*" || tools === "" ? "*" : tools.split(",").map((tool) => tool.trim()).filter(Boolean),
    permission: meta.permission === "accept-edits" ? "accept-edits" : "read-only",
    maxSteps: Number.isFinite(Number(meta.max_steps)) ? Math.max(1, Math.min(Number(meta.max_steps), 30)) : 10,
    ...(meta.model ? { model: meta.model } : {}),
    triggers: (meta.triggers ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    memory: meta.memory !== "false" && meta.memory !== "0",
    source
  };
}

export function loadProfiles(home: string, projectPath?: string): SubagentProfile[] {
  const found = new Map<string, SubagentProfile>();
  for (const profileItem of BUILTIN_PROFILES) found.set(profileItem.name, profileItem);
  const dirs: Array<{ dir: string; source: "user" | "project" }> = [
    { dir: join(home, "agents"), source: "user" }
  ];
  if (projectPath) dirs.push({ dir: join(projectPath, ".rann", "agents"), source: "project" });
  for (const { dir, source } of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const loaded = fromFile(join(dir, file), source);
      if (loaded) found.set(loaded.name, loaded);
    }
  }
  return [...found.values()];
}

export function pickProfile(profiles: SubagentProfile[], requested: string | undefined, goal: string): SubagentProfile {
  if (requested) {
    const exact = profiles.find((item) => item.name === requested);
    if (!exact) throw new Error(`Profil subagent tidak dikenal: ${requested}`);
    return exact;
  }
  const lower = goal.toLowerCase();
  let best: { profile: SubagentProfile; score: number } | undefined;
  for (const item of profiles) {
    const score = item.triggers.reduce((total, trigger) => (lower.includes(trigger.toLowerCase()) ? total + trigger.length : total), 0);
    if (score > 0 && (!best || score > best.score)) best = { profile: item, score };
  }
  return best?.profile ?? profiles.find((item) => item.name === "explore")!;
}
