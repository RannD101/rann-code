# Status implementasi PRD V1

Diperbarui: 2026-11-07

Sumber kebenaran: `docs/prd/`. Audit bukti per FR ada di `docs/audit/`.

## Ringkasan audit awal

151 FR diperiksa lewat 6 domain paralel. Hasil awal: 0 done, 64 partial, 87 missing.

| Domain | Berkas audit | Partial | Missing |
| --- | --- | ---: | ---: |
| CLI dan UX | `01-cli.md` | 13 | 7 |
| Agent dan planning | `02-agent.md` | 8 | 21 |
| Coding tools | `03-coding-tools.md` | 3 | 16 |
| Memory, skill, MCP | `04-memory-skills-mcp.md` | 19 | 19 |
| Provider dan runtime | `05-providers-runtime.md` | 7 | 13 |
| Gateway dan keamanan | `06-gateway-security.md` | 14 | 11 |
| Total | | 64 | 87 |

Tidak ada FR yang dihitung done karena audit memakai syarat bukti kode dan tes, bukan asumsi.

## Milestone

| Milestone | Isi | Status |
| --- | --- | --- |
| M1 | Storage, backup, restore, migrasi | selesai |
| M2 | Provider, router, kapabilitas model | berjalan |
| M3 | CLI, command registry, streaming | hampir selesai |
| M4 | Agent core, planner, verifier, checkpoint | selesai |
| M5 | Coding tools, Git, project map | sebagian besar |
| M6 | Tool broker, sandbox, approval | sebagian besar |
| M7 | Memory dan instruction | sebagian besar |
| M8 | Skill | sebagian besar |
| M9 | MCP, plugin, hook | berjalan |
| M10 | Subagent dan parallel orchestration | dasar selesai, perluas tes dan integrasi |
| M11 | Background daemon, scheduler, recovery | selesai |
| M12 | Context, compaction, budget | berjalan |
| M13 | Gateway REST/WS, dashboard, dan messaging | gateway dan Telegram selesai; Discord/Slack belum |
| M14 | Keamanan, secret, audit, RBAC | berjalan |
| M15 | Distribusi, operability, rilis 1.0.0 | belum |

## Yang sudah dikerjakan

### M1 storage

- `packages/storage/src/schema-v3.ts`: migrasi 3 berisi 36 tabel PRD 9.3, termasuk `memory_entries`, `memory_fts`, plan, task, agent, checkpoint, artifact, path lease, approval, scheduler, provider, model, routing log.
- `packages/storage/src/work-repos.ts`: repo untuk plan, plan node, task, task step, agent, checkpoint, artifact, approval, path lease, dan scheduler job.
- `packages/storage/src/db.ts`: backup otomatis sebelum migrasi, restore otomatis bila migrasi gagal, opsi `migrations` untuk pengujian.
- `packages/storage/src/repos.ts`: `memory_entries` dengan `profile_id`, `project_id`, `session_id`, `confidence`, `importance`, `status`, `expires_at`, `last_used_at`, `version`.
- `packages/shared/src/config.ts`: lapisan config `global` lalu `profile` lalu `project` lalu env lalu flag. Profil aktif dibaca dari `RANN_PROFILE` atau `config.profile`.
- Tes: `db.test.ts` (6), `work-repos.test.ts` (4), `config.test.ts` lulus. `pnpm typecheck` lulus.

### M2 provider, model, dan secret

- `packages/runtime/src/models.ts`: registry descriptor model dengan 11 capability, batas context/output, harga input/output, alias, seed dari config ke DB.
- `packages/shared/src/config.ts`: bagian `models` untuk override capability/harga per model, dan `api_key_ref` pada provider.
- `packages/storage/src/schema-v4.ts`: migrasi 4 `model-and-jobs`, kolom model/biaya pada turn dan usage, tabel `jobs`.
- `packages/runtime/src/agent.ts`: capability gate, cek context window, fallback provider, retry sebelum chunk pertama, health provider, biaya per usage.
- `packages/runtime/src/providers/`: adapter `anthropic`, `gemini`, `openai-responses`, parser SSE bersama, factory 5 jenis provider, skenario mock.
- `packages/runtime/src/router.ts`: skor kandidat per kelas tugas (9 kelas, bobot PRD 25.3), filter hard capability/context/deprecated/health, pin dan prefer, batas biaya per task, alasan tiap kandidat.
- `packages/runtime/src/rpc.ts`: `route.explain`, `budget.status`, dan audit untuk operasi secret.
- `packages/cli/src/main.ts`: `rann route explain "<prompt>"`, `rann usage` menampilkan biaya dan budget hari ini.
- `packages/storage/src/secrets.ts`: vault XChaCha20-Poly1305, kunci 0600 atau passphrase scrypt, audit untuk set/remove, CLI `rann secret`.
- `packages/storage/src/schema-v5.ts`: migrasi 5 `cache-pricing`, kolom harga cache read/write pada `models`.
- `packages/runtime/src/models.ts`: `costFor` menghitung token cache read/write; harga cache yang tidak diisi memakai harga input supaya biaya tidak tercatat terlalu rendah.
- `packages/runtime/src/providers/`: adapter memetakan `cache_read_input_tokens`/`cache_creation_input_tokens` (Anthropic), `prompt_tokens_details.cached_tokens` (OpenAI), `input_tokens_details.cached_tokens` (OpenAI Responses), dan `cachedContentTokenCount` (Gemini) ke usage.
- `packages/runtime/src/agent.ts`: usage menyimpan token cache, `costFor` menerima empat angka, dan kegagalan `runTurn` selalu menghasilkan `turn.failed` supaya CLI tidak menggantung.
- `packages/runtime/src/rpc.ts`: `routing.mode = auto` memilih model lewat router, alias dan `provider/model` memindahkan provider, dan `route.explain` memakai config routing.
- `packages/runtime/src/providers/mock.ts`: skenario sukses, timeout, 429, 500, tool call invalid, dan stream terpotong.
- `packages/runtime/src/agent.ts`: teks parsial disimpan saat stream terputus, argumen tool diredaksi sebelum masuk DB, checkpoint, dan event.
- `packages/shared/src/redact.ts`: penyamaran nilai berdasarkan nama kunci, pola token (`sk-`, `rd-`, `Bearer`), dan kredensial di URL proxy.
- `packages/runtime/src/rpc.ts`: keputusan izin dicatat ke `audit_log` (allow/deny, alasan user/timeout/cancelled), argumen diredaksi, `provider.list` menampilkan `key_hint`, health, dan `retry_after_ms`.
- `packages/cli/src/main.ts`: `/model`, `/models`, `/provider`, `/cost`, `/budget`, `rann provider list` dengan kolom STATUS, `rann provider login` (vault + `api_key_ref`).
- `packages/cli/src/config-store.ts`: `unsetConfigValue` untuk `provider remove`.
- Tes: `models.test.ts`, `router.test.ts`, `providers/retry.test.ts`, `providers/provider-contract.test.ts`, `providers/mock.test.ts`, `secrets.test.ts`, `redact.test.ts`, `config-store.test.ts` lulus. `pnpm check` lulus 102 tes (21 berkas).

Sisa M2: keychain OS (sekarang masih vault berkas dengan master key 0600) dan health probe periodik 60 detik.

### M4 agent core

- `packages/runtime/src/planner.ts`: skema rencana DAG, validasi siklus, kriteria selesai, dan estimasi.
- `packages/runtime/src/plan-runtime.ts`: rencana disimpan ke `plans`, `plan_nodes`, dan `tasks`; status task dipublikasikan lewat `task.update`.
- `packages/runtime/src/plan-runtime.ts` (`verifyPlan`): verifikasi bukti task sebelum turn ditutup; nama tool `shell_run` sekarang dikenali, turn yang berhenti prematur dikirim ulang dengan daftar celah, maksimal dua kali.
- `packages/runtime/src/agent.ts`: persetujuan rencana berisiko tinggi lewat `approvePlan` sebelum task pertama dijalankan.
- `packages/shared/src/rpc.ts`: `planOnly` dan `forcePlan` tidak lagi dibuang oleh validasi params `session.send`.
- `packages/runtime/src/agent.ts`: batas langkah, budget, checkpoint `pre_tool`, pembatalan, dan `turn.failed`.
- `packages/runtime/src/rpc.ts`: `plan.list` dan `task.list` untuk membaca rencana serta task per sesi.
- `packages/cli/src/main.ts`: `/tasks` menampilkan rencana dan status task, `/execute <tugas>` memaksa penyusunan rencana lalu eksekusi, `/cancel` membatalkan turn aktif.
- `packages/runtime/src/failure-analysis.ts`: kategori kegagalan (auth, rate limit, timeout, budget, izin, konteks, stream, plan), sifat bisa diulang, dan saran tindakan; ikut terkirim di event `error` dan `turn.failed`.
- `packages/cli/src/stream.ts`: menampilkan saran tindakan saat turn gagal.
- Tes: `planner.test.ts`, `plan-runtime.test.ts`, `failure-analysis.test.ts`, `rpc.test.ts` lulus. Total 109 tes (23 berkas).
- `packages/runtime/src/plan-runtime.ts` (`revisePlan`) dan tool `plan_revise`: versi rencana naik, alasan dicatat di metadata, task selesai dipertahankan, task terbuka dibatalkan, dan revisi yang mengubah goal atau menambah risiko tinggi meminta persetujuan ulang.

M4 selesai. Goal tracking tersedia (`schema-v6`, repo, 5 RPC, tool goal, `/goal`).

### M5 background, scheduler, dan gateway

- `packages/storage/src/job-repos.ts`: antrean job persisten, klaim transaksional, lease dan heartbeat, dead letter, repo scheduler dan riwayat.
- `packages/runtime/src/background.ts` dan `scheduler.ts`: worker, eksekusi shell/prompt, sanitisasi env, cron `croner`, zona waktu, dan `recoverStaleJobs`.
- `packages/cli/src/main.ts`: `/background` dan `/scheduler` lengkap dengan opsi, `--json`, dan `needs`/`after`.
- `packages/storage/src/schema-v8.ts`: tabel `gateway_devices`, `gateway_pair_codes`, `gateway_users`, `gateway_sessions`, `gateway_messages`.
- `packages/storage/src/gateway-repos.ts`: kode pairing 8 karakter TTL 10 menit sekali pakai, token opaque ber-hash SHA-256, role ke scope, revoke, pemetaan sesi per kanal, statistik.
- `packages/runtime/src/gateway.ts`: server HTTP/HTTPS, WebSocket `/v1/events`, auth Bearer, pembatasan pairing 5 kali per 15 menit per IP, REST sesi, chat, approval, lampiran, background, scheduler, usage, perangkat, aset statis dengan proteksi traversal.
- `packages/runtime/src/dashboard.ts`: halaman satu berkas, login pairing, 18 halaman data, chat dengan polling dan event WebSocket, tombol approval.
- `packages/runtime/src/dashboard-data.ts`: perakitan data 18 halaman dari tabel nyata, `redactDeep`.
- `packages/runtime/src/rpc.ts`: `gateway.*`, `dashboard.data`, event gateway, start/stop otomatis.
- `packages/cli/src/main.ts`: `rann gateway status|start|stop|pair|devices|revoke|role|stats|enable|disable` dan `/gateway` di REPL.
- Tes: `gateway-repos.test.ts` (5), `gateway.test.ts` (4), `job-repos.test.ts` (7), `scheduler.test.ts`, `background.test.ts`. `pnpm check` lulus 212 tes (42 berkas).
- Belum: adapter Discord dan Slack, uji WebSocket reconnect lewat koneksi nyata.

### M6 messaging

- `packages/storage/src/schema-v9.ts`: tabel `messaging_state` untuk cursor polling per kanal.
- `packages/storage/src/gateway-repos.ts`: `getChannelCursor`, `setChannelCursor`, `ensureChannelDevice` supaya perangkat kanal punya baris valid untuk pemetaan sesi.
- `packages/runtime/src/messaging.ts`: adapter Telegram dengan polling `getUpdates`, allowlist chat, sesi per chat dan thread, teks/gambar/dokumen sampai 20 MB, tombol inline approval, perintah `/status`, `/cancel`, `/resume`, `/model`, `/cost`, `/approve`, `/deny`, pemecahan pesan 3.800 karakter dengan penanda bagian, dan pengiriman hasil turn ke kanal asal.
- `packages/shared/src/rpc.ts`: `messaging.status` dan `messaging.send`.
- `packages/runtime/src/rpc.ts`: `MessagingService` hidup bersama gateway, berlangganan event yang sama, start dan stop bersama daemon.
- `packages/cli/src/main.ts`: `rann messaging status|enable|disable|send` dan `/messaging` di REPL.
- `packages/runtime/src/gateway.ts`: penolakan otorisasi dicatat ke `audit_log` dengan scope yang kurang.
- Tes: `messaging.test.ts` (6), `gateway-repos.test.ts` (5). `pnpm check` lulus 212 tes (42 berkas), `pnpm build` exit 0.
- Belum: adapter Discord dan Slack (RC-FR-133), webhook publik, dan uji adapter Telegram dengan token nyata.

### M10 subagent dan orkestrasi paralel

- `packages/storage/src/schema-v10.ts`: kolom subagent pada tabel `agents` yang sudah ada (`session_id`, `turn_id`, `parent_turn_id`, `profile`, `goal`, `depth`, `path`, `steps`, `cost_usd`, `heartbeat_at`, `result_json`, `finished_at`) dan tabel `subagent_messages`; tidak membuat ulang tabel lama.
- `packages/storage/src/agent-repos.ts`: repo khusus subagent dengan nama `Subagent*` agar tidak bentrok dengan repo agent lama, pohon parent-child, heartbeat, pembatalan pohon, penandaan orphan, pesan, dan pelepasan `path_leases`.
- `packages/runtime/src/subagent-profiles.ts`: 9 profil bawaan (`explore`, `planner`, `coder`, `debugger`, `reviewer`, `tester`, `researcher`, `writer`, `security`), pemuatan profil user `<home>/agents` dan project `.rann/agents`, pemilihan profil eksplisit atau otomatis dari trigger.
- `packages/runtime/src/agent.ts` dan `tools/index.ts`: tool `task` menerima `profile`, `background`, `max_steps`; tool subagent dibatasi daftar profil, `mcp_*` tetap boleh.
- `packages/runtime/src/rpc.ts`: `runSubagent` membuat sesi anak, turn, baris agent, heartbeat, event `agent.update`, ringkasan hasil beserta `files_changed`, pembatasan `max_per_turn`, `max_depth`, `max_children`, dan pembatalan lewat `agent.cancel`.
- `packages/shared/src/rpc.ts`: `agent.list`, `agent.get`, `agent.cancel`, `agent.message`, `agent.profiles`.
- `packages/cli/src/main.ts`: `rann agent list|get|cancel|profiles|message` dan `/agents` di REPL.
- Tes: `agent-repos.test.ts` (4), `subagent-profiles.test.ts` (3), `subagent-run.test.ts` (2, mock provider nyata lewat `runSubagent`). `pnpm check` lulus 221 tes (45 berkas), `pnpm build` exit 0.
- Belum: tampilan subagent di dashboard, isolasi worktree per subagent, dan pengujian paralel beberapa subagent sekaligus di daemon nyata.

## Progres terkini (2026-11-08)

- Commit terakhir: `288b6a6`, `pnpm check` hijau 285 tes di 55 berkas.
- Baseline git dicatat per turn (hash diff, daftar berkas kotor, salinan diff di checkpoints).
- Checkpoint berkala setiap 10 langkah tool, selain checkpoint sebelum tool mutasi dan setelah test lulus.
- Estimasi rencana punya label `historical`, `heuristic`, atau `unavailable`; data historis diambil dari rata-rata task selesai.
- Memori terisolasi per `profile_id`, impor mendukung strategi `skip`, `overwrite`, dan `merge`, ekspor JSONL membawa metadata skema.
- Konflik preferensi otomatis menandai entri lama `superseded` dan menyimpan alasan.
- Instruksi diurutkan berdasarkan prioritas, konflik dilaporkan sebagai event, README ikut dibaca, `.rann/knowledge` ikut diindeks.
- `doctor` memeriksa versi aplikasi, konfigurasi gateway, dan TLS gateway.
- `code_rename` mengganti simbol lintas berkas secara transaksional dengan dry-run.
- Tool yang gagal menulis artefak JSON berisi tool, args teredaksi, error, dan cwd.
- Evaluasi plan mencatat total task, sukses, gagal, durasi aktual, estimasi, dan jumlah intervensi.
- `project_check` mengulang tes gagal maksimal dua kali dan menandai hasil flaky.
- Skill mendukung tarball HTTPS ber-checksum, batas versi dependensi, aset references/scripts, audit hapus, dan wizard `/create-skill`.
- Persetujuan rencana mendukung semua atau sebagian task; task yang tidak disetujui berstatus `paused` dan tidak dieksekusi.
- Retrieval memori menggabungkan FTS, kemiripan vektor kata, tag, dan recency.
- Perintah `/index rebuild` membangun ulang indeks knowledge.
- Dashboard bisa mengunggah lampiran dan membatalkan turn dari tombol.
- Registry pengguna lokal gateway tersedia lewat `rann gateway users` dan `rann gateway user add|role|disable`.
- MCP HTTP mendukung OAuth client credentials dari env.
- Hint error mengikuti `ui.language` untuk id/en.
- Indeks simbol lintas bahasa dan tool `symbol_search` tersedia; `/index rebuild` juga membangun indeks simbol.
- Gateway punya pemantauan node multi-node lewat `gateway.nodes` dan `rann gateway nodes`.
- Audit lama di `docs/audit/parts/` masih memuat gap usang; audit ulang belum selesai.

## Aturan

- Setiap FR hanya boleh ditandai done bila ada kode dan tes yang membuktikan.
- Berkas `docs/prd/` tidak boleh diubah. Konflik dicatat di `docs/konflik-prd.md`.
- Versi publik tetap `0.1.1` sampai seluruh FR dan AC lulus. Rilis `1.0.0` belum boleh diterbitkan.
