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
| M1 | Storage, backup, restore, migrasi | berjalan |
| M2 | Provider, router, kapabilitas model | belum |
| M3 | CLI, command registry, streaming | belum |
| M4 | Agent core, planner, verifier, checkpoint | belum |
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

## Aturan

- Setiap FR hanya boleh ditandai done bila ada kode dan tes yang membuktikan.
- Berkas `docs/prd/` tidak boleh diubah. Konflik dicatat di `docs/konflik-prd.md`.
- Versi publik tetap `0.1.1` sampai seluruh FR dan AC lulus. Rilis `1.0.0` belum boleh diterbitkan.
