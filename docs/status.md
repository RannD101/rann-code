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
| M3 | CLI, command registry, streaming | belum |
| M4 | Agent core, planner, verifier, checkpoint | berjalan |
| M5 | Coding tools, Git, project map | belum |
| M6 | Tool broker, sandbox, approval | belum |
| M7 | Memory dan instruction | belum |
| M8 | Skill | belum |
| M9 | MCP, plugin, hook | belum |
| M10 | Subagent dan parallel orchestration | belum |
| M11 | Background daemon, scheduler, recovery | belum |
| M12 | Context, compaction, budget | belum |
| M13 | Gateway REST/WS dan dashboard | belum |
| M14 | Keamanan, secret, audit, RBAC | belum |
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

Sisa M4: goal tracking eksplisit dan pemulihan task setelah kill -9.

## Aturan

- Setiap FR hanya boleh ditandai done bila ada kode dan tes yang membuktikan.
- Berkas `docs/prd/` tidak boleh diubah. Konflik dicatat di `docs/konflik-prd.md`.
- Versi publik tetap `0.1.1` sampai seluruh FR dan AC lulus. Rilis `1.0.0` belum boleh diterbitkan.
