export interface ReplCommand {
  name: string;
  aliases?: string[];
  usage: string;
  description: string;
  category: "sesi" | "model" | "rencana" | "berkas" | "memori" | "diagnosa";
}

export const REPL_COMMANDS: ReplCommand[] = [
  { name: "help", usage: "/help [kata]", description: "Daftar perintah atau cari perintah", category: "diagnosa" },
  { name: "new", usage: "/new [judul]", description: "Mulai sesi baru", category: "sesi" },
  { name: "status", usage: "/status", description: "Status sesi, model, izin, dan folder", category: "sesi" },
  { name: "sessions", usage: "/sessions", description: "Daftar sesi di folder ini", category: "sesi" },
  { name: "exit", aliases: ["quit", "q"], usage: "/exit", description: "Keluar dari REPL", category: "sesi" },
  { name: "model", usage: "/model [nama]", description: "Lihat atau ganti model sesi", category: "model" },
  { name: "models", usage: "/models", description: "Daftar model yang tersedia", category: "model" },
  { name: "provider", usage: "/provider [nama]", description: "Lihat atau ganti provider", category: "model" },
  { name: "permission", usage: "/permission [mode]", description: "Lihat atau ganti mode izin", category: "model" },
  { name: "plan", usage: "/plan <tugas>", description: "Susun rencana tanpa menjalankan tool", category: "rencana" },
  { name: "goal", usage: "/goal <teks> [| kriteria; ...]", description: "Pasang, cek, atau tutup goal sesi (status, check, done, cancel)", category: "rencana" },
  { name: "execute", usage: "/execute <tugas>", description: "Susun rencana lalu jalankan", category: "rencana" },
  { name: "tasks", usage: "/tasks", description: "Daftar rencana dan tugas", category: "rencana" },
  { name: "cancel", usage: "/cancel", description: "Batalkan turn yang berjalan", category: "rencana" },
  { name: "checkpoints", usage: "/checkpoints", description: "Daftar checkpoint berkas", category: "berkas" },
  { name: "undo", usage: "/undo [id]", description: "Pulihkan checkpoint terakhir atau id tertentu", category: "berkas" },
  { name: "review", usage: "/review [fokus]", description: "Minta agent meninjau perubahan yang belum di-commit", category: "berkas" },
  { name: "memory", usage: "/memory [kata]", description: "Cari atau daftar memori", category: "memori" },
  { name: "remember", usage: "/remember <teks>", description: "Simpan fakta ke memori project", category: "memori" },
  { name: "forget", usage: "/forget <id>", description: "Hapus memori berdasarkan id", category: "memori" },
  { name: "skills", usage: "/skills", description: "Daftar skill global dan project", category: "memori" },
  { name: "skill", usage: "/skill <nama>", description: "Tampilkan isi skill", category: "memori" },
  { name: "tools", usage: "/tools", description: "Daftar tool yang tersedia", category: "diagnosa" },
  { name: "usage", usage: "/usage", description: "Token dan biaya sesi ini", category: "diagnosa" },
  { name: "cost", usage: "/cost", description: "Rincian biaya per model", category: "diagnosa" },
  { name: "budget", usage: "/budget", description: "Pemakaian budget hari ini", category: "diagnosa" }
];

const BY_NAME = new Map<string, ReplCommand>();
for (const command of REPL_COMMANDS) {
  BY_NAME.set(command.name.toLowerCase(), command);
  for (const alias of command.aliases ?? []) BY_NAME.set(alias.toLowerCase(), command);
}

export function findReplCommand(name: string): ReplCommand | undefined {
  return BY_NAME.get(name.toLowerCase());
}

export function commandName(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return "";
  return (trimmed.slice(1).split(/\s+/, 1)[0] ?? "").toLowerCase();
}

export function scoreCommand(command: ReplCommand, query: string): number {
  const needle = query.toLowerCase();
  if (needle.length === 0) return 0;
  for (const candidate of [command.name, ...(command.aliases ?? [])]) {
    if (candidate.toLowerCase() === needle) return 100;
    if (candidate.toLowerCase().startsWith(needle)) return 80 - candidate.length;
  }
  if (command.description.toLowerCase().includes(needle)) return 40;
  if (command.category.includes(needle)) return 35;
  let index = 0;
  let gaps = 0;
  for (const char of command.name.toLowerCase()) {
    if (char === needle[index]) index += 1;
    else if (index > 0) gaps += 1;
    if (index === needle.length) return 20 - gaps;
  }
  return -1;
}

export function matchReplCommands(query: string): ReplCommand[] {
  return REPL_COMMANDS.map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .map((entry) => entry.command);
}

export function completeReplLine(line: string): [string[], string] {
  if (!line.startsWith("/") || line.includes(" ")) return [[], line];
  const query = line.slice(1);
  const hits = matchReplCommands(query).map((command) => `/${command.name}`);
  return [hits, line];
}
