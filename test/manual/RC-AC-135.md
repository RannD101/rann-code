# RC-AC-135 Halaman dashboard

Diperiksa: 2026-11-09

Dashboard satu berkas memuat halaman berikut, datanya dirakit `dashboard-data.ts`:

agents, sessions, tasks, models, providers, skills, memory, tools, mcp, gateway, scheduler, usage, logs, permissions, settings, overview, chat, devices.

Setiap halaman memakai endpoint `/v1/pages/<nama>` dan token perangkat. Halaman chat punya aksi kirim, lampiran, batalkan, sesi baru, ganti model, dan akhiri sesi. Status: lulus pemeriksaan manual, tidak ada halaman yang kosong.
