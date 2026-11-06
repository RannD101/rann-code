# 07. Security, Reliability, Deployment, dan Operasional

- Dokumen induk: MASTER.md
- Versi: 1.0
- Requirement: RC-FR-137 sampai RC-FR-151, RC-NFR-001 sampai RC-NFR-024
- Acceptance criteria: RC-AC-137 sampai RC-AC-151

## 34. Security architecture

### 34.1 Model ancaman

Rann Code menjalankan kode dan mengakses data sensitif. Aset yang dilindungi:

- API key provider dan token integrasi.
- Isi workspace dan file di luar workspace.
- Kredensial git dan akses jaringan.
- Sesi, memory, dan transcript pengguna.
- Gateway dan perangkat yang terhubung.
- Integritas keputusan agent (tidak bisa dibajak konten berbahaya).

Aktor ancaman:

| Aktor | Kemampuan | Contoh serangan |
|---|---|---|
| Konten tidak tepercaya | Masuk lewat file, web, tool output, MCP | Prompt injection, instruksi palsu |
| Plugin atau skill jahat | Kode yang dijalankan dengan izin | Membaca secret, mengirim data keluar |
| Pengguna remote | Akses gateway | Menjalankan shell tanpa izin |
| Proses lokal lain | Akses ke file dan socket | Membaca database, menyadap token |
| Model provider | Melihat prompt | Kebocoran data yang dikirim |
| Dependency | Kode pihak ketiga | Supply chain attack |

### 34.2 Prinsip

1. **Deny by default.** Tool, path, domain, dan plugin tidak mendapat izin kecuali dinyatakan.
2. **Least privilege.** Setiap sesi, agen, plugin, dan MCP server punya izin minimum.
3. **Defense in depth.** Prompt, policy engine, sandbox, dan audit bekerja terpisah. Satu lapisan gagal, lapisan lain menahan.
4. **No silent escalation.** Tidak ada kode yang bisa menaikkan izin sendiri.
5. **Auditable.** Aksi sensitif selalu meninggalkan jejak yang tidak bisa dihapus agent.

### 34.3 Mode izin

| Mode | Baca | Tulis file | Shell | Jaringan | Approval |
|---|---|---|---|---|---|
| `read-only` | Ya | Tidak | Tidak | Tidak | Tidak ada aksi tulis |
| `ask` | Ya | Tanya | Tanya | Tanya | Setiap aksi berisiko |
| `accept-edits` | Ya | Ya, dalam workspace | Tanya | Tanya | Hanya shell dan jaringan |
| `trusted` | Ya | Ya | Ya, dalam aturan | Ya, dalam aturan | Hanya aksi di luar aturan |
| `custom` | Sesuai rule | Sesuai rule | Sesuai rule | Sesuai rule | Sesuai rule |

Catatan:

- `trusted` hanya bisa diaktifkan untuk workspace yang sudah di-trust dan tidak berlaku untuk path di luar workspace, perintah destruktif, atau push ke remote.
- Mode bisa berbeda per sesi, per agen, dan per task. Subagent tidak bisa mewarisi mode yang lebih longgar dari parent.
- Mode default adalah `ask`. First-run tidak pernah memilih `trusted`.

### 34.4 Rule engine

Rule punya bentuk:

```json
{
  "id": "allow-pnpm-test",
  "effect": "allow",
  "match": {
    "tool": "shell",
    "command": "pnpm test*",
    "cwd": "/work/project"
  },
  "scope": {"projectId": "proj_01J..."},
  "expiresAt": "2026-12-05T00:00:00Z",
  "createdBy": "user"
}
```

Evaluasi:

1. Kumpulkan rule yang cocok.
2. Deny menang atas allow.
3. Rule dengan scope lebih spesifik menang atas yang umum.
4. Rule kedaluwarsa diabaikan.
5. Jika tidak ada rule, pakai default mode.
6. Setiap keputusan menyimpan rule id yang menang.

Pola perintah tidak boleh hanya prefix string. `pnpm test*` cocok dengan `pnpm test` dan `pnpm test:unit`, tetapi tidak cocok dengan `pnpm test && curl evil`. Shell operator (`;`, `&&`, `||`, pipe, redirect, substitusi) memaksa evaluasi ulang seluruh segmen.

### 34.5 Sandbox filesystem

- Root yang diizinkan: workspace dan `~/.rann/state` (terbatas).
- Path sensitif selalu diblokir: `~/.ssh`, `~/.aws`, `~/.config/gcloud`, `~/.kube`, `.env` di luar workspace, database kredensial.
- Symlink diperiksa dengan `realpath` sebelum akses. Symlink yang menunjuk keluar workspace ditolak.
- Path traversal (`..`) dinormalisasi dan diperiksa.
- File yang ditulis harus berada di workspace atau path yang disetujui.
- Operasi hapus memerlukan konfirmasi dan tidak boleh mengenai root atau home.

Implementasi per platform:

| Platform | Mekanisme |
|---|---|
| Linux | bubblewrap (`bwrap`) dengan bind mount workspace, `/usr`, `/lib`, `/bin` read-only, tmpfs untuk `/tmp` |
| macOS | `sandbox-exec` profile yang membatasi file dan network |
| Windows | restricted token + AppContainer bila tersedia; fallback validasi path di userspace |
| Container | Docker/Podman dengan volume workspace dan network policy |

Jika sandbox tidak tersedia, Rann Code menampilkan peringatan dan menurunkan mode default ke `ask` dengan validasi path userspace. Ini bukan isolasi setara, tetapi lebih baik daripada tanpa batas.

### 34.6 Shell restriction

Perintah yang selalu diblokir di mode apa pun tanpa persetujuan khusus:

- `rm -rf /`, `rm -rf ~`, `rm -rf` pada path di luar workspace.
- `mkfs`, `dd` ke device, `shutdown`, `reboot`, `halt`.
- `chmod -R 777 /`, `chown -R` pada sistem.
- Fork bomb (`:(){ :|:& };:`).
- `curl ... | sh`, `wget ... | bash` tanpa domain tepercaya.
- `sudo` dan `su` kecuali diizinkan eksplisit.
- Mengubah firewall, SSH config, atau user sistem.

Deteksi memakai parser shell, bukan regex sederhana. Jika parser gagal, perintah dianggap berisiko tinggi dan meminta approval.

### 34.7 Secret management

Penyimpanan:

- Secret dienkripsi dengan XChaCha20-Poly1305.
- Kunci utama 32 byte disimpan di OS keychain (`keytar` atau CLI native).
- Jika keychain tidak tersedia, kunci diturunkan dari passphrase dengan scrypt (N=2^17, r=8, p=1) dan salt acak.
- File vault `~/.rann/secrets/vault.enc` dengan mode 0600.
- Setiap secret punya id, nama, provider, created, rotated, lastUsed.

Aturan:

- Secret tidak pernah ditulis ke config, log, trace, atau prompt.
- Tool menerima secret lewat env var atau referensi, bukan argumen yang terlihat.
- Secret disensor di output tool jika cocok dengan pola.
- Rotasi secret tidak mengubah riwayat; versi lama dihapus setelah verifikasi.
- Akses secret dicatat di audit: siapa, kapan, untuk tool apa.

### 34.8 Prompt injection defense

Konten tidak tepercaya diberi label:

```
<untrusted source="web" url="https://...">
...
</untrusted>
```

Aturan:

- Instruksi di dalam konten tidak pernah menjadi system instruction.
- Model diberi tahu bahwa konten tersebut adalah data, bukan perintah.
- Aksi berisiko tetap melewati policy engine, terlepas dari apa yang dikatakan konten.
- Tool output yang mengandung teks seperti "ignore previous instructions" ditandai dan tidak memengaruhi policy.
- Jika model tampak mengikuti instruksi dari konten, runtime mendeteksi anomali (tool call di luar rencana) dan meminta konfirmasi.
- File yang dibaca dari repo juga tidak tepercaya sampai di-review; komentar seperti "jalankan perintah ini" tidak dieksekusi otomatis.

Batasan: tidak ada pertahanan prompt yang sempurna. Karena itu pertahanan utama adalah izin dan sandbox, bukan prompt.

### 34.9 Isolasi

- Sesi: state terpisah, query selalu menyertakan `session_id`.
- Agen: working directory dan context terpisah, tidak bisa membaca transcript parent.
- Plugin: proses terpisah jika tidak tepercaya, akses lewat API.
- MCP: proses terpisah, env allowlist, network policy.
- Browser: context terpisah per task.
- Database: satu koneksi per proses, WAL, transaksi untuk operasi multi-tabel.

### 34.10 Audit log

Tabel `audit_log` append-only:

```ts
interface AuditEntry {
  id: string;
  ts: string;
  actor: { type: "user" | "agent" | "plugin" | "system"; id: string };
  action: string;              // tool.exec, approval.grant, secret.read, config.set
  resource: string;
  sessionId?: string;
  taskId?: string;
  result: "ok" | "denied" | "error";
  detail: Record<string, unknown>; // disunting
  prevHash: string;
  hash: string;                // sha256(prevHash + canonical(entry))
}
```

- Hash chain membuat penghapusan atau perubahan entri terdeteksi.
- Audit tidak bisa dihapus lewat CLI. Retensi default 90 hari, bisa diperpanjang.
- Export audit tersedia untuk kepatuhan.
- Log rotasi tidak memutus rantai karena hash disimpan di DB, bukan file log.

### 34.11 Destructive operation protection

Aksi berikut memerlukan konfirmasi eksplisit dengan nama resource:

- Menghapus lebih dari 10 file.
- Menghapus direktori.
- Mengubah database (drop, truncate, delete tanpa where).
- Force push, reset hard, clean.
- Menghentikan service, container, atau gateway.
- Mengubah permission atau config keamanan.
- Menghapus memory atau sesi secara permanen.

Konfirmasi menampilkan jumlah, path, dan apakah ada backup. Jika backup tidak ada, tawarkan membuat checkpoint lebih dulu.

### 34.12 Remote access security

- Gateway tidak pernah Terbuka tanpa auth.
- Pairing code sekali pakai, 10 menit, rate limited.
- Token disimpan sebagai hash, bukan plaintext.
- TLS wajib untuk akses publik. Jika di belakang proxy, gateway memercayai `X-Forwarded-*` hanya dari proxy yang dikonfigurasi.
- Rate limit per IP dan per token.
- Device bisa dicabut kapan saja.
- Scope minimum; `admin` tidak diberikan ke perangkat biasa.
- Approval untuk aksi berbahaya tidak bisa disetujui dari perangkat `viewer`.

### 34.13 Supply chain

- Dependency dikunci dengan lockfile.
- `npm audit` dijalankan di CI.
- Plugin dan skill dari sumber tidak tepercaya ditampilkan permission dan checksum.
- Signature plugin didukung (Ed25519). Kunci publik registry disimpan di config.
- Binary rilis ditandatangani dan punya checksum.
- Update tidak otomatis kecuali dikonfigurasi; changelog ditampilkan.

### 34.14 Data privacy

- Telemetry mati secara default.
- Jika diaktifkan, hanya metrik agregat tanpa isi prompt, path, atau nama project.
- Data yang dikirim ke provider dijelaskan di `/privacy`.
- Retensi transcript default 90 hari, bisa diubah.
- Penghapusan sesi menghapus pesan, tool call, dan artefak terkait, tetapi audit tetap menyimpan metadata tanpa isi.
- Export data pengguna tersedia dalam JSON.

### 34.9 Self-improvement terkendali

Self-improvement adalah fitur V1, tetapi perubahan diri dibatasi pada artefak yang bisa diaudit dan di-rollback. Kode inti, kebijakan izin, audit, dan sandbox tidak pernah diubah otomatis.

**Data yang dikumpulkan per task.** `task_outcome` menyimpan `task_id`, `session_id`, `goal`, status verifier, durasi, biaya, model yang dipakai, tool yang dipanggil, jumlah retry, `failure_class`, dan apakah pengguna mengambil alih. Transcript penuh tidak disalin; hanya referensi dan sampel yang disetujui.

**Siklus evaluasi.** Evaluasi berjalan setiap 20 task selesai, atau manual lewat `/improve review`. Minimal 20 sampel sebelum sebuah pola dianggap signifikan. Evaluasi menghasilkan:

1. Tingkat keberhasilan per kelas task.
2. Pola kegagalan berulang, dikelompokkan per kode error, tool, dan fase eksekusi.
3. Efektivitas skill: success rate saat skill dipakai dibandingkan tanpa skill.
4. Efektivitas tool: error rate, latency, dan retry rate.
5. Kualitas routing: biaya per task sukses dan frekuensi fallback.
6. Tingkat intervensi manusia dan alasan override.

**Jenis proposal.** Hanya empat jenis yang boleh diusulkan: pembaruan memory, patch skill, penyesuaian bobot routing, dan perubahan workflow atau prompt template. Proposal berisi diff, bukti (jumlah sampel, metrik sebelum dan sesudah), perkiraan dampak, risiko, dan rencana rollback.

**Persetujuan dan penerapan.**

1. Proposal masuk antrean `improvement_proposals` dengan status `draft`.
2. Pemilik workspace atau admin meninjau diff dan bukti.
3. Jika disetujui, perubahan diterapkan ke profil uji dan dijalankan pada 10 persen sesi selama 7 hari.
4. Setelah canary, perubahan dipromosikan atau dibatalkan.
5. Rollback otomatis jika success rate turun lebih dari 5 poin persen atau error rate naik lebih dari 10 persen.
6. Setiap transisi dicatat di audit dengan hash chain, pelaku, dan alasan.

**Batas keras.**

- Tidak boleh mengubah definisi FR, acceptance criteria, atau dokumen ini.
- Tidak boleh menaikkan permission, mematikan audit, atau memperlebar sandbox.
- Tidak boleh mengubah kode inti tanpa rilis baru dan review manusia.
- Tidak boleh memakai data sesi pengguna lain sebagai bukti.
- Usulan yang gagal validasi schema ditolak sebelum masuk antrean.

**Metrik yang dipantau.** Task success rate, rework rate, human override rate, biaya per task sukses, p95 durasi, tool error rate, dan jumlah proposal yang diterima. Angka agregat disimpan 1 tahun; sampel mentah 90 hari.

## 35. Performance

### 35.1 Anggaran

| Metrik | Target | Catatan |
|---|---|---|
| CLI start | ≤ 300 ms median | Tanpa memuat model atau indeks |
| Daemon start | ≤ 800 ms | Migrasi cepat, lazy load |
| Token pertama | overhead ≤ 150 ms | Di luar provider |
| Render | ≥ 2.000 token/detik | Terminal 120x40 |
| Memori CLI | ≤ 120 MB | Idle |
| Memori daemon | ≤ 450 MB | 5 sesi aktif |
| Tool overhead | ≤ 25 ms | Sampai proses mulai |
| Memory retrieval | ≤ 80 ms p95 | 50.000 entri |
| Code search | ≤ 250 ms p95 | 100.000 file |
| Recovery | ≤ 5 detik | Setelah crash |

### 35.2 Strategi

- Lazy load modul berat (browser, tree-sitter, sqlite-vec) saat dibutuhkan.
- Gunakan worker thread untuk parsing dan embedding agar UI tidak blocking.
- Streaming langsung, tanpa menunggu response penuh.
- Database WAL, prepared statement, indeks yang tepat.
- Cache metadata model dan tool di memori.
- Batasi output tool di broker, bukan di renderer.
- Hindari menyalin string besar; gunakan referensi artefak.

### 35.3 Pengukuran

Benchmark dijalankan di CI pada mesin referensi 4 vCPU, 8 GB RAM, SSD. Hasil disimpan di `bench/results` dan dibandingkan dengan baseline. Regresi lebih dari 15 persen menggagalkan build.

## 36. Reliability

### 36.1 Graceful shutdown

Saat SIGTERM:

1. Berhenti menerima task baru.
2. Kirim sinyal batal ke tool yang berjalan.
3. Simpan checkpoint dan state.
4. Tutup koneksi database dengan checkpoint WAL.
5. Hentikan MCP server dan plugin.
6. Keluar dengan kode 0.

Batas waktu 15 detik, lalu SIGKILL.

### 36.2 Crash recovery

- State task ditulis di setiap transisi.
- Heartbeat worker setiap 5 detik.
- Lock file dan database lock mendeteksi proses mati.
- Job yang `running` saat start dipulihkan atau ditandai gagal.
- Checkpoint diverifikasi hash sebelum dipakai.
- Tool yang tidak idempoten dan statusnya tidak diketahui tidak diulang otomatis.

### 36.3 Process supervision

- Daemon dijalankan oleh systemd (Linux), launchd (macOS), atau Windows Service.
- `rann daemon install` menghasilkan unit file.
- Restart otomatis dengan backoff.
- Health check setiap 30 detik.
- Log ke journald atau file dengan rotasi.

### 36.4 Database reliability

- WAL mode, synchronous NORMAL untuk operasi biasa, FULL untuk migrasi.
- Backup otomatis sebelum migrasi dan setiap 24 jam.
- Integrity check `PRAGMA integrity_check` saat start dan setelah crash.
- Jika database korup, daemon menolak start dan menampilkan perintah restore, bukan merusak lebih lanjut.

### 36.5 Queue reliability

- Job di-claim dengan transaksi.
- Idempotency key mencegah duplikasi.
- Retry dengan backoff.
- Dead letter queue untuk job yang gagal permanen.
- Job yang macet bisa di-reset lewat `/queue`.

### 36.6 Timeout

Setiap lapisan punya timeout: koneksi provider, streaming idle, tool, hook, MCP request, gateway request, dan task total. Timeout tidak boleh tak terbatas. Default task total 2 jam, bisa diperpanjang.

### 36.7 Health check

`/health` mengembalikan:

```json
{
  "status": "ok",
  "daemon": {"uptime": 3600, "version": "1.0.0"},
  "db": {"ok": true, "latencyMs": 2},
  "providers": [{"id": "openai", "status": "healthy", "latencyMs": 240}],
  "gateway": {"ok": true, "connections": 3},
  "queue": {"running": 2, "queued": 5, "failed": 0}
}
```

Status `degraded` jika salah satu provider down tetapi fallback tersedia. Status `error` jika database atau daemon tidak sehat.

## 37. Deployment

### 37.1 Topologi

| Topologi | Komponen | Cocok untuk |
|---|---|---|
| Local | CLI + daemon | Developer di laptop |
| Local + gateway | CLI + daemon + gateway | Dashboard dan perangkat lain di LAN |
| VPS single node | daemon + gateway + dashboard + reverse proxy | Akses remote, task terjadwal |
| VPS + worker | daemon + gateway + beberapa worker | Banyak task paralel |
| Multi-node | gateway + beberapa daemon | Tim kecil, project terpisah |

### 37.2 VPS

Persyaratan minimum: 2 vCPU, 4 GB RAM, 20 GB disk, Linux x64/arm64, Node 22 atau binary.

Langkah:

1. Buat user non-root `rann`.
2. Pasang binary atau npm.
3. Jalankan `rann setup --server`.
4. Buat systemd unit untuk daemon dan gateway.
5. Pasang reverse proxy (Caddy/Nginx) dengan TLS.
6. Batasi firewall: hanya 443 terbuka, gateway di localhost.
7. Pair perangkat lewat SSH tunnel.
8. Aktifkan backup harian.

Contoh unit daemon:

```ini
[Unit]
Description=Rann Code daemon
After=network.target

[Service]
Type=simple
User=rann
ExecStart=/usr/local/bin/rannd --foreground
Restart=always
RestartSec=2
LimitNOFILE=65536
Environment=RANN_HOME=/home/rann/.rann

[Install]
WantedBy=multi-user.target
```

### 37.3 Docker

Image resmi berisi Node runtime dan binary. Volume:

- `/work` untuk workspace.
- `/data` untuk `RANN_HOME`.

Tidak ada secret yang dibakar di image. Gateway dan daemon bisa dijalankan sebagai dua container atau satu container dengan supervisord ringan.

### 37.4 Multi-node

Gateway menyimpan daftar node dengan `nodeId`, `url`, `token`, dan `projectAffinity`. Task dirutekan ke node yang memiliki project. Jika node mati, task tidak otomatis dipindah kecuali project tersedia di node lain dan pengguna mengizinkan.

### 37.5 Backup dan restore

Backup berisi:

- Database (menggunakan `VACUUM INTO` atau backup API SQLite).
- Config dan profil (tanpa secret plaintext).
- Vault secret (terenkripsi).
- Artefak penting (opsional).

Jadwal default: harian, retensi 7 harian, 4 mingguan. Lokasi default `~/.rann/backups/`, bisa diarahkan ke S3-compatible.

Restore:

1. Hentikan daemon.
2. Verifikasi checksum dan versi skema.
3. Salin database ke lokasi baru.
4. Jalankan migrasi jika versi lebih lama.
5. Jalankan `PRAGMA integrity_check`.
6. Start daemon dan cek `/health`.

## 38. Installation dan distribution

### 38.1 Paket

- npm: `@rannd/rann-code` dengan bin `rann` dan `rannd`.
- Standalone binary: Linux x64/arm64, macOS x64/arm64, Windows x64.
- Docker image: `ghcr.io/rannd/rann-code`.
- Homebrew tap: `rannd/tap/rann`.
- Skrip instalasi: `https://get.rann.dev/install.sh`.

### 38.2 Persyaratan

- Node.js 22 LTS atau 24 LTS untuk instalasi npm.
- Git 2.30+ untuk fitur git.
- SQLite tidak perlu dipasang (better-sqlite3 membawa library).
- Browser automation membutuhkan Chromium yang diunduh saat pertama dipakai atau disediakan sistem.

### 38.3 Update

- `rann update --check` melihat versi.
- `rann update` memasang versi stabil terbaru.
- Migrasi database berjalan otomatis setelah backup.
- Jika migrasi gagal, versi lama dipulihkan.
- Changelog ditampilkan sebelum update.

### 38.4 Uninstall

`rann uninstall` menghapus binary dan paket, tetapi tidak menghapus `~/.rann` secara default. `--purge` menghapus data dengan konfirmasi ganda dan peringatan bahwa backup tidak bisa dikembalikan.

## 39. Maintenance dan observability

### 39.1 Logging

- Format JSON Lines di `~/.rann/logs/rann-YYYY-MM-DD.log`.
- Field: `ts`, `level`, `component`, `sessionId`, `taskId`, `traceId`, `msg`, `err`.
- Redaction otomatis untuk secret, token, email, dan path sensitif.
- Rotasi harian, retensi 14 hari default.
- Level: `error`, `warn`, `info`, `debug`, `trace`.

### 39.2 Metrics

Metrik internal:

- `rann_turns_total`, `rann_tool_calls_total`, `rann_tool_duration_ms`.
- `rann_tokens_total{model,type}`, `rann_cost_usd_total`.
- `rann_tasks_total{status}`, `rann_queue_depth`.
- `rann_provider_health{provider}`.
- `rann_gateway_connections`, `rann_gateway_requests_total`.

Expose di `/metrics` (Prometheus) jika diaktifkan. Default localhost.

### 39.3 Tracing

- Setiap turn punya `traceId`.
- Span: turn, model request, tool call, hook, MCP request, database query lambat.
- Export ke OpenTelemetry jika dikonfigurasi. Default simpan lokal 7 hari.

### 39.4 Doctor

`rann doctor` memeriksa:

- Versi Node dan binary.
- Permission `RANN_HOME`.
- Database dan migrasi.
- Socket daemon.
- Provider credentials dan koneksi.
- Konfigurasi model dan alias.
- Sandbox availability.
- Gateway dan port.
- Disk space.
- Log error terbaru.

Setiap temuan punya tingkat (`ok`, `warn`, `error`) dan saran perbaikan. `--fix` hanya memperbaiki hal yang aman (membuat direktori, migrasi, permission file).

### 39.5 Runbook insiden

| Gejala | Pemeriksaan | Tindakan |
|---|---|---|
| CLI tidak connect | `rann daemon status`, socket, log | Start daemon, perbaiki permission |
| Semua provider gagal | `/providers --health`, kredensial, jaringan | Ganti provider, perbaiki key |
| Task macet | `/tasks`, heartbeat, log | Cancel, retry dari checkpoint |
| Database korup | `rann doctor`, integrity check | Restore backup terakhir |
| Gateway 502 | status daemon, proxy | Restart gateway, cek upstream |
| Biaya melonjak | `/usage --by model`, routing log | Pin model murah, set budget |
| Memory bocor | RSS, jumlah sesi | Restart daemon, tutup sesi lama |

### 39.6 Retensi

| Data | Default | Bisa diubah |
|---|---|---|
| Transcript | 90 hari | Ya |
| Tool output | 30 hari | Ya |
| Artefak | 30 hari | Ya |
| Log | 14 hari | Ya |
| Trace | 7 hari | Ya |
| Audit | 90 hari | Ya, minimal 30 |
| Backup | 7 harian + 4 mingguan | Ya |

Pembersihan berjalan harian, mencatat jumlah yang dihapus, dan tidak menghapus audit atau checkpoint yang masih dirujuk task aktif.

### 39.7 Dukungan dan diagnostik

`rann support bundle` membuat arsip berisi log, config yang sudah disunting, versi, health, dan daftar plugin. Secret, isi prompt, dan file workspace tidak disertakan kecuali pengguna memilih. Arsip diberi hash dan bisa diunggah manual.
