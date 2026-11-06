# CLI EXPERIENCE. Terminal, UX, dan Slash Command Registry

- Dokumen induk: MASTER.md
- Versi: 1.0
- Requirement terkait: RC-FR-001 sampai RC-FR-020
- Acceptance criteria: RC-AC-001 sampai RC-AC-020

## 10. UX/UI specifications

### 10.1 Prinsip antarmuka

Terminal adalah produk utama, bukan lapisan tipis di atas API. Tiga prinsip yang mengikat seluruh keputusan UI:

1. Pengguna selalu tahu apa yang sedang terjadi. Status agen, tool, model, token, biaya, dan izin terlihat tanpa harus membuka log.
2. Pengguna bisa berhenti kapan saja tanpa kehilangan pekerjaan. Interupsi menyimpan state, bukan membuang konteks.
3. Tampilan tidak berbohong. Progres, biaya, dan hasil verifikasi berasal dari data nyata. Jika belum diketahui, tulis "belum diketahui", bukan angka palsu.

Semua elemen interaktif harus bisa diakses dengan keyboard. Mouse opsional, bukan syarat.

### 10.2 Tata letak REPL

Layar dibagi menjadi empat zona yang tidak saling menimpa:

```
┌──────────────────────────────────────────────────────────────┐
│ Header: project, branch, session id, permission mode         │
├──────────────────────────────────────────────────────────────┤
│ Transcript                                                   │
│  kamu: ...                                                   │
│  rann: ...                                                   │
│  [tool] read_file src/app.ts          sukses  42ms           │
│  [plan] 3/7 langkah                                          │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Aktivitas: coding-agent menulis src/app.ts (2 file tersisa)  │
├──────────────────────────────────────────────────────────────┤
│ › input                                                      │
│ status: model · ctx 34% · 12.4k token · $0.031 · izin: ask   │
└──────────────────────────────────────────────────────────────┘
```

Aturan render:

- Header hanya muncul saat sesi punya project atau model non-default, untuk menghemat satu baris.
- Transcript mendukung scrollback terminal biasa. Rann Code tidak memakai alternate screen untuk transcript, sehingga output bisa disalin dan dicari dengan fitur terminal.
- Panel aktivitas hanya memakai satu baris. Detail lengkap dibuka dengan Ctrl+O.
- Status bar selalu satu baris. Jika sempit, prioritas: model, context, izin, biaya.
- Saat terminal tidak mendukung warna, header dan status bar memakai prefix teks (`[model]`, `[ctx]`).

### 10.3 Input dan editor

Input adalah editor multiline ringan dengan perilaku berikut:

| Aksi | Tombol |
|---|---|
| Kirim | Enter |
| Baris baru | Shift+Enter atau Ctrl+J |
| Pindah baris | Alt+Up, Alt+Down, atau Ctrl+P/N saat kursor di awal/akhir |
| Awal/akhir baris | Ctrl+A, Ctrl+E |
| Hapus kata | Ctrl+W |
| Hapus ke awal baris | Ctrl+U |
| Riwayat sebelumnya/berikutnya | Up, Down saat input satu baris |
| Cari riwayat | Ctrl+R |
| Buka editor eksternal | Ctrl+X Ctrl+E |
| Batalkan | Esc |
| Sisipkan path | `@` lalu ketik nama file |
| Jalankan shell langsung | `!` di awal baris |
| Tempel gambar | Ctrl+V (didukung terminal yang mengirim clipboard image) |
| Buka panel detail | Ctrl+O |
| Hentikan giliran | Ctrl+C sekali |
| Keluar | Ctrl+D saat input kosong, atau `/exit` |

Aturan `@`:

- Mengetik `@` membuka fuzzy finder file yang menghormati `.gitignore`.
- Memilih file menyisipkan path relatif dan menambahkan referensi file ke konteks giliran itu.
- `@src/` membuka pemilih direktori.
- `@symbol:nama` mencari simbol lewat indeks tree-sitter.
- Path absolut di luar workspace hanya bisa disisipkan jika permission mengizinkan.

Aturan `!`:

- `!ls -la` menjalankan perintah shell langsung tanpa model.
- Output masuk ke transcript sebagai tool result dan tetap dicatat audit.
- Perintah berisiko melewati permission gate yang sama seperti tool shell agen.
- `!!` menjalankan perintah dan mengirim outputnya sebagai konteks ke model.

### 10.4 Command palette

Palette dibuka dengan `/` pada posisi awal input atau di mana pun setelah spasi. Struktur baris:

```
/  Cari command...                                   12 dari 84
  ── Sesi ─────────────────────────────────────────────────────
  /resume      Lanjutkan sesi sebelumnya        [arg: id]
  /sessions    Daftar sesi                      [filter]
  ── Model ────────────────────────────────────────────────────
  /model       Pilih atau ganti model           [nama|auto]
  /cost        Biaya sesi ini                   [--json]
```

Perilaku:

- Mengetik setelah `/` menjalankan fuzzy match pada nama, alias, dan deskripsi. Skor mengutamakan prefix nama, lalu alias, lalu kata di deskripsi.
- Panah atas/bawah memindahkan seleksi, Tab melengkapi nama command, Enter menjalankan, Esc menutup tanpa mengubah input.
- Saat command dipilih, hint argumen muncul di bawah palette dengan tipe dan nilai yang sah.
- Command yang butuh izin tinggi diberi label `[admin]` atau `[secret]`.
- Command yang tidak tersedia karena konteks (misalnya `/cancel` saat tidak ada task) tetap terlihat dengan alasan, bukan disembunyikan.
- Jika tidak ada hasil, tampilkan tiga saran terdekat dan opsi `Cari di bantuan`.

### 10.5 Streaming dan render Markdown

Streaming memakai model delta, bukan menunggu jawaban utuh. Aturan:

- Teks dirender per delta dengan buffer 16 ms agar tidak flicker.
- Code fence dirender dengan syntax highlight setelah fence ditutup, sementara isinya tetap terlihat sebagai teks monospace selama streaming.
- Tabel Markdown dirapikan setelah baris terakhir tabel diterima; sebelumnya ditampilkan apa adanya.
- Link ditampilkan sebagai teks dengan URL di bawahnya jika terminal tidak mendukung hyperlink OSC 8.
- Selama streaming, status bar menampilkan token masuk dan keluar yang bertambah, ditandai `estimasi` sampai usage final diterima.
- Jika stream terputus, teks yang sudah diterima dipertahankan, diberi penanda `[terputus]`, dan agen boleh melanjutkan atau mengulang berdasarkan kebijakan retry.

### 10.6 Tool execution display

Setiap tool call menghasilkan satu blok ringkas:

```
[tool] edit_file  src/server/auth.ts  +12 -3   124ms   ok
       ↳ 3 hunk, verifikasi baca ulang cocok
```

Status yang mungkin: `menunggu izin`, `antre`, `jalan`, `ok`, `gagal`, `dilewati`, `dibatalkan`. Blok gagal menampilkan kode error dan satu baris penyebab. Ctrl+O membuka detail berisi argumen yang sudah disunting (secret disensor), output mentah sampai 10.000 karakter, path artefak untuk output lebih besar, dan durasi per fase.

Tool call paralel dikelompokkan dalam satu blok induk dengan anak bertingkat. Jika lebih dari lima anak, hanya tiga yang ditampilkan dan sisanya diringkas `+N lainnya`.

### 10.7 Status bar dan indikator konteks

Format default:

```
gpt-5 · ctx 34% (68k/200k) · 12.4k token · $0.031 · ask
```

Aturan:

- `ctx` adalah persentase konteks terpakai terhadap context window model aktif. Di atas 75 persen berubah menjadi `ctx 78% !`, di atas 92 persen `ctx 94% kritis`.
- Token menampilkan total input dan output sesi, bukan per giliran. `/usage` memberi rincian.
- Biaya memakai harga registry. Jika harga model tidak diketahui, tampil `$?` dan `/cost` menjelaskan bahwa harga belum terdaftar.
- Mode izin selalu tampil. `trusted` diberi warna peringatan dan label `TRUSTED`.
- Saat model di-pin, nama model diberi awalan `*`. Saat router memilih, tampil `auto:nama`.
- Provider yang sedang tidak sehat ditandai `!` dan `/status` menunjukkan fallback aktif.

### 10.8 Approval dialog

Dialog persetujuan memakai panel tetap di bawah transcript, bukan prompt y/n yang mudah salah ketik.

```
┌ Perlu izin: shell ───────────────────────────────────────────┐
│ Perintah: pnpm test                                          │
│ Alasan: memverifikasi perubahan di src/auth.ts               │
│ Dampak: menjalankan 42 tes, akses jaringan: tidak            │
│                                                              │
│ [1] Setujui sekali   [2] Selalu untuk pola ini               │
│ [3] Tolak            [4] Tolak dan beri alasan               │
│ [d] Lihat detail     [Esc] Batalkan seluruh task             │
└──────────────────────────────────────────────────────────────┘
```

Aturan:

- Untuk perubahan file, tampilkan diff berwarna dengan konteks tiga baris dan jumlah `+/-`.
- Untuk perintah shell, tampilkan perintah lengkap, working directory, dan perkiraan efek (baca, tulis, jaringan).
- Untuk akses jaringan, tampilkan domain dan metode.
- "Selalu untuk pola ini" menyimpan rule dengan cakupan project dan masa berlaku yang bisa dicabut lewat `/permissions`.
- Jika pengguna memilih tolak dengan alasan, alasan masuk ke konteks agen sebagai feedback, bukan hanya penolakan.
- Timeout default 10 menit. Setelah timeout, task masuk status `waiting_approval`, bukan gagal, kecuali `--approval-timeout` diatur lain.
- Di mode non-interaktif, approval hanya bisa diberikan lewat `--allow-tool`, `--allow-pattern`, atau `--permission-mode`; jika tidak ada, exit code 3.

### 10.9 Interrupt, queue, dan resume

Ctrl+C tidak langsung mematikan proses.

1. Tekan pertama: kirim sinyal batal ke tool yang sedang berjalan, hentikan stream, simpan checkpoint, dan tandai giliran `interrupted`.
2. Tekan kedua dalam 2 detik: hentikan paksa proses anak, tetap simpan state terakhir.
3. Saat idle: Ctrl+C mengosongkan input. Ctrl+D keluar.

Setelah interupsi, prompt menampilkan `[interrupted] lanjutkan, ulangi, atau batalkan?` dengan pilihan keyboard. Pesan pengguna berikutnya yang diawali "lanjut" melanjutkan dari langkah terakhir. `/resume` memilih checkpoint lain.

Pesan yang dikirim saat agen bekerja masuk antrean. Di transcript muncul `[antre] pesan kamu akan diproses setelah langkah ini`. Command read-only dieksekusi segera.

### 10.10 Terminal resize dan fallback

Resize ditangani dengan debounce 100 ms dan render ulang dari model tampilan, bukan dari byte terakhir. Tidak ada state visual yang disimpan hanya di layar.

Fallback bertingkat:

| Kondisi | Perilaku |
|---|---|
| `TERM=dumb` | Tanpa warna, tanpa animasi, tanpa cursor positioning, output linear |
| `NO_COLOR=1` | Warna dimatikan, simbol status tetap |
| Lebar < 50 kolom | Layout satu kolom, tabel menjadi daftar, status bar dua baris |
| Bukan TTY (pipe) | Mode non-interaktif otomatis, tidak ada prompt |
| Terminal tanpa Unicode | Glyph ASCII (`[ok]`, `[x]`, `->`) |
| `CI=1` | Tanpa spinner, log garis waktu, exit code ketat |
| Screen reader | `--accessible`, tanpa spinner, semua update status menjadi baris log |

### 10.11 Tema dan warna

Tema adalah kumpulan token warna, bukan kode warna tersebar. Token minimal: `text`, `muted`, `accent`, `success`, `warning`, `danger`, `border`, `code`, `diffAdd`, `diffDel`, `diffContext`.

Tema bawaan: `default` (mengikuti 16 warna terminal), `dark`, `light`, `mono`, `high-contrast`. Tema plugin boleh menambah, tetapi harus mendeklarasikan kontras minimum. `/theme` menampilkan pratinjau sebelum menyimpan.

### 10.12 Non-interaktif dan pipe

Tiga bentuk pemakaian:

```bash
# satu tugas, output teks
rann -p "jelaskan struktur repo ini"

# output JSON untuk otomasi
rann -p "daftar endpoint di src/routes" --output-format json

# stream JSON per event
rann -p "refactor src/auth.ts" --output-format stream-json --max-turns 40

# stdin sebagai konteks
git diff | rann -p "review diff ini" --output-format json

# mode agent penuh tanpa TTY
rann run --task task_01H... --detach
```

Kontrak:

- `-p` dan positional prompt setara. Jika keduanya ada, positional menang dan `-p` menjadi konteks tambahan.
- `--output-format json` mengembalikan satu objek: `{ok, result, usage, cost, session_id, task_id, error, artifacts}`.
- `stream-json` mengeluarkan NDJSON dengan tipe event: `turn.start`, `message.delta`, `tool.start`, `tool.end`, `plan.update`, `approval.request`, `turn.end`, `error`.
- Log, spinner, dan diagnostik selalu ke stderr. stdout bersih.
- Exit code: 0 sukses, 1 gagal, 2 argumen salah, 3 butuh approval, 4 provider tidak tersedia, 130 SIGINT, 143 SIGTERM.
- `--timeout` membatasi total durasi. Saat habis, proses menyimpan state dan keluar 124.

### 10.13 First-run experience

Saat pertama kali dijalankan, `rann` melakukan:

1. Membuat `~/.rann/` dengan permission 0700.
2. Menjalankan migrasi database.
3. Mendeteksi provider dari environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`) tanpa mencetak nilainya.
4. Jika tidak ada provider, menampilkan pilihan: daftar provider, masukkan API key, atau pakai endpoint lokal.
5. Menanyakan model default dengan rekomendasi berdasarkan provider yang tersedia.
6. Menawarkan `rann init` jika direktori saat ini adalah repo.
7. Menampilkan tiga contoh perintah yang bisa langsung dicoba.

First-run tidak boleh memaksa login cloud. Rann Code harus bisa dipakai dengan Ollama atau endpoint OpenAI-compatible tanpa akun Rann.

### 10.14 Pesan error dan pemulihan

Semua error punya bentuk:

```
E_PROVIDER_AUTH: provider menolak kredensial (401)
  Model: anthropic/claude-sonnet-4-5
  Sumber kunci: keychain "rann:anthropic"
  Saran: jalankan /provider test anthropic atau /login anthropic
  Trace: 01J...
```

Aturan: kode mesin di awal, penjelasan satu baris, konteks yang relevan, satu sampai tiga saran konkret, trace id. Tidak ada stack trace di UI normal; `--debug` atau `/logs --trace` membukanya. Error yang bisa dipulihkan otomatis tidak ditampilkan sebagai error, cukup sebagai catatan di panel aktivitas.

## 11. Slash command registry

### 11.1 Kontrak definisi command

Setiap command didefinisikan sebagai objek berikut. Registry melakukan validasi saat start; command tidak valid membuat `rann doctor` gagal, bukan diam-diam diabaikan.

```ts
interface CommandDefinition {
  name: string;                 // tanpa slash, unik
  aliases: string[];            // minimal satu jika command sering dipakai
  category: "general" | "model" | "agent" | "memory" | "skills" |
            "tools" | "project" | "sessions" | "config" | "infra";
  description: string;          // satu baris, <= 80 karakter
  args: ZodSchema;              // skema argumen posisional dan flag
  options?: CommandOption[];    // flag dengan tipe, default, enum
  permission: Permission;       // read | write | exec | net | admin | secret
  handler: (ctx: CommandContext) => Promise<CommandResult>;
  output: ("text" | "json" | "markdown")[];
  errors: Record<string, string>; // kode -> pesan manusia
  help: string;                 // markdown, contoh wajib ada
  hidden?: boolean;             // untuk alias internal
  plugin?: string;              // namespace asal
}
```

Aturan registry:

- Nama command `^[a-z][a-z0-9-]{1,31}$`. Alias tidak boleh bentrok dengan nama lain.
- Command plugin memakai namespace `plugin:command` jika bentrok, tetapi bisa memakai nama pendek jika tidak bentrok.
- Handler menerima `CommandContext` berisi sesi, client RPC, config, UI, signal, dan logger. Handler tidak boleh menulis langsung ke stdout; semua lewat renderer agar format konsisten.
- Timeout default 30 detik, kecuali handler mendeklarasikan `longRunning`.
- Setiap eksekusi dicatat di audit dengan nama command, argumen yang sudah disunting, durasi, dan hasil.
- Dokumentasi `/help` dan halaman `docs/commands/` dihasilkan dari definisi yang sama.

### 11.2 Daftar command

Kolom Izin: R=read, W=write, X=exec, N=net, A=admin, S=secret. Kolom Output: T=text, J=json, M=markdown.

#### General

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/help` | `/?` | Bantuan command dan daftar perintah | `[command]` | R | T/M |
| `/exit` | `/quit`, `/q` | Keluar dari sesi interaktif | `[--force]` | R | T |
| `/quit` | `/q` | Alias eksplisit untuk keluar dari sesi interaktif | `[--force]` | R | T |
| `/clear` | `/cls` | Bersihkan transcript tanpa menghapus state | `[--keep-system]` | W | T |
| `/compact` | `/summarize` | Ringkas konteks percakapan | `[--instructions <teks>] [--keep <n>]` | W | T/J |
| `/status` | `/st` | Status sesi, model, dan antrean | `[--json]` | R | T/J |
| `/improve` | `/imp` | Tinjau, setujui, atau rollback proposal self-improvement | `[review\|list\|show <id>\|approve <id>\|rollback <id>]` | A | T/J |
| `/doctor` | `/diag` | Diagnosis instalasi dan perbaikan aman | `[--fix] [--json]` | R/A | T/J |
| `/version` | `/v` | Versi CLI, daemon, dan protokol | `[--json]` | R | T/J |
| `/feedback` | `/bug` | Kirim masukan atau laporan bug | `[--type bug\|idea] [--attach <path>]` | N | T |
| `/update` | `/upgrade` | Periksa dan pasang pembaruan | `[--check] [--channel stable\|beta]` | A/N | T |
| `/whatsnew` | `/changelog` | Lihat perubahan versi | `[--since <versi>]` | R/N | T/M |

#### Model dan provider

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/model` | `/m` | Pilih atau kunci model | `[nama\|auto\|default] [--pin]` | W | T/J |
| `/models` | `/ml` | Daftar model dan capability | `[filter] [--provider <id>] [--cap tool,vision] [--json]` | R | T/J |
| `/provider` | `/pr` | Kelola provider dan kredensial | `<id\|add\|remove\|test\|login\|logout> [opsi]` | A/S | T/J |
| `/providers` | `/prs` | Status semua provider | `[--json] [--health]` | R | T/J |
| `/cost` | `/biaya` | Biaya sesi, task, atau hari ini | `[--session\|--task\|--today\|--all] [--json]` | R | T/J |
| `/usage` | `/u` | Statistik token dan biaya | `[--by model\|provider\|day] [--json]` | R | T/J |
| `/budget` | `/limit` | Atur batas biaya | `[show\|set <usd> <periode>\|reset]` | A | T/J |
| `/route` | `/routing` | Jelaskan keputusan router | `[explain <prompt>\|policy\|test <model>]` | A | T/J/M |
| `/login` | - | Simpan kredensial provider | `<provider>` | S/N | T |
| `/logout` | - | Hapus kredensial provider | `<provider>` | S | T |

#### Agent

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/agents` | `/ag` | Daftar agen aktif dan profil | `[--active\|--profiles\|--json]` | R | T/J |
| `/agent` | - | Kelola satu instans agen | `<spawn\|show\|stop\|logs> [id] [--profile <nama>]` | W/X | T/J |
| `/delegate` | `/del` | Delegasikan tugas ke subagent | `"<tugas>" [--agent <profil>] [--model <id>] [--wait\|--detach]` | X | T/J |
| `/tasks` | `/t` | Daftar task dan statusnya | `[--all\|--active\|--failed] [--json]` | R | T/J |
| `/task` | - | Lihat, batalkan, atau lanjutkan task | `<show\|logs\|cancel\|retry\|resume> <id>` | W | T/J |
| `/plan` | `/p` | Buat, lihat, atau setujui rencana | `[show\|edit\|approve\|reject\|new] [--json]` | W | T/M/J |
| `/execute` | `/run` | Jalankan rencana | `[plan-id] [--parallel <n>] [--dry-run]` | X | T/J |
| `/cancel` | `/stop` | Batalkan task atau turn | `[task-id\|all] [--force]` | W | T |
| `/pause` | - | Jeda task yang berjalan | `[task-id]` | W | T |
| `/resume-task` | `/lanjut` | Lanjutkan task yang dijeda | `[task-id]` | W | T |
| `/retry` | - | Ulangi task atau langkah | `[task-id] [--from-step <n>]` | W | T |
| `/trace` | `/why` | Telusuri keputusan dan langkah task | `[task-id] [--last <n>] [--json]` | R | T/J |
| `/approve` | `/yes` | Setujui permintaan izin | `[approval-id]` | W | T |
| `/deny` | `/no` | Tolak permintaan izin | `[approval-id] [--reason <teks>]` | W | T |

#### Memory

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/memory` | `/mem` | Kelola entri memory | `[list\|search <q>\|show <id>\|edit <id>\|rm <id>\|pin <id>\|unpin <id>]` | W | T/J/M |
| `/remember` | `/ingat` | Simpan fakta ke memory | `"<fakta>" [--scope user\|project\|session] [--tag <tag>]` | W | T |
| `/recall` | `/cari` | Cari memory yang relevan | `"<query>" [--scope <scope>] [--limit <n>]` | R | T/J |
| `/forget` | `/lupakan` | Hapus memory | `<id\|query> [--confirm]` | W | T |
| `/profile` | `/profil` | Lihat atau ubah profil pengguna | `[show\|set <key> <value>\|import <path>\|export <path>]` | W | T/J |

#### Skills

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/skills` | `/sk` | Daftar skill terpasang | `[list\|search <q>\|info <nama>\|enable <nama>\|disable <nama>]` | R/W | T/J |
| `/skill` | - | Lihat detail satu skill | `<run <nama>\|show <nama>\|edit <nama>\|rm <nama>> [--arg <v>]` | W/X | T/J |
| `/create-skill` | `/skill-new` | Buat skill baru dengan validasi | `"<deskripsi>" [--name <nama>] [--from-session]` | W | T |
| `/install-skill` | `/skill-add` | Pasang skill dari registry atau path | `<nama\|url\|git+...> [--version <v>] [--pin]` | W/N | T |
| `/update-skill` | - | Perbarui skill | `[nama\|--all] [--check]` | W/N | T |

#### Tools, MCP, plugin, hook

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/tools` | `/tool-list` | Daftar tool dan statusnya | `[--json] [--enabled\|--disabled]` | R | T/J |
| `/tool` | - | Jalankan atau periksa satu tool | `<run <nama> --args <json>\|info <nama>\|enable\|disable>` | X | T/J |
| `/mcp` | - | Kelola server MCP | `<list\|add\|remove\|enable\|disable\|test\|auth\|logs> [nama]` | A/N | T/J |
| `/plugins` | `/plug` | Kelola plugin | `[list\|install <sumber>\|remove <nama>\|enable\|disable\|update]` | A/N | T/J |
| `/hooks` | - | Kelola hook event | `[list\|add\|remove\|enable\|disable\|test <event>]` | A | T/J |

#### Project

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/init` | `/mulai` | Inisialisasi project untuk Rann | `[--template <nama>] [--force]` | W | T |
| `/project` | `/proj` | Kelola project terdaftar | `[show\|add <path>\|remove <path>\|switch <path>\|trust\|untrust]` | W/A | T/J |
| `/context` | `/ctx` | Lihat isi konteks yang dikirim | `[show\|add <path>\|remove <path>\|clear\|explain]` | W | T/J/M |
| `/files` | `/ls` | Daftar file relevan | `[path] [--changed] [--json]` | R | T/J |
| `/review` | `/rv` | Review perubahan kode | `[--staged\|--diff <ref>\|--pr <n>] [--fix]` | R/X | T/M |
| `/test` | - | Jalankan tes project | `[pattern] [--watch] [--coverage] [--json]` | X | T/J |
| `/debug` | - | Mulai sesi debugging | `"<gejala>" [--attach <path>] [--break]` | X | T |
| `/git` | - | Operasi Git yang aman | `<status\|diff\|log\|blame\|branch\|checkout\|stage\|commit\|push\|pull> [opsi]` | W/X/N | T/J |
| `/diff` | - | Lihat diff workspace | `[--staged\|--ref <ref>] [--stat]` | R | T/M |
| `/commit` | `/ci` | Buat commit | `[-m <pesan>] [--all] [--amend]` | W | T |
| `/branch` | - | Kelola branch | `[list\|create <nama>\|switch <nama>\|delete <nama>]` | W | T |
| `/worktree` | `/wt` | Kelola worktree | `[list\|create <nama>\|remove <nama>]` | W | T |
| `/checkpoint` | `/cp` | Buat atau lihat checkpoint | `[list\|create [label]\|restore <id>\|diff <id>]` | W | T/J |
| `/undo` | `/rewind-code` | Kembali ke checkpoint | `[--last\|--to <checkpoint>] [--files <glob>]` | W | T |
| `/index` | - | Bangun indeks kode | `[build\|rebuild\|status\|clear] [--full]` | W | T/J |
| `/search` | `/grep` | Cari kode secara semantik | `"<query>" [--semantic\|--symbol\|--regex] [--path <dir>]` | R | T/J |

#### Sessions

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/sessions` | `/ss` | Daftar sesi | `[--all\|--project\|--limit <n>] [--json]` | R | T/J |
| `/resume` | `/r` | Lanjutkan sesi | `[session-id\|--last] [--at <message-id>]` | W | T |
| `/fork` | - | Duplikasi sesi | `[session-id] [--name <nama>]` | W | T |
| `/rename` | - | Ganti nama sesi | `"<nama>"` | W | T |
| `/history` | `/hist` | Riwayat pesan | `[--limit <n>] [--search <q>] [--json]` | R | T/J |
| `/rewind` | - | Kembali ke pesan sebelumnya | `[--to <message-id>] [--code\|--chat\|--both]` | W | T |
| `/new` | - | Mulai sesi baru | `[--name <nama>]` | W | T |
| `/export` | - | Ekspor sesi atau data | `[--format md\|json\|html] [--out <path>]` | R | T |
| `/import` | - | Impor sesi atau data | `<path> [--format auto]` | W | T |
| `/attach` | - | Lampirkan file ke konteks | `<path> [--as image\|file\|text]` | R | T |

#### Configuration

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/config` | `/cfg` | Lihat atau ubah config | `[get <key>\|set <key> <value>\|unset <key>\|list\|explain <key>\|edit]` | A | T/J |
| `/permissions` | `/perm` | Kelola mode izin dan policy | `[show\|mode <mode>\|allow <rule>\|deny <rule>\|remove <id>\|test <aksi>]` | A | T/J |
| `/settings` | - | Pengaturan umum | `[show\|reset\|import <path>\|export <path>]` | A | T/J |
| `/theme` | - | Pilih tema terminal | `[list\|set <nama>\|preview <nama>]` | W | T |
| `/secrets` | `/keys` | Kelola secret | `[list\|set <nama>\|remove <nama>\|rotate <nama>]` | S | T |
| `/env` | - | Lihat environment tool | `[show\|set <key> <value>\|unset <key>]` | A | T/J |
| `/sandbox` | - | Status dan batas sandbox | `[status\|test <cmd>\|set <mode>]` | A | T/J |

#### Infrastructure

| Command | Alias | Deskripsi | Argumen | Izin | Output |
|---|---|---|---|---|---|
| `/gateway` | `/gw` | Kelola gateway | `[status\|start\|stop\|restart\|url\|token]` | A/N | T/J |
| `/devices` | - | Kelola perangkat terhubung | `[list\|revoke <id>\|pair]` | A | T/J |
| `/pair` | - | Pasangkan perangkat baru | `[--name <label>] [--ttl <menit>]` | A | T |
| `/scheduler` | `/cron` | Kelola job terjadwal | `[list\|add\|remove\|enable\|disable\|run <id>\|logs <id>]` | A | T/J |
| `/background` | `/bg` | Kelola task latar | `[list\|run "<cmd>"\|logs <id>\|kill <id>]` | X | T/J |
| `/queue` | - | Kelola antrean job | `[status\|pause\|resume\|clear]` | A | T/J |
| `/integrations` | `/int` | Kelola integrasi eksternal | `[list\|connect <nama>\|disconnect <nama>\|status]` | A/N | T/J |
| `/logs` | - | Lihat log | `[--follow] [--level <l>] [--since <waktu>] [--trace <id>]` | R | T/J |
| `/health` | - | Health check komponen | `[--json] [--watch]` | R | T/J |
| `/metrics` | - | Lihat metrik | `[--json] [--period <durasi>]` | R | T/J |
| `/dashboard` | `/web` | Buka dashboard web | `[open\|url\|status]` | N | T |
| `/whoami` | - | Identitas dan scope saat ini | `[--json]` | R | T/J |
| `/notify` | - | Atur notifikasi | `[test\|on\|off\|status]` | W | T |

Jumlah command publik: 84 nama utama, 27 alias. Alias tidak menambah izin: alias memakai definisi izin command induk.

### 11.3 Command yang butuh spesifikasi khusus

#### `/model`

```
/model                     tampilkan model aktif dan asal keputusan
/model auto                serahkan ke smart router
/model openai/gpt-5        pilih eksplisit dan pin untuk sesi
/model auto --pin          pakai router tetapi kunci kandidat
/models --cap tool,vision  daftar model yang mendukung tool dan vision
```

Model eksplisit disimpan di sesi, bukan config global, kecuali `--save`. Jika model tidak ada di registry, command menolak dengan saran nama terdekat. Jika model tidak mendukung tool, Rann Code memperingatkan bahwa agentic mode akan memakai fallback tool-less dan meminta konfirmasi.

#### `/provider`

Subcommand `add` menjalankan wizard: tipe adapter, base URL, API key, header tambahan, model awal, dan tes koneksi. `test` mengirim request minimal (satu pesan, max token 1) dan melaporkan latensi, status auth, serta dukungan streaming. `remove` tidak menghapus model yang sudah tercatat, hanya menonaktifkan provider.

#### `/delegate`

Membuat subagent dengan profil. Contoh:

```
/delegate "audit endpoint auth dan tulis temuan" --agent security --wait
/delegate "refactor modul billing" --agent coding --model auto --detach
```

Tanpa `--wait`, command mengembalikan task id dan parent tetap bisa bekerja. Hasil agregasi masuk ke transcript parent saat selesai. Jika profil tidak ada, command menampilkan daftar profil dan tidak menebak.

#### `/plan`

`/plan new "tujuan"` meminta agen menyusun rencana tanpa mengeksekusi. `/plan edit` membuka editor teks pada rencana Markdown. `/plan approve` mengunci versi rencana dan mengizinkan eksekusi. `/plan show --json` mengembalikan DAG dalam format yang bisa diproses skrip.

#### `/memory`

Semua subcommand memakai id stabil (`mem_...`). `edit` membuka editor pada entri, lalu memvalidasi skema dan mencatat versi baru. `rm` tanpa `--confirm` meminta konfirmasi. `search` menampilkan skor FTS, skor vektor, dan skor gabungan agar pengguna bisa menilai relevansi.

#### `/permissions`

```
/permissions mode ask
/permissions allow "shell:pnpm test*"
/permissions deny "shell:rm -rf *"
/permissions test "shell:git push origin main"
```

`test` menjelaskan rule mana yang menang dan mengapa. Mode `trusted` hanya bisa diaktifkan untuk workspace yang sudah di-trust dan tidak berlaku untuk perintah di luar workspace.

#### `/gateway`

`start` menjalankan proses gateway jika belum ada, menampilkan URL lokal dan status pairing. `token` membuat token perangkat baru dengan scope yang dipilih, menampilkan sekali, lalu menyimpan hash. Token tidak pernah bisa dilihat lagi.

#### `/scheduler`

`add` menerima ekspresi cron atau interval, timezone, prompt atau command, model, dan kebijakan retry. Contoh:

```
/scheduler add "0 7 * * *" "periksa error log semalam dan ringkas" --tz Asia/Jakarta --notify telegram
/scheduler add --every 15m "cek health endpoint produksi" --notify none
```

Job disimpan di database, bukan di memori, dan tetap ada setelah restart.

### 11.4 Ekstensi command

Command kustom dari file:

```markdown
---
name: deploy-staging
description: Deploy build terakhir ke staging dan verifikasi health
aliases: [ds]
permission: exec
args:
  - name: version
    required: false
    description: Tag yang akan dideploy
model: auto
---
Jalankan `pnpm build`, lalu deploy ke staging memakai skrip `scripts/deploy.sh`.
Verifikasi `/health` mengembalikan 200 dan catat commit hash di laporan.
```

Aturan:

- File di `.rann/commands/*.md` dan `~/.rann/commands/*.md`.
- Frontmatter divalidasi. `permission` tidak boleh lebih rendah dari aksi yang dilakukan; jika prompt meminta shell, command otomatis minimal `exec`.
- Command plugin didaftarkan lewat API plugin, bukan dengan menulis ke direktori internal.
- Command kustom tidak bisa menimpa command inti; bentrok menghasilkan error saat load.
## 12. Contoh penggunaan lengkap

Bagian ini memakai command yang benar-benar ada di registry. Semua contoh bisa dijalankan setelah instalasi.

### 12.1 Instalasi

```bash
# npm global
npm install -g @rannd/rann-code

# standalone binary
curl -fsSL https://get.rann.dev/install.sh | sh

# docker
docker run --rm -it -v "$PWD:/work" -v "$HOME/.rann:/root/.rann" ghcr.io/rannd/rann-code:1
```

Verifikasi:

```bash
rann --version
rann doctor
```

### 12.2 First-time setup

```bash
rann
# wizard: pilih provider, masukkan API key, pilih model default
```

Atau non-interaktif:

```bash
rann provider add openai --key-env OPENAI_API_KEY --model gpt-5
rann config set model.default openai/gpt-5
```

### 12.3 Konfigurasi provider

```bash
rann provider add anthropic --key-env ANTHROPIC_API_KEY
rann provider add openrouter --key-env OPENROUTER_API_KEY --base-url https://openrouter.ai/api/v1
rann provider add local --type openai-compatible --base-url http://127.0.0.1:11434/v1 --no-auth
rann provider test local
rann providers --health
```

### 12.4 Konfigurasi model

```bash
rann models --provider openrouter --cap tool
rann model openrouter/anthropic/claude-sonnet-4.5 --pin
rann route explain "refactor 12 file sekaligus"
rann budget set 20 day
```

### 12.5 Memulai project

```bash
cd ~/proyek/api
rann init
rann project trust
rann index build
rann -p "ringkas arsitektur repo ini dan sebut risiko terbesar"
```

### 12.6 Coding task

```bash
rann "tambahkan rate limit per API key di endpoint /v1/chat, tulis tes, jalankan"
```

Di dalam REPL:

```
> tambahkan rate limit per API key di endpoint /v1/chat, tulis tes, jalankan
[plan] 5 langkah, 3 file, risiko sedang
[approval] edit src/http/chat.ts, src/http/middleware/rate-limit.ts
> /approve
[tool] edit_file ... ok
[tool] shell pnpm test ... ok 42 lulus
rann: selesai. 3 file berubah, 42 tes lulus, 0 gagal.
```

### 12.7 Planning

```bash
rann plan "migrasi database dari MySQL ke Postgres tanpa downtime"
rann plan show --json
rann plan approve
rann execute --parallel 4
```

### 12.8 Delegasi subagent

```
/delegate "audit keamanan endpoint upload" --agent security --wait
/delegate "tulis dokumentasi API dari route yang ada" --agent docs --detach
/agents --active
/agent logs ag_01J...
```

### 12.9 Membuat skill

```
/create-skill "cara deploy ke staging dan verifikasi health" --name deploy-staging
/skill edit deploy-staging
/skill run deploy-staging --arg version=1.4.2
```

### 12.10 MCP

```bash
rann mcp add github --transport stdio --command "npx -y @modelcontextprotocol/server-github"
rann mcp add linear --transport http --url https://mcp.linear.app/mcp --auth oauth
rann mcp test github
rann mcp list --json
```

### 12.11 Memory

```
/remember "Project ini memakai pnpm dan tidak boleh memakai npm" --scope project
/recall "package manager"
/memory list --scope project
/memory pin mem_01J...
/memory export --out memory.jsonl
```

### 12.12 Session

```
/sessions --project
/resume 01J...
/fork --name eksperimen-cache
/rewind --to msg_01J... --code
/export --format md --out laporan.md
```

### 12.13 Background task

```bash
rann background run "pnpm test --watch=false" --name test-malam
rann background list
rann background logs bg_01J... --follow
```

### 12.14 Scheduler

```
/scheduler add "0 2 * * *" "backup database dan verifikasi restore" --tz Asia/Jakarta --notify telegram
/scheduler list
/scheduler run job_01J...
/scheduler logs job_01J...
```

### 12.15 Gateway

```bash
rann gateway start --bind 127.0.0.1 --port 8787
rann gateway url
rann pair --name laptop
# buka URL, masukkan pairing code, token disimpan di perangkat
```

Untuk VPS, bind ke `0.0.0.0` hanya di belakang reverse proxy TLS:

```bash
rann gateway start --bind 0.0.0.0 --port 8787 --public-url https://rann.example.com
```

### 12.16 Telegram

```bash
rann integrations connect telegram --token-env TELEGRAM_BOT_TOKEN
rann integrations status
```

Lalu dari Telegram:

```
/start
/new
rann: sesi baru. kirim tugas atau /help.
```

Topik berbeda menghasilkan sesi berbeda. Approval muncul sebagai tombol inline.

### 12.17 Dashboard

```bash
rann dashboard open
# atau buka http://127.0.0.1:8787
```

Dashboard memakai sesi login yang sama dengan gateway. Semua perubahan dari dashboard langsung terlihat di CLI karena keduanya memakai daemon dan database yang sama.

### 12.18 Troubleshooting

```bash
rann doctor --fix
rann logs --level error --since 1h
rann provider test anthropic
rann config explain model.default
rann sandbox test "curl https://example.com"
rann gateway status
```

Jika `rann doctor` menemukan database rusak, jalankan `rann db backup`, lalu `rann db restore <file>` setelah memastikan file backup valid.
