export type CommandCategory =
  | "umum"
  | "sesi"
  | "model"
  | "agen"
  | "memori"
  | "skill"
  | "tool"
  | "proyek"
  | "konfigurasi"
  | "infra";

export type CommandPermission = "read" | "write" | "exec" | "net" | "admin" | "secret";

export interface CommandArgument {
  name: string;
  required: boolean;
  description?: string;
}

export interface ReplCommand {
  name: string;
  aliases?: string[];
  usage: string;
  description: string;
  category: CommandCategory;
  permission?: CommandPermission;
  arguments: CommandArgument[];
  optionalParams: string[];
  output: Array<"text" | "json" | "markdown">;
  errors: string[];
  handler: string;
  docs: string;
  available?: boolean;
  unavailableReason?: string;
  hidden?: boolean;
  source?: "builtin" | "project" | "plugin";
}

function usageArguments(usage: string): CommandArgument[] {
  const output: CommandArgument[] = [];
  for (const match of usage.matchAll(/<([^>]+)>|\[([^\]]+)\]/g)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (raw.length === 0) continue;
    output.push({ name: raw, required: match[1] !== undefined });
  }
  return output;
}

function cmd(
  name: string,
  aliases: string[],
  usage: string,
  description: string,
  category: CommandCategory,
  permission: CommandPermission = "read",
  available = true,
  unavailableReason?: string
): ReplCommand {
  return {
    name,
    aliases,
    usage,
    description,
    category,
    permission,
    arguments: usageArguments(usage),
    optionalParams: (usage.match(/--[a-z][a-z0-9-]*/g) ?? []).map((flag) => flag.slice(2)),
    output: ["text", "json", "markdown"],
    errors: ["E_INVALID_PARAMS", "E_PERMISSION_DENIED"],
    handler: name,
    docs: `${usage}  ${description}`,
    available,
    source: "builtin",
    ...(unavailableReason ? { unavailableReason } : {})
  };
}

const NOT_YET = "backend belum tersedia di versi ini";

export const BUILTIN_COMMANDS: ReplCommand[] = [
  cmd("help", ["?"], "/help [command]", "Bantuan command dan daftar perintah", "umum"),
  cmd("exit", ["quit", "q"], "/exit [--force]", "Keluar dari sesi interaktif", "umum"),
  cmd("clear", ["cls"], "/clear", "Bersihkan transcript tanpa menghapus state", "umum", "write"),
  cmd("compact", ["summarize"], "/compact", "Ringkas konteks percakapan", "umum", "write"),
  cmd("status", ["st"], "/status [--json]", "Status sesi, model, dan antrean", "umum"),
  cmd("improve", ["imp"], "/improve", "Tinjau proposal self-improvement", "umum", "admin", false, NOT_YET),
  cmd("doctor", ["diag"], "/doctor", "Diagnosis instalasi dan perbaikan aman", "umum"),
  cmd("version", ["v"], "/version [--json]", "Versi CLI, daemon, dan protokol", "umum"),
  cmd("feedback", ["bug"], "/feedback", "Kirim masukan atau laporan bug", "umum", "net"),
  cmd("update", ["upgrade"], "/update", "Periksa dan pasang pembaruan", "umum", "admin", false, NOT_YET),
  cmd("whatsnew", ["changelog"], "/whatsnew", "Lihat perubahan versi", "umum", "read"),
  cmd("model", ["m"], "/model [nama|auto|default]", "Pilih atau kunci model", "model", "write"),
  cmd("models", ["ml"], "/models [filter]", "Daftar model dan capability", "model"),
  cmd("permission", [], "/permission [mode]", "Lihat atau ganti mode izin", "model", "write"),
  cmd("provider", ["pr"], "/provider <id|add|remove|test|login|logout>", "Kelola provider dan kredensial", "model", "admin"),
  cmd("providers", ["prs"], "/providers", "Status semua provider", "model"),
  cmd("cost", ["biaya"], "/cost", "Biaya sesi, task, atau hari ini", "model"),
  cmd("usage", ["u"], "/usage", "Statistik token dan biaya", "model"),
  cmd("budget", ["limit"], "/budget", "Atur batas biaya", "model", "admin"),
  cmd("route", ["routing"], "/route explain <prompt>", "Jelaskan keputusan router", "model", "admin"),
  cmd("login", [], "/login <provider>", "Simpan kredensial provider", "model", "secret"),
  cmd("logout", [], "/logout <provider>", "Hapus kredensial provider", "model", "secret"),
  cmd("agent", [], "/agent <spawn|show|stop|logs>", "Kelola satu instans agen", "agen", "write", false, NOT_YET),
  cmd("delegate", ["del"], "/delegate \"<tugas>\"", "Delegasikan tugas ke subagent", "agen", "exec", false, NOT_YET),
  cmd("tasks", ["t"], "/tasks", "Daftar task dan statusnya", "agen"),
  cmd("task", [], "/task <show|logs|cancel|retry|resume|priority> <id>", "Lihat, kendalikan, atau ubah prioritas task", "agen", "write"),
  cmd("plan", ["p"], "/plan <tugas>", "Buat, lihat, atau setujui rencana", "agen", "write"),
  cmd("execute", ["run"], "/execute <tugas>", "Susun rencana lalu jalankan", "agen", "exec"),
  cmd("cancel", ["stop"], "/cancel", "Batalkan task atau turn", "agen", "write"),
  cmd("pause", [], "/pause [task-id]", "Jeda task yang berjalan", "agen", "write", false, NOT_YET),
  cmd("resume-task", ["lanjut"], "/resume-task [task-id]", "Lanjutkan task yang dijeda", "agen", "write", false, NOT_YET),
  cmd("retry", [], "/retry [task-id]", "Ulangi task atau langkah", "agen", "write", false, NOT_YET),
  cmd("trace", ["why"], "/trace [task-id]", "Telusuri keputusan dan langkah task", "agen", "read", false, NOT_YET),
  cmd("approve", ["yes"], "/approve [approval-id]", "Setujui permintaan izin", "agen", "write", false, NOT_YET),
  cmd("deny", ["no"], "/deny [approval-id]", "Tolak permintaan izin", "agen", "write", false, NOT_YET),
  cmd("goal", [], "/goal <teks> [| kriteria; ...]", "Pasang, cek, atau tutup goal sesi", "agen", "write"),
  cmd("memory", ["mem"], "/memory [list|search|show|edit|rm|pin|unpin]", "Kelola entri memory", "memori", "write"),
  cmd("remember", ["ingat"], "/remember \"<fakta>\"", "Simpan fakta ke memory", "memori", "write"),
  cmd("recall", ["cari"], "/recall \"<query>\"", "Cari memory yang relevan", "memori"),
  cmd("forget", ["lupakan"], "/forget <id|query>", "Hapus memory", "memori", "write"),
  cmd("profile", ["profil"], "/profile", "Lihat atau ubah profil pengguna", "memori", "write"),
  cmd("skills", ["sk"], "/skills", "Daftar skill terpasang", "skill"),
  cmd("skill", [], "/skill <nama>", "Lihat detail satu skill", "skill"),
  cmd("create-skill", ["skill-new"], "/create-skill \"<deskripsi>\"", "Buat skill baru dengan validasi", "skill", "write"),
  cmd("install-skill", ["skill-add"], "/install-skill <nama|url>", "Pasang skill dari registry atau path", "skill", "net", false, NOT_YET),
  cmd("update-skill", [], "/update-skill [nama]", "Perbarui skill", "skill", "net", false, NOT_YET),
  cmd("tools", ["tool-list"], "/tools", "Daftar tool dan statusnya", "tool"),
  cmd("tool", [], "/tool <run|info|enable|disable>", "Jalankan atau periksa satu tool", "tool", "exec"),
  cmd("mcp", [], "/mcp <list|add|remove|test|reload>", "Kelola server MCP", "tool", "admin", false, "Kelola server MCP dari sesi ini"),
  cmd("plugins", ["plug"], "/plugins", "Kelola plugin", "tool", "admin"),
  cmd("hooks", [], "/hooks", "Kelola hook event", "tool", "admin"),
  cmd("init", ["mulai"], "/init", "Inisialisasi project untuk Rann", "proyek", "write"),
  cmd("project", ["proj"], "/project <show|add|remove|switch|trust|untrust>", "Kelola project terdaftar", "proyek", "write"),
  cmd("context", ["ctx"], "/context", "Lihat isi konteks yang dikirim", "proyek", "write"),
  cmd("files", ["ls"], "/files [path]", "Daftar file relevan", "proyek"),
  cmd("review", ["rv"], "/review [fokus]", "Review perubahan kode", "proyek"),
  cmd("test", [], "/test [pattern]", "Jalankan tes project", "proyek", "exec"),
  cmd("debug", [], "/debug \"<gejala>\"", "Mulai sesi debugging", "proyek", "exec"),
  cmd("git", [], "/git <status|diff|log|...>", "Operasi Git yang aman", "proyek", "write"),
  cmd("diff", [], "/diff", "Lihat diff workspace", "proyek"),
  cmd("commit", ["ci"], "/commit -m <pesan>", "Buat commit", "proyek", "write"),
  cmd("branch", [], "/branch", "Kelola branch", "proyek", "write"),
  cmd("worktree", ["wt"], "/worktree", "Kelola worktree", "proyek", "write"),
  cmd("checkpoint", ["cp"], "/checkpoint [list|create|restore]", "Buat atau lihat checkpoint", "proyek", "write"),
  cmd("checkpoints", [], "/checkpoints", "Daftar checkpoint berkas", "proyek"),
  cmd("undo", ["rewind-code"], "/undo [id]", "Kembali ke checkpoint", "proyek", "write"),
  cmd("index", [], "/index [build|status]", "Bangun indeks kode", "proyek", "write", false, NOT_YET),
  cmd("search", ["grep"], "/search \"<query>\"", "Cari kode secara semantik", "proyek"),
  cmd("sessions", ["ss"], "/sessions", "Daftar sesi", "sesi"),
  cmd("resume", ["r"], "/resume <session-id>", "Lanjutkan sesi", "sesi", "write"),
  cmd("fork", [], "/fork", "Duplikasi sesi", "sesi", "write"),
  cmd("rename", [], "/rename \"<nama>\"", "Ganti nama sesi", "sesi", "write"),
  cmd("history", ["hist"], "/history [--limit N] [--search Q]", "Riwayat pesan", "sesi"),
  cmd("rewind", [], "/rewind", "Kembali ke pesan sebelumnya", "sesi", "write", false, NOT_YET),
  cmd("new", [], "/new [--name <nama>]", "Mulai sesi baru", "sesi", "write"),
  cmd("export", [], "/export", "Ekspor sesi atau data", "sesi"),
  cmd("import", [], "/import <path>", "Impor sesi atau data", "sesi", "write", false, NOT_YET),
  cmd("attach", [], "/attach <path>", "Lampirkan file ke konteks", "sesi"),
  cmd("config", ["cfg"], "/config", "Lihat atau ubah config", "konfigurasi", "admin"),
  cmd("permissions", ["perm"], "/permissions", "Kelola mode izin dan policy", "konfigurasi", "admin"),
  cmd("settings", [], "/settings", "Pengaturan umum", "konfigurasi", "admin"),
  cmd("theme", [], "/theme [list|set|preview]", "Pilih tema terminal", "konfigurasi", "write"),
  cmd("secrets", ["keys"], "/secrets", "Kelola secret", "konfigurasi", "secret"),
  cmd("env", [], "/env", "Lihat environment tool", "konfigurasi", "admin"),
  cmd("sandbox", [], "/sandbox", "Status dan batas sandbox", "konfigurasi", "admin"),
  cmd("pair", [], "/pair", "Buat kode pairing perangkat gateway", "infra", "admin"),
  cmd("gateway", ["gw"], "/gateway <status|start|stop|pair|devices|revoke|role>", "Kelola gateway web dan perangkat", "infra", "admin"),
  cmd("messaging", ["msg"], "/messaging <status|send>", "Kelola adapter messaging", "infra", "admin"),
  cmd("agents", [], "/agents <list|get|cancel|profiles|message>", "Kelola subagent", "infra", "admin"),
  cmd("background", ["bg"], "/background <list|add|get|logs|cancel|retry>", "Kelola task latar", "infra", "exec"),
  cmd("queue", [], "/queue", "Kelola antrean job", "infra", "admin"),
  cmd("integrations", ["int"], "/integrations", "Kelola integrasi eksternal", "infra", "admin", false, NOT_YET),
  cmd("logs", [], "/logs", "Lihat log", "infra", "read"),
  cmd("health", [], "/health", "Health check komponen", "infra"),
  cmd("metrics", [], "/metrics", "Lihat metrik", "infra", "read", false, NOT_YET),
  cmd("dashboard", ["web"], "/dashboard", "Buka dashboard web", "infra", "net", false, NOT_YET),
  cmd("whoami", [], "/whoami", "Identitas dan scope saat ini", "infra"),
  cmd("notify", [], "/notify", "Atur notifikasi", "infra", "write", false, NOT_YET)
];

export let REPL_COMMANDS: ReplCommand[] = [...BUILTIN_COMMANDS];

const BY_NAME = new Map<string, ReplCommand>();
const CONFLICTS: string[] = [];

function indexCommands(): void {
  BY_NAME.clear();
  for (const command of REPL_COMMANDS) {
    BY_NAME.set(command.name.toLowerCase(), command);
    for (const alias of command.aliases ?? []) BY_NAME.set(alias.toLowerCase(), command);
  }
}

indexCommands();

export function registerCommands(commands: ReplCommand[]): string[] {
  const conflicts: string[] = [];
  for (const command of commands) {
    const existing = BY_NAME.get(command.name.toLowerCase());
    if (existing) {
      conflicts.push(`${command.name} dari ${command.source ?? "kustom"} menimpa ${existing.source ?? "bawaan"}`);
      REPL_COMMANDS = REPL_COMMANDS.filter((item) => item !== existing);
    }
    REPL_COMMANDS = [...REPL_COMMANDS, command];
  }
  indexCommands();
  CONFLICTS.push(...conflicts);
  return conflicts;
}

export function commandConflicts(): string[] {
  return [...CONFLICTS];
}

export function findReplCommand(name: string): ReplCommand | undefined {
  return BY_NAME.get(name.toLowerCase());
}

export function isAvailable(command: ReplCommand): boolean {
  return command.available !== false;
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

export function matchReplCommands(query: string, options: { includeUnavailable?: boolean; limit?: number } = {}): ReplCommand[] {
  return REPL_COMMANDS.filter((command) => options.includeUnavailable === true || isAvailable(command))
    .map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .slice(0, options.limit ?? 50)
    .map((entry) => entry.command);
}

export function nearestCommands(query: string, limit = 3): ReplCommand[] {
  const needle = query.toLowerCase();
  const scored = REPL_COMMANDS.map((command) => {
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of [command.name, ...(command.aliases ?? [])]) {
      best = Math.min(best, levenshtein(needle, candidate.toLowerCase()));
    }
    return { command, distance: best };
  });
  return scored
    .sort((a, b) => a.distance - b.distance || a.command.name.localeCompare(b.command.name))
    .slice(0, limit)
    .map((entry) => entry.command);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min((current[j - 1] ?? 0) + 1, (previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

export function completeReplLine(line: string): [string[], string] {
  if (!line.startsWith("/") || line.includes(" ")) return [[], line];
  const query = line.slice(1);
  const hits = matchReplCommands(query).map((command) => `/${command.name}`);
  return [hits, line];
}

const CATEGORY_ORDER: CommandCategory[] = [
  "umum",
  "sesi",
  "model",
  "agen",
  "memori",
  "skill",
  "tool",
  "proyek",
  "konfigurasi",
  "infra"
];

export function renderCommandCatalog(version: string, query?: string): string {
  const needle = query?.trim().toLowerCase() ?? "";
  if (needle.length > 0) {
    const command = REPL_COMMANDS.find(
      (item) => item.name.toLowerCase() === needle || item.aliases?.some((alias) => alias.toLowerCase() === needle)
    );
    if (!command) {
      const nearest = nearestCommands(needle, 3);
      return [
        `Command tidak ditemukan: ${query}`,
        nearest.length > 0 ? `Mungkin maksud kamu: ${nearest.map((item) => item.name).join(", ")}` : "",
        "Jalankan rann --help untuk daftar lengkap."
      ].filter(Boolean).join("\n");
    }
    const lines = [
      `rann-code ${version}`,
      "",
      `Command: /${command.name}${command.aliases?.length ? ` (alias: ${command.aliases.map((alias) => `/${alias}`).join(", ")})` : ""}`,
      `Pemakaian: ${command.usage}`,
      `Kategori: ${command.category}`,
      `Izin: ${command.permission ?? "read"}`,
      `Status: ${isAvailable(command) ? "tersedia" : `belum tersedia (${command.unavailableReason ?? "backend"})`}`,
      "",
      command.description,
      command.docs && command.docs !== `${command.usage}  ${command.description}` ? command.docs : "",
      command.arguments.length > 0 ? `Argumen: ${command.arguments.map((arg) => `${arg.name}${arg.required ? " (wajib)" : " (opsional)"}`).join(", ")}` : "",
      command.optionalParams.length > 0 ? `Flag: ${command.optionalParams.map((flag) => `--${flag}`).join(", ")}` : "",
      `Error: ${command.errors.join(", ")}`
    ];
    return lines.filter((line) => line !== "").join("\n");
  }
  const lines = [`rann-code ${version}`, "", "Pemakaian:", "  rann \"instruksi\"              kirim tugas ke sesi terbaru", "  rann chat                     sesi interaktif", "  rann help <command>           bantuan satu command", "", "Command:"];
  for (const category of CATEGORY_ORDER) {
    const items = REPL_COMMANDS.filter((command) => command.category === category && !command.hidden);
    if (items.length === 0) continue;
    lines.push("", `${category}:`);
    for (const command of items) {
      const status = isAvailable(command) ? "" : ` [belum tersedia: ${command.unavailableReason ?? "backend"}]`;
      lines.push(`  ${command.usage.padEnd(34)} ${command.description}${status}`);
    }
  }
  lines.push("", "Flag umum:", "  --model <nama>        override model", "  --permission <mode>   read-only | ask | accept-edits | trusted | custom", "  --yes                 setujui otomatis semua permintaan tool", "  --output-format <f>   text | json | stream-json | ndjson", "  --theme <nama>        dark | light | auto | custom", "  --no-color            matikan warna dan escape ANSI", "  -v, --version         versi", "  -h, --help            bantuan");
  return lines.join("\n");
}
