# Rann Code

CLI agent coding lokal dengan daemon, sesi SQLite, dan alur izin eksplisit. Dibangun ulang dari PRD v1.

Status: MVP siap dipakai. Fokus saat ini CLI, penyimpanan sesi, tool filesystem dan shell, provider OpenAI-compatible, serta izin interaktif.

## Kebutuhan

- Node >= 22.11
- pnpm 9.15.9
- Linux atau macOS

## Pasang

```bash
cd /root/rann-code
export PATH=/root/.nvm/versions/node/v22.23.3/bin:$PATH
pnpm install
pnpm build
ln -sf /root/rann-code/packages/cli/dist/main.js /usr/local/bin/rann
chmod +x /root/rann-code/packages/cli/dist/main.js
rann --version
```

Kalau tidak mau symlink global, jalankan langsung:

```bash
node /root/rann-code/packages/cli/dist/main.js --help
```

## Mulai cepat

```bash
cd ~/proyek
rann doctor
rann new --title "Coba pertama"
rann "jelaskan struktur folder ini"
rann chat
```

Provider default `mock` tidak memanggil jaringan. Balasan mock berguna untuk menguji alur, tool call, dan izin. Untuk memakai model sungguhan, tambahkan provider OpenAI-compatible:

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

`--key-env` menyimpan nama variabel, bukan nilai key. Key dibaca saat daemon start. Setelah `provider add` atau `config set`, daemon otomatis dihentikan supaya config baru dipakai pada perintah berikutnya.

## Perintah

| Perintah | Fungsi |
|---|---|
| `rann` | Membuka chat interaktif, sesi terakhir di folder ini dilanjutkan |
| `rann "prompt"` | Satu turn lalu keluar |
| `rann chat [--session <id>]` | REPL interaktif |
| `rann new --title "..."` | Membuat sesi baru |
| `rann sessions [--limit N] [--json]` | Daftar sesi |
| `rann send <id> "teks"` | Kirim prompt ke sesi tertentu |
| `rann resume <id>` | Alias `send` untuk sesi yang sudah ada |
| `rann "..." --detach` | Jalankan turn di latar belakang |
| `rann turn <id> [--wait]` | Lihat status dan hasil turn |
| `rann providers` | Status provider dan ada tidaknya key |
| `rann provider test [nama]` | Uji koneksi provider dan model default |
| `rann models` | Model default dan daftar model |
| `rann usage [sesi]` | Ringkasan token dan biaya per provider/model |
| `rann config get [key]` | Lihat config efektif |
| `rann config set <key> <value>` | Ubah config |
| `rann doctor` | Cek instalasi, daemon, database, config |
| `rann daemon start\|stop\|status` | Kelola daemon |
| `rann daemon logs [-n 50]` | Lihat log daemon |
| `rann --version` | Versi CLI dan protokol |

Di dalam `rann chat`: `/help`, `/status`, `/sessions`, `/new`, `/model`, `/permission`, `/tools`, `/usage`, `/exit`.

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

`stream-json` mencetak NDJSON per event: `message.delta`, `tool.start`, `tool.end`, `approval.request`, `turn.end`, dan `error`. Log, izin, dan diagnostik tetap di stderr. Tanpa TTY, permintaan izin otomatis ditolak supaya proses tidak menggantung; pakai `--yes` atau mode `trusted` untuk otomasi yang memang boleh menulis.

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

```
~/.rann/
  config/config.toml
  profiles/default/rann.db
  run/daemon.sock
  logs/daemon.log
```

Database SQLite memakai WAL, foreign key, dan FTS5. Semua sesi terikat ke folder kerja, jadi `rann sessions` hanya menampilkan sesi dari folder saat ini kecuali `--all`.

## Arsitektur

```
packages/shared   tipe, error, config, skema RPC, id
packages/storage  SQLite, migrasi, repo sesi dan event
packages/runtime  agent loop, tool, policy, provider, daemon, RPC
packages/cli      argumen, UI, stream, REPL, perintah
```

CLI tidak menyentuh database langsung. Semua lewat JSON-RPC 2.0 di Unix socket, newline-delimited. Daemon start otomatis saat perintah pertama dan tetap hidup di antara perintah.

## Tes

```bash
export PATH=/root/.nvm/versions/node/v22.23.3/bin:$PATH
cd /root/rann-code
pnpm check
```

`pnpm check` menjalankan lint, typecheck, dependency-cruiser, dan seluruh tes Vitest. Tes mencakup id, config, error, policy, tool, database, daemon plus RPC, alur izin setuju dan tolak, serta parser streaming provider OpenAI dengan server HTTP lokal.

## Batasan MVP

Belum ada: task latar dan subagent, memory jangka panjang, skills, MCP, ringkas konteks otomatis, biaya dan budget, plugin, serta sinkronisasi cloud. Perintah di PRD untuk fitur tersebut belum didaftarkan supaya tidak muncul sebagai janji kosong.
