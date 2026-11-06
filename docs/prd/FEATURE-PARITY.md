# FEATURE-PARITY. Claude Code, Hermes, dan Rann Code V1

- Dokumen induk: MASTER.md
- Versi: 1.0
- Sumber riset: dokumentasi publik Claude Code (code.claude.com/docs), dokumentasi Hermes Agent (hermes-agent.nousresearch.com/docs), spesifikasi MCP (modelcontextprotocol.io), dokumentasi provider (Anthropic, OpenAI, Google Gemini, OpenRouter)
- Tanggal riset: 5 November 2026

## 1. Metode

Matrix ini membandingkan kemampuan yang dinyatakan di dokumentasi publik, bukan klaim pemasaran. Tiga aturan:

1. "Ya" berarti fitur tersedia dan terdokumentasi publik.
2. "Sebagian" berarti ada fitur terkait tetapi cakupannya lebih sempit dari yang dibutuhkan Rann Code.
3. "Tidak diklaim" berarti tidak ditemukan bukti publik yang cukup. Bukan berarti produk tidak mampu.

Rann Code V1 adalah target implementasi di PRD ini. Status "target" berarti fitur wajib ada dan diuji sebelum V1 dinyatakan selesai, bukan roadmap masa depan.

## 2. Matrix fitur

### 2.1 Terminal dan interaksi

| Kemampuan | Claude Code | Hermes | Rann Code V1 | Peningkatan |
|---|---|---|---|---|
| REPL interaktif | Ya | Ya | Ya | Status bar terpadu: model, context, biaya, izin |
| Slash command | Ya | Ya | Ya | Registry deklaratif dengan skema argumen dan permission |
| Command palette fuzzy | Ya | Sebagian | Ya | Kategori, hint argumen, alasan command tidak tersedia |
| Autocomplete kontekstual | Ya | Ya | Ya | Model, sesi, task, skill, MCP, path dalam satu sumber |
| Multiline input | Ya | Ya | Ya | Editor eksternal dan paste gambar |
| Riwayat input | Ya | Ya | Ya | Pencarian Ctrl+R dan riwayat per project |
| Streaming response | Ya | Ya | Ya | Buffer adaptif dan penanda stream terputus |
| Tampilan tool live | Ya | Ya | Ya | Blok terlipat, durasi, artefak, Ctrl+O |
| Indikator progres task | Ya | Ya | Ya | DAG dan deviasi rencana |
| Token dan biaya | Ya | Ya | Ya | Harga tidak diketahui ditandai `$?`, bukan nol |
| Context indicator | Ya | Ya | Ya | Zona context, bukan hanya persentase |
| Approval dialog | Ya | Ya | Ya | Diff, dampak, "selalu untuk pola ini", alasan penolakan |
| Interrupt dan resume | Ya | Ya | Ya | Checkpoint otomatis dan lanjut tanpa mengulang tool |
| Resize dan fallback | Ya | Ya | Ya | Mode screen reader dan `TERM=dumb` eksplisit |
| Non-interaktif | Ya | Ya | Ya | JSON dan NDJSON dengan skema stabil |
| Pipe input/output | Ya | Ya | Ya | stdout bersih, log ke stderr, exit code terdokumentasi |
| Tema dan aksesibilitas | Ya | Ya | Ya | Token warna dan kontras minimum |
| Shell passthrough `!` | Ya | Ya | Ya | Output bisa dikirim ke model dengan `!!` |

### 2.2 Agent dan perencanaan

| Kemampuan | Claude Code | Hermes | Rann Code V1 | Peningkatan |
|---|---|---|---|---|
| Agent loop | Ya | Ya | Ya | Fase eksplisit dan trace per keputusan |
| Perencanaan otomatis | Ya | Ya | Ya | DAG tervalidasi, bukan daftar linear |
| Plan mode | Ya | Ya | Ya | Approval sebagian dan estimasi rentang |
| Replanning | Ya | Ya | Ya | Versi rencana dan alasan perubahan |
| Dekomposisi tugas | Ya | Ya | Ya | Dependensi, lease file, kriteria per task |
| Tool selection | Ya | Ya | Ya | Filter capability dan budget tool |
| Self-correction | Ya | Ya | Ya | Batas tiga siklus dengan perubahan strategi wajib |
| Retry | Ya | Ya | Ya | Matriks retry per komponen dan idempotensi |
| Error recovery | Ya | Ya | Ya | State machine recovery dan checkpoint |
| Verifikasi sebelum lapor | Sebagian | Ya | Ya | Verifier wajib untuk klaim selesai |
| Task panjang | Ya | Ya | Ya | Heartbeat, recovery, dan budget |
| Human-in-the-loop | Ya | Ya | Ya | Gate berbasis risiko, bukan hanya tool |
| Checkpoint | Ya | Ya | Ya | Git ref, blob, dan worktree |
| Failure analysis | Sebagian | Ya | Ya | Laporan kegagalan standar |
| Trace dan replay | Sebagian | Ya | Ya | Span per turn, tool, hook, MCP |

### 2.3 Coding engine

| Kemampuan | Claude Code | Hermes | Rann Code V1 | Peningkatan |
|---|---|---|---|---|
| Eksplorasi repo | Ya | Ya | Ya | Indeks simbol dan arsitektur otomatis |
| Pencarian kode | Ya | Ya | Ya | Hybrid grep, simbol, dan vektor |
| Baca/tulis/edit file | Ya | Ya | Ya | Patch dengan hash dan verifikasi baca ulang |
| Multi-file edit | Ya | Ya | Ya | Transaksi dan rollback |
| Refactor | Ya | Ya | Ya | Lease file dan merge queue |
| Debugging | Ya | Ya | Ya | Alur reproduksi dan tes regresi |
| Test generation | Ya | Ya | Ya | Tes yang bisa dijalankan ulang |
| Test execution | Ya | Ya | Ya | Adapter per ekosistem |
| Build/lint/typecheck | Ya | Ya | Ya | Deteksi otomatis dan fallback eksplisit |
| Code review | Ya | Ya | Ya | Temuan berbaris dengan severity |
| Dependency analysis | Ya | Ya | Ya | Lockfile, lisensi, dan konflik |
| Git operations | Ya | Ya | Ya | Checkpoint dan larangan operasi destruktif |
| Project init | Ya | Ya | Ya | RANN.md dan `.rann/` |
| Dokumentasi | Ya | Ya | Ya | Sitasi path dan baris |

### 2.4 Multi-agent

| Kemampuan | Claude Code | Hermes | Rann Code V1 | Peningkatan |
|---|---|---|---|---|
| Subagent | Ya | Ya | Ya | Profil, budget, dan tool allowlist |
| Agent paralel | Ya | Ya | Ya | Batas concurrency per provider |
| Delegasi | Ya | Ya | Ya | Kontrak hasil dan verifikasi bukti |
| Komunikasi antar agen | Sebagian | Ya | Ya | Pesan terstruktur dan eskalasi |
| Shared/isolated context | Ya | Ya | Ya | Shared hanya goal, keputusan, artefak |
| Hierarki | Ya | Ya | Ya | Maksimal tiga tingkat |
| Pencegahan konflik file | Sebagian | Sebagian | Ya | Path lease, hash, merge queue |
| Monitoring agen | Ya | Ya | Ya | Pohon, biaya, transcript |
| Pembatalan agen | Ya | Ya | Ya | Rambat ke anak dan lease |
| Recovery agen | Sebagian | Ya | Ya | Orphan detection dan retry |

### 2.5 Memory dan instruksi

| Kemampuan | Claude Code | Hermes | Rann Code V1 | Peningkatan |
|---|---|---|---|---|
| File instruksi project | Ya | Ya | Ya | RANN.md, AGENTS.md, CLAUDE.md, rules per path |
| Memory persisten | Ya | Ya | Ya | Enam ruang dengan sumber dan audit |
| Memory otomatis | Sebagian | Ya | Ya | Kandidat, keyakinan, persetujuan |
| Retrieval semantik | Sebagian | Ya | Ya | FTS + vektor + graph, RRF |
| Deduplikasi | Sebagian | Ya | Ya | Hash dan kemiripan |
| Memory correction | Ya | Ya | Ya | Versi dan audit |
| Import/export | Sebagian | Ya | Ya | JSONL dengan mode konflik |
| Inspeksi memory | Ya | Ya | Ya | CLI dan dashboard |
| Knowledge index | Sebagian | Ya | Ya | Potongan dengan sitasi |
| Prioritas instruksi | Ya | Ya | Ya | Konflik dicatat dan pemenang disebut |

### 2.6 Skills, tools, MCP, plugins, hooks

| Kemampuan | Claude Code | Hermes | Rann Code V1 | Peningkatan |
|---|---|---|---|---|
| Skills | Ya | Ya | Ya | Progressive loading dan versioning |
| Skill creation | Ya | Ya | Ya | Validasi dan dry-run |
| Skill registry | Ya | Ya | Ya | HTTPS, Git, checksum, signature |
| Tool bawaan | Ya | Ya | Ya | 16 kategori, termasuk database dan dokumen |
| Tool kustom | Ya | Ya | Ya | Modul TS dan CLI |
| Tool chaining | Sebagian | Ya | Ya | Pipeline tervalidasi skema |
| MCP stdio | Ya | Ya | Ya | Lifecycle dan isolasi |
| MCP HTTP | Ya | Ya | Ya | Streamable HTTP, SSE fallback, OAuth 2.1 |
| MCP resources/prompts | Ya | Ya | Ya | Namespacing dan cache |
| Plugin | Ya | Ya | Ya | Manifest, permission, proses terpisah |
| Hooks | Ya | Ya | Ya | 16 event, empat tipe eksekusi |
| Hook dry-run | Sebagian | Sebagian | Ya | Payload contoh dan validasi |

### 2.7 Provider dan routing

| Kemampuan | Claude Code | Hermes | Rann Code V1 | Peningkatan |
|---|---|---|---|---|
| Multi-provider | Sebagian | Ya | Ya | Anthropic, OpenAI, Gemini, OpenRouter, compatible, lokal |
| Model registry | Ya | Ya | Ya | Capability, harga, context, alias |
| Capability detection | Ya | Ya | Ya | Registry terverifikasi, bukan asumsi |
| Smart routing | Sebagian | Ya | Ya | Skor per kelas tugas dan alasan |
| Fallback | Ya | Ya | Ya | Tidak mengganti model pinned tanpa izin |
| Usage dan biaya | Ya | Ya | Ya | Per request, task, sesi, hari |
| Prompt caching | Ya | Ya | Ya | Penanda cache per provider |
| Structured output | Ya | Ya | Ya | Native dan emulasi dengan validasi |
| Multimodal | Ya | Ya | Ya | Gambar, PDF, audio, frame video |
| Embedding | Sebagian | Ya | Ya | Model terpisah dan reindex |

### 2.8 Runtime, gateway, dan integrasi

| Kemampuan | Claude Code | Hermes | Rann Code V1 | Peningkatan |
|---|---|---|---|---|
| Background task | Ya | Ya | Ya | Antrean SQLite, idempotency, recovery |
| Scheduler | Sebagian | Ya | Ya | Cron, interval, event, timezone, DST |
| Gateway remote | Ya (cloud/web) | Ya | Ya | Self-hosted, pairing, scope, multi-node |
| Telegram | Tidak diklaim | Ya | Ya | Pemisahan chat dan topic |
| Discord | Tidak diklaim | Ya | Ya | Thread dan role mapping |
| Slack | Tidak diklaim | Ya | Ya | Block Kit dan thread |
| Web chat | Ya | Ya | Ya | Klien gateway yang sama |
| Dashboard | Ya | Ya | Ya | CRUD semua subsistem, state sama dengan CLI |
| Git worktree | Ya | Ya | Ya | Worktree per task dan merge queue |
| Browser automation | Ya | Ya | Ya | Session isolation dan domain policy |
| Database tool | Sebagian | Ya | Ya | Query, schema, explain |
| Document tool | Sebagian | Ya | Ya | PDF, DOCX, XLSX |
| Messaging approval | Tidak diklaim | Ya | Ya | Tombol inline dan audit |

### 2.9 Keamanan dan operasi

| Kemampuan | Claude Code | Hermes | Rann Code V1 | Peningkatan |
|---|---|---|---|---|
| Permission modes | Ya | Ya | Ya | Lima mode dan rule engine |
| Sandbox | Ya | Ya | Ya | bwrap, sandbox-exec, container |
| Secret encryption | Ya | Ya | Ya | XChaCha20 + keychain |
| Audit log | Sebagian | Ya | Ya | Hash chain dan export |
| Prompt injection defense | Ya | Ya | Ya | Label sumber dan policy di luar prompt |
| Isolasi sesi | Ya | Ya | Ya | Query scope dan proses terpisah |
| Plugin isolation | Sebagian | Ya | Ya | Proses terpisah untuk plugin tidak tepercaya |
| Remote auth | Ya | Ya | Ya | Pairing, token hash, scope, revoke |
| Backup/restore | Sebagian | Ya | Ya | Backup sebelum migrasi dan restore terverifikasi |
| Observability | Sebagian | Ya | Ya | Log, metrics, trace, doctor |
| Self-improvement | Sebagian | Ya | Ya | Proposal dengan persetujuan |
| Distribusi | Ya | Ya | Ya | npm, binary, Docker, Homebrew |

## 3. Perbedaan pendekatan arsitektur

| Aspek | Claude Code | Hermes | Rann Code |
|---|---|---|---|
| Bentuk produk | CLI coding agent dengan integrasi IDE dan cloud | Agent platform dengan CLI, gateway messaging, dan ekosistem tool | CLI + daemon + gateway, satu runtime untuk semua klien |
| Eksekusi | Proses CLI, cloud session | Proses agent dengan beberapa backend eksekusi | Daemon persisten, CLI tipis, worker pool |
| Storage | Konfigurasi file dan session lokal | File, memory, session database | SQLite tunggal + blob store + FTS + vec |
| Multi-agent | Subagent dan task tool | Delegation dengan konteks terisolasi | Agent team dengan lease file dan merge queue |
| Memory | CLAUDE.md dan memory otomatis | Memory persisten multi-ruang | Enam ruang dengan sumber, audit, dan retrieval hybrid |
| Gateway | Cloud/web | Messaging gateway multi-platform | Gateway self-hosted dengan pairing dan scope |
| Plugin | Marketplace plugin | Plugin dan MCP | Plugin + MCP + hook dengan izin terpisah |
| Keamanan | Permission dan sandbox | Approval, DM pairing, container | Policy engine, sandbox OS, audit hash chain |

## 4. Gap yang ditutup Rann Code

1. **Satu runtime untuk CLI, dashboard, dan messaging.** Banyak produk memisahkan sesi CLI dari sesi chat. Rann Code menyatukannya di daemon, sehingga sesi yang sama bisa dilihat dan dilanjutkan dari mana saja.
2. **Keputusan model yang transparan.** Router tidak hanya memilih model, tetapi menjelaskan kandidat, skor, dan alasan. Model yang dipatok tidak diganti diam-diam.
3. **Konflik multi-agent yang dicegah, bukan ditambal.** Path lease dan merge queue adalah bagian dari runtime, bukan konvensi prompt.
4. **Verifikasi sebagai syarat lapor.** Klaim selesai tanpa bukti ditolak oleh verifier, bukan hanya diperingatkan.
5. **Keamanan yang bisa diaudit.** Audit hash chain dan secret store terenkripsi adalah fitur inti, bukan tambahan.
6. **Local-first tanpa kompromi.** Tidak ada database server atau akun cloud wajib. Gateway opsional, bukan syarat.
7. **Dokumentasi yang bisa dibangun.** Setiap fitur punya FR, AC, tes, dan keputusan teknologi yang eksplisit.

## 5. Fitur referensi yang sengaja tidak ditiru

| Fitur | Alasan |
|---|---|
| Penyimpanan seluruh transkrip sebagai memory | Melanggar prinsip seleksi dan membuat retrieval buruk |
| Auto-commit setiap perubahan | Mengganggu riwayat pengguna dan sulit dipulihkan |
| Force push otomatis | Risiko kehilangan pekerjaan |
| Cloud account wajib | Bertentangan dengan local-first |
| Telemetry aktif default | Bertentangan dengan privasi |
| Model tunggal sebagai default | Bertentangan dengan multi-provider |
| Plugin tanpa izin | Risiko keamanan |

## 6. Status spesifikasi per area

| Area | FR | Dokumen | AC | Status |
|---|---|---|---|---|
| Terminal dan command | 001-020 | 02 | 001-020 | Spesifikasi lengkap |
| Agent dan planning | 021-039 | 03 | 021-039 | Spesifikasi lengkap |
| Coding engine | 040-052 | 03 | 040-052 | Spesifikasi lengkap |
| Multi-agent | 053-062 | 03 | 053-062 | Spesifikasi lengkap |
| Memory dan instruksi | 063-076 | 04 | 063-076 | Spesifikasi lengkap |
| Skills dan tools | 077-090 | 04 | 077-090 | Spesifikasi lengkap |
| MCP, plugin, hook | 091-100 | 04 | 091-100 | Spesifikasi lengkap |
| Provider, router, context | 101-114 | 05 | 101-114 | Spesifikasi lengkap |
| Git, browser, background, scheduler | 115-126 | 06 | 115-126 | Spesifikasi lengkap |
| Gateway, messaging, dashboard | 127-136 | 06 | 127-136 | Spesifikasi lengkap |
| Security, storage, config, ops | 137-150 | 07 dan ARCHITECTURE | 137-150 | Spesifikasi lengkap |
| Self-improvement | 151 | 07 | 151 | Spesifikasi lengkap |
