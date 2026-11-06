# TESTING-STRATEGY. Rann Code V1

- Dokumen induk: MASTER.md
- Versi: 1.0
- Requirement: RC-NFR-020, RC-FR-150, seluruh RC-AC
- Prinsip: setiap klaim perilaku harus punya tes atau prosedur verifikasi yang bisa dijalankan ulang.

## 1. Piramida pengujian

| Lapis | Proporsi | Waktu target | Cakupan |
|---|---|---|---|
| Unit | 60 persen | < 2 menit total | Fungsi murni, parser, skema, policy, state machine |
| Integration | 25 persen | < 10 menit | Storage, provider mock, tool broker, memory, queue |
| End-to-end | 10 persen | < 15 menit | CLI, daemon, gateway, dashboard dengan mock provider |
| Manual dan chaos | 5 persen | Harian atau sebelum rilis | Platform, sandbox, recovery, kanal messaging nyata |

Tes tidak boleh bergantung pada urutan eksekusi, waktu nyata, atau jaringan eksternal kecuali ditandai `@live`.

## 2. Area dan cakupan

| Area | Yang diuji | Alat | Gate |
|---|---|---|---|
| Core | Error mapping, config schema, event, util | Vitest | Unit lulus, coverage ≥ 80 persen |
| Storage | Migrasi, transaksi, FTS, vec, backup, restore | Vitest + SQLite temp | Integration lulus, integrity check |
| Provider | Kontrak streaming, tool call, error, usage | Mock + rekaman | Semua adapter lulus kontrak |
| Agent | Loop, planning, verifier, checkpoint, recovery | Mock provider + fixture | Skenario 10 langkah lulus |
| Tools | Validasi, sandbox, timeout, path traversal | Vitest + proses nyata | Tidak ada eksekusi di luar izin |
| Memory | Ekstraksi, retrieval, dedup, expiry, audit | SQLite + embedding mock | Query < 80 ms p95 |
| Skills | Parser, validasi, loading, eksekusi, registry | Fixture skill | Skill invalid ditolak |
| MCP | stdio, HTTP, discovery, auth, reconnect | Server MCP fixture | Server mati tidak menjatuhkan sesi |
| Plugin | Manifest, isolasi, permission, crash | Plugin fixture | Crash plugin tidak mematikan daemon |
| Gateway | REST, WS, auth, scope, replay, rate limit | Fastify inject + WS client | 401/403 benar, replay tanpa duplikasi |
| Messaging | Telegram, Discord, Slack, web chat | Server palsu | Session binding dan approval benar |
| Dashboard | Halaman, empty state, error state, aksesibilitas | Playwright | Semua halaman render data nyata |
| Security | Path traversal, secret leak, prompt injection, RBAC | Suite khusus | 0 kebocoran |
| Performance | Startup, query, retrieval, gateway, RSS | Benchmark harness | Memenuhi RC-NFR |
| Recovery | Kill -9, DB lock, network cut, provider failure | Chaos runner | State konsisten |

## 3. Unit tests

Aturan:

- Tidak ada I/O nyata; filesystem memakai `memfs` atau temp dir yang dibersihkan.
- Waktu diinjeksi lewat `Clock` interface; tidak ada `Date.now()` langsung di kode yang diuji.
- ID diinjeksi lewat `IdGenerator`; tes memakai ID deterministik.
- Random memakai seed tetap.
- Setiap tes punya satu alasan gagal yang jelas.

Contoh area unit:

- Parser slash command dan argumen.
- Validasi skema tool.
- Policy engine: kombinasi mode, tool, path, dan risiko.
- Path normalization dan symlink resolution.
- Token estimator.
- Cron parser dan perhitungan DST.
- State machine task dan agent.
- Redaksi secret.
- Hash chain audit.

## 4. Integration tests

Setiap tes integration memakai:

- Database SQLite baru di temp dir, migrasi dijalankan dari nol.
- Workspace fixture yang dibuat dan dihapus per tes.
- Mock provider dengan skrip respons.
- Queue worker in-process dengan waktu yang dipercepat.
- Tidak ada port tetap; port dipilih dinamis.

Skenario wajib:

1. Satu turn lengkap: pesan, stream, tool call, observasi, jawaban, usage.
2. Tool gagal, agent retry dengan strategi berbeda, lalu selesai.
3. Context hampir penuh, compaction berjalan, informasi penting tetap ada.
4. Dua agen menulis file sama, lease mencegah konflik.
5. Memory ditulis, dicari, dikoreksi, dihapus, FTS dan vec konsisten.
6. Job background dimulai, worker mati, job dipulihkan.
7. Gateway menerima pesan, membuat sesi, mengembalikan hasil ke kanal.
8. MCP server disconnect, client reconnect, tool tetap tersedia.
9. Plugin crash, daemon tetap hidup, plugin ditandai error.
10. Migrasi database gagal, backup dipulihkan.

## 5. End-to-end tests

E2E menjalankan binary `rann` dan `rannd` sebagai proses nyata, dengan:

- `RANN_HOME` di temp dir.
- Mock provider yang mendengarkan port dinamis.
- Workspace fixture berisi repo Git kecil.
- Gateway di port dinamis.

Skenario minimum:

| ID | Skenario | Bukti |
|---|---|---|
| E2E-001 | `rann -p "buat file halo.txt"` membuat file | File ada, exit 0 |
| E2E-002 | `rann` interaktif, kirim prompt, stream tampil | Snapshot terminal |
| E2E-003 | `/plan` lalu `/execute` | Plan tersimpan, file berubah |
| E2E-004 | Approval ditolak | Tidak ada perubahan file |
| E2E-005 | Kill daemon saat task, restart | Task pulih, tidak mengulang tool |
| E2E-006 | Telegram fake server mengirim pesan | Balasan ke chat yang sama |
| E2E-007 | Dashboard membuka tasks | Data sama dengan CLI |
| E2E-008 | Dua agen paralel | Tidak ada konflik file |
| E2E-009 | Scheduler menjalankan job | Job run tercatat |
| E2E-010 | Backup lalu restore | Data identik |

E2E tidak boleh memakai model nyata di CI utama. Tes `@live` dijalankan nightly dengan kunci rahasia dan kuota kecil.

## 6. Provider contract tests

Setiap adapter wajib lulus suite yang sama:

1. Chat non-stream mengembalikan teks dan usage.
2. Stream mengirim delta berurutan dan event selesai.
3. Tool call tunggal dan paralel.
4. Tool call dengan argumen parsial tidak dieksekusi.
5. Error 401, 403, 429, 500, dan timeout dipetakan dengan benar.
6. `Retry-After` dihormati.
7. Gambar dikirim dalam format yang benar jika didukung.
8. Structured output valid atau error yang jelas.
9. Usage cache read/write jika didukung.
10. Pembatalan request menghentikan stream.

Rekaman response disimpan sebagai fixture dengan versi. Jika provider mengubah format, tes kontrak gagal sebelum rilis.

## 7. Agent dan planning tests

Fixture tugas:

- Tambah endpoint REST dan tes.
- Perbaiki bug di tiga file dengan dependensi.
- Refactor fungsi tanpa mengubah perilaku.
- Migrasi skema database.
- Gagal karena file target tidak ada.
- Gagal karena tes tidak bisa dijalankan.

Yang dinilai:

- Rencana valid dan DAG tanpa siklus.
- Urutan eksekusi benar.
- Tidak ada tool tulis sebelum approval.
- Verifikasi dijalankan sebelum `done`.
- Laporan memuat bukti, bukan klaim.
- Replanning terjadi saat asumsi salah.
- Biaya dan langkah tidak melebihi budget.

## 8. Security tests

| Tes | Harapan |
|---|---|
| Path traversal `../../etc/passwd` | Ditolak, audit tercatat |
| Symlink ke luar workspace | Ditolak |
| Hardlink ke file sensitif | Ditolak |
| `rm -rf /` | Butuh konfirmasi eksplisit, default ditolak |
| `git push --force` | Ditolak tanpa approval |
| Secret di prompt | Tidak muncul di log, trace, atau DB |
| Secret di output tool | Diredaksi |
| API key di config | Tidak tersimpan plaintext |
| Prompt injection di file | Tidak mengubah goal atau izin |
| Prompt injection di output MCP | Diperlakukan sebagai data |
| Plugin membaca sesi lain | Ditolak |
| Token viewer mencoba approve | Ditolak |
| Audit diubah | Verifikasi hash gagal |
| Rate limit pairing | 5 percobaan per 15 menit |

Suite ini wajib lulus sebelum setiap rilis. Kegagalan satu tes memblokir rilis.

## 9. Performance tests

Hardware baseline: 4 vCPU, 8 GB RAM, SSD.

| Metrik | Target | Cara ukur |
|---|---|---|
| Startup CLI | < 1 detik p95 | 50 run, ukur sampai prompt siap |
| RSS idle daemon | < 150 MB | Setelah 60 detik idle |
| Query pesan terbaru | < 50 ms p95 | 1 juta pesan |
| Retrieval memory | < 80 ms p95 | 50.000 entri |
| Insert tool call | < 5 ms p95 | 10.000 insert |
| Delta pertama | < 1,5 detik p95 | Mock provider dengan delay 500 ms |
| Gateway request | < 50 ms p95 | 120 request/menit |
| Backup 1 GB | < 30 detik | `VACUUM INTO` |
| Recovery task | < 5 detik | Kill -9 lalu restart |

Hasil benchmark disimpan di `bench/results/` dengan tanggal, commit, dan hardware. Regresi > 20 persen menggagalkan CI nightly.

## 10. Recovery dan chaos tests

Chaos runner melakukan:

- `kill -9` pada daemon saat tool berjalan.
- `kill -9` pada worker saat job berjalan.
- Putus koneksi provider di tengah stream.
- Database lock 5 detik.
- Disk penuh simulasi.
- Gateway disconnect 30 detik.
- MCP server mati saat tool call.
- Plugin crash saat hook.
- Dua agen menulis file sama.
- Clock mundur 1 jam.

Yang diperiksa:

- Tidak ada data korup.
- Tidak ada job hilang setelah diakui.
- Tidak ada proses yatim.
- Lease dilepas.
- Audit tetap utuh.
- Pesan error jelas.

## 11. CI pipeline

| Tahap | Waktu | Blokir merge |
|---|---|---|
| Lint dan typecheck | 2 menit | Ya |
| Unit | 3 menit | Ya |
| Integration | 8 menit | Ya |
| E2E mock | 12 menit | Ya |
| Security suite | 5 menit | Ya |
| Build semua platform | 8 menit | Ya |
| Contract provider rekaman | 4 menit | Ya |
| Nightly live provider | 20 menit | Tidak, tetapi membuat issue |
| Nightly benchmark | 30 menit | Regresi > 20 persen membuat issue |
| Nightly chaos | 20 menit | Kegagalan membuat issue blocker |

## 12. Data tes dan rahasia

- Tidak ada kunci nyata di repo.
- Fixture provider memakai token palsu yang jelas.
- Tes `@live` membaca kunci dari secret CI dan dibatasi kuota.
- Log tes tidak mencetak prompt penuh atau secret.
- Artefak tes disimpan 7 hari.

## 13. Flaky test policy

- Tes flaky ditandai dan diisolasi dalam 24 jam.
- Tidak boleh dihapus tanpa pengganti.
- Flaky rate > 1 persen memblokir rilis.
- Penyebab umum: waktu nyata, port tetap, urutan tes, dan shared state.

## 14. Prosedur manual

Kriteria bertanda M diverifikasi dengan:

1. Menjalankan langkah di `test/manual/RC-AC-xxx.md`.
2. Mencatat versi, commit, platform, dan waktu.
3. Melampirkan bukti (tangkapan layar, ID sesi, baris audit).
4. Menyimpan hasil di `test/manual/results/<tanggal>/`.
5. Menandatangani hasil dengan nama pemeriksa.

## 15. Definisi selesai pengujian

Sebuah fitur dianggap teruji jika:

1. Ada unit test untuk logika murni.
2. Ada integration test untuk interaksi dengan storage atau komponen lain.
3. Ada E2E atau prosedur manual untuk jalur pengguna.
4. Ada tes error dan edge case, bukan hanya happy path.
5. Ada bukti bahwa tes gagal sebelum perbaikan (untuk bug fix).
6. Coverage tidak turun.
7. Dokumentasi diperbarui.
