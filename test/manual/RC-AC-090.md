# RC-AC-090 Inventaris kategori tool

Diperiksa: 2026-11-09

Setiap kategori punya minimal satu tool yang diuji otomatis:

| Kategori | Tool | Bukti |
| --- | --- | --- |
| Filesystem | `fs_read`, `fs_write`, `fs_edit`, `fs_list` | `tools.test.ts`, `acceptance-agent.test.ts` |
| Terminal | `shell_run` | `acceptance-memory.test.ts` (timeout) |
| Git | `git_read`, `git_write` | `tools.test.ts`, `acceptance-coding.test.ts` (baseline) |
| Web search | `web_search` | `quality-gates.test.ts` (alasan pemilihan) |
| HTTP | `http_request` | `adapter-support.test.ts`, `web.test.ts` |
| Eksekusi kode | `project_check`, `package_run` | `acceptance-coding.test.ts` |
| Database | `database_query` | `tools.test.ts` |
| Image | `image_info`, `image_transform` | `tools-categories.test.ts` |
| Messaging | adapter Telegram, Discord, Slack | `messaging*.test.ts` |
| Scheduling | `schedule_task`, scheduler | `scheduler.test.ts`, `tools-categories.test.ts` |
| Memory | `memory` | `memory-skills.test.ts` |
| Skill | `skill` | `skills-broker.test.ts` |

Status: lulus, semua kategori punya tes yang dijalankan di `pnpm check`.
