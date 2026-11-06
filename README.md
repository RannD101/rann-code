# Rann Code

CLI agent coding lokal dengan daemon, sesi SQLite, memori jangka panjang, skill yang bisa tumbuh, subagent, MCP, dan alur izin eksplisit. Dibangun ulang dari PRD v1.

Status: MVP plus fitur lokal. Semua state disimpan di mesin sendiri. Prompt hanya dikirim ke provider model yang kamu pasang sendiri.

Panduan lengkap dari instalasi sampai update ada di `tutorial.txt`.

Versi teks yang bisa dibagikan: https://github.com/RannD101/rann-code/blob/main/tutorial.txt

## Kebutuhan

- Node.js 22.11 atau lebih baru.
- Windows 10/11, macOS, atau Linux.

pnpm dan Git hanya dibutuhkan kalau kamu mengembangkan source, bukan untuk memakai aplikasi.

## Pasang

Untuk pengguna:

```bash
npm install -g https://github.com/RannD101/rann-code/releases/download/v1.0.0/rann-code-1.0.0.tgz
rann --version
```

Tidak perlu npx, tidak perlu clone repository, dan tidak perlu build dari source. Data disimpan di `~/.rann` (Windows: `%USERPROFILE%\.rann`).

Untuk kontributor yang mengembangkan source:

```bash
pnpm install
pnpm build
pnpm check
```

## Mulai cepat

```bash
cd ~/proyek
rann doctor
rann new --title "Coba pertama"
rann "jelaskan struktur folder ini"
rann chat
```

`rann` tanpa argumen di terminal membuka chat. Di pipe atau cron, tanpa argumen ia mencetak bantuan supaya tidak menggantung.

Provider default `mock` tidak memanggil jaringan. Balasan mock berguna untuk menguji alur, tool call, dan izin. Untuk model sungguhan:

```bash
export OPENAI_API_KEY="isi-key-di-sini"
rann provider add openai --base-url https://api.openai.com/v1 --key-env OPENAI_API_KEY --model gpt-4o-mini
rann config set provider openai
rann "halo"
```

Endpoint lokal seperti Ollama, vLLM, LM Studio, atau router sendiri juga bisa:

```bash
rann provider add lokal --base-url http://127.0.0.1:11434/v1 --key-env LOKAL_API_KEY --model llama3.1
rann config set provider lokal
```

`--key-env` menyimpan nama variabel, bukan nilai key. Key dibaca saat daemon start. Setelah `provider add` atau `config set`, daemon otomatis berhenti supaya config baru dipakai pada perintah berikutnya.

## Perintah

| Perintah | Fungsi |
|---|---|
| `rann` | Buka chat interaktif di terminal |
| `rann "prompt"` | Satu turn lalu keluar |
| `rann chat [--session <id>]` | REPL interaktif |
| `rann new --title "..."` | Membuat sesi baru |
| `rann sessions [--limit N] [--all]` | Daftar sesi di folder ini, atau semua sesi |
| `rann send <id> "teks"` | Kirim prompt ke sesi tertentu |
| `rann resume <id>` | Alias `send` untuk sesi yang sudah ada |
| `rann "..." --detach` | Jalankan turn di latar belakang |
| `rann turn <id> [--wait]` | Lihat status dan hasil turn |
| `rann providers` | Status provider dan ada tidaknya key |
| `rann provider test [nama]` | Uji koneksi provider dan model default |
| `rann models` | Model default dan daftar model |
| `rann usage [sesi]` | Ringkasan token dan biaya per provider/model |
| `rann config get [kunci]` | Lihat config efektif atau satu kunci |
| `rann config explain <kunci>` | Asal nilai config |
| `rann config set <kunci> <nilai>` | Ubah config global |
| `rann memory list\|search\|add\|update\|remove` | Kelola memori lokal |
| `rann skill list\|view\|create\|remove` | Kelola skill lokal |
| `rann doctor` | Cek instalasi, daemon, database, config |
| `rann daemon start\|stop\|status` | Kelola daemon |
| `rann --version` | Versi CLI dan protokol |

Di dalam `rann chat`: `/help`, `/status`, `/sessions`, `/new`, `/model`, `/permission`, `/tools`, `/usage`, `/exit`.

## Memori lokal

Memori disimpan di SQLite, bukan di cloud. Dua scope:

- `global`: berlaku di semua proyek.
- `project`: hanya berlaku di folder proyek yang sama.

```bash
rann memory add "User lebih suka jawaban singkat" --scope global --kind preference --tags gaya,bahasa
rann memory add "Proyek ini memakai pnpm workspace" --scope project --kind convention --tags tooling
rann memory list --scope all
rann memory search "pnpm"
rann memory update <id> --text "Proyek ini memakai pnpm dan TypeScript strict"
rann memory remove <id>
```

Memori global dan memori proyek yang relevan otomatis dimasukkan ke system prompt setiap turn, dengan batas `memory.prompt_chars`. Pencarian memakai FTS5, jadi tetap cepat dan offline.

## Skill lokal

Skill adalah berkas markdown di mesin sendiri. Agent melihat katalog skill lalu membuka isi yang relevan dengan tool `skill`. Tiga sumber:

- `builtin`: skill bawaan, misalnya `debug-sistematis`, `review-kode`, `catat-pelajaran`.
- `global`: tersimpan di `$RANN_HOME/profiles/default/skills/<nama>/SKILL.md`, berlaku di semua proyek.
- `project`: tersimpan di `<proyek>/.rann/skills/<nama>/SKILL.md`, hanya untuk proyek itu.

```bash
rann skill create uji-lokal \
  --description "Gunakan saat menguji alur skill lokal" \
  --body-file skill.md \
  --scope project
rann skill list
rann skill view uji-lokal
rann skill remove uji-lokal --scope project
```

Format `SKILL.md`:

```markdown
# nama-skill

Deskripsi singkat kapan skill ini dipakai.

## Langkah

1. Periksa kondisi awal.
2. Jalankan perintah yang pasti.
3. Verifikasi dengan output asli.
```

Agent juga punya tool `skill` untuk membuat skill baru saat menemukan prosedur yang layak diulang. Ini yang membuat kemampuannya bertambah seiring pemakaian, sama seperti pola skill di Hermes.

## Konteks, budget, dan subagent

- Konteks panjang diringkas otomatis dengan digest lokal. Tidak ada panggilan model tambahan untuk meringkas.
- Budget harian dan per turn dicek dari tabel `usage_events`. Kalau habis, turn ditolak dengan `E_BUDGET_EXHAUSTED` sebelum provider dipanggil.

```bash
rann config set context.max_tokens 24000
rann config set context.keep_recent 20
rann config set budget.max_tokens_per_day 200000
rann config set subagents.max_per_turn 3
```

Tool `task` menjalankan subagent di sesi anak dengan konteks terpisah. Sesi anak tetap tercatat di SQLite yang sama, punya `parent_id`, dan default izinnya `read-only`.

## MCP lokal

Server MCP dijalankan sebagai proses lokal lewat stdio. Tidak ada koneksi ke layanan pihak ketiga. Tambahkan di `$RANN_HOME/config/config.toml`:

```toml
[mcp.servers.echo]
command = "node"
args = ["/path/ke/server-mcp.cjs"]
enabled = true
timeout_ms = 20000
```

Tool dari server muncul sebagai `mcp__<server>__<tool>`. Server dijalankan saat turn pertama membutuhkan tool, lalu ditutup saat daemon berhenti. Kalau server gagal, turn gagal dengan pesan yang menyertakan stderr server.

## Otomasi dan pipe

```bash
rann -p "ringkas repo ini" --output-format json
git diff | rann -p "review diff ini" --output-format json
rann "refactor src/auth.ts" --output-format stream-json
```

`--output-format json` mencetak satu objek ke stdout:

```json
{"ok":true,"result":"...","session_id":"ses_...","turn_id":"turn_...","steps":1,"usage":{"input_tokens":10,"output_tokens":20},"error":null}
```

`stream-json` mencetak NDJSON per event: `message.delta`, `tool.start`, `tool.end`, `approval.request`, `context.compacted`, `subagent.started`, `subagent.finished`, `turn.completed`, `turn.failed`, dan `error`. Log, izin, dan diagnostik tetap di stderr. Tanpa TTY, permintaan izin otomatis ditolak supaya proses tidak menggantung; pakai `--yes` atau mode `trusted` untuk otomasi yang memang boleh menulis.

Turn juga bisa dilepas ke latar belakang. Daemon tetap menjalankannya setelah CLI keluar:

```bash
rann "bangun ulang indeks dokumen" --detach --permission trusted
rann turn turn_abc123 --wait
```

## Izin

Lima mode:

- `read-only`: hanya baca, tool tulis dan shell ditolak.
- `ask`: setiap tool yang mengubah state meminta izin. Default.
- `accept-edits`: tulis dan edit file otomatis, shell tetap bertanya.
- `trusted`: semua tool diizinkan selama masih di dalam workspace.
- `custom`: mengikuti allow dan deny di config.

Saat meminta izin, CLI menampilkan tiga pilihan: setujui sekali, selalu untuk tool itu di sesi tersebut, atau tolak. `--yes` menyetujui semua permintaan pada satu perintah. Pipe dan cron tidak menggantung: tanpa TTY permintaan otomatis ditolak.

Perintah shell berbahaya seperti `rm -rf /`, `mkfs`, atau `shutdown` tetap ditolak walaupun mode `trusted`.

## Penyimpanan

Default di `~/.rann`, bisa dipindah lewat `RANN_HOME`:

```text
~/.rann/
  config/config.toml
  profiles/default/rann.db
  profiles/default/skills/<nama>/SKILL.md
  run/daemon.sock
  logs/daemon.log
```

Database SQLite memakai WAL, foreign key, dan FTS5. Isi utamanya: sesi, pesan, turn, event, tool call, usage, dan memori. Semua sesi terikat ke folder kerja. `rann "..."` memakai sesi aktif dari folder saat ini, `rann sessions` hanya menampilkan folder itu kecuali diberi `--all`.

Tidak ada sinkronisasi cloud, telemetry, atau upload otomatis. Prompt hanya dikirim ke provider model yang kamu pilih. Backup cukup dengan menyalin `~/.rann` dan folder proyek.

## Arsitektur

```text
packages/shared   tipe, error, config, skema RPC, id
packages/storage  SQLite, migrasi, repo sesi, event, usage, memori
packages/runtime  agent loop, tool, policy, provider, daemon, RPC, MCP, skill, subagent
packages/cli      argumen, UI, stream, REPL, perintah
```

CLI tidak menyentuh database langsung. Semua lewat JSON-RPC 2.0 di Unix socket, newline-delimited. Daemon start otomatis saat perintah pertama dan tetap hidup di antara perintah.

## Tes

```bash
pnpm check
```

`pnpm check` menjalankan build, typecheck, seluruh tes Vitest, lint, dan dependency-cruiser. Tes mencakup id, config, error, policy, tool, database, memori dan FTS, katalog skill, agent dengan memori dan skill, budget, MCP, subagent, daemon plus RPC, alur izin setuju dan tolak, serta parser streaming provider OpenAI dengan server HTTP lokal.

## Batasan

Belum ada: plugin pihak ketiga, sinkronisasi antar perangkat, dan antarmuka web. Memori memakai FTS5, belum embedding vektor. Ringkasan konteks memakai digest teks, bukan model kedua. Semua itu sengaja dipilih supaya tetap lokal, ringan, dan tidak menambah ketergantungan layanan luar.
