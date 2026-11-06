# MASTER. Rann Code CLI V1

- Versi dokumen: 1.0
- Tanggal: 5 November 2026
- Status: spesifikasi lengkap, siap implementasi
- Bahasa: Indonesia
- Pemilik produk: Rann
- Lokasi: `docs/prd/`

## 1. Apa dokumen ini

Ini adalah pusat dokumentasi Rann Code CLI V1. Semua spesifikasi produk, arsitektur, requirement, acceptance criteria, keputusan teknologi, dan roadmap ada di folder ini. Dokumen ini tidak berisi kode implementasi. Tujuannya adalah memastikan developer lain bisa membangun Rann Code V1 tanpa menebak maksud fitur, workflow, struktur sistem, atau perilaku yang diharapkan.

Rann Code adalah autonomous AI agent ecosystem yang menggabungkan kemampuan coding agent, runtime persisten, multi-agent orchestration, memory, skills, tools, MCP, plugin, hooks, multi-provider routing, gateway remote, messaging, dan dashboard web. Seluruh fitur tersebut adalah target V1, bukan roadmap versi berikutnya.

## 2. Peta dokumen

| Dokumen | Isi | Baris | Untuk siapa |
|---|---|---|---|
| 00-overview.md | Executive summary, visi, goal, non-goal, user, prinsip, inventory | 193 | Semua |
| 01-requirements.md | 151 FR, 24 NFR, prioritas, dependensi | 1.987 | PM, engineer, QA |
| 02-cli-ux-and-commands.md | UX terminal, layout, registry 97 command, contoh penggunaan | 755 | Frontend CLI, QA |
| 03-agent-core.md | Agent loop, planning, coding engine, multi-agent | 753 | Backend engineer |
| 04-memory-skills-tools.md | Memory, instruksi, skills, tools, MCP, plugin, hooks | 839 | Backend engineer |
| 05-models-and-routing.md | Provider, model registry, router, context intelligence | 533 | Backend engineer |
| 06-runtime-and-services.md | Git, browser, background, scheduler, gateway, messaging, dashboard | 526 | Backend, DevOps |
| 07-security-and-operations.md | Keamanan, performa, reliability, deployment, instalasi, observasi, self-improvement | 553 | Security, DevOps |
| ARCHITECTURE.md | System context, proses, modul, data flow, lifecycle, storage, API, error | 1.260 | Semua engineer |
| FEATURE-PARITY.md | Perbandingan Claude Code, Hermes, Rann Code | 229 | PM, arsitek |
| IMPLEMENTATION-ROADMAP.md | 16 milestone, dependency, DoD, estimasi, risiko | 539 | PM, tech lead |
| ACCEPTANCE-CRITERIA.md | 151 AC, metode verifikasi, gate rilis | 272 | QA, engineer |
| TECH-STACK-DECISIONS.md | 20 ADR, alternatif, konsekuensi, dependensi eksternal | 238 | Arsitek, engineer |
| TESTING-STRATEGY.md | Piramida tes, kontrak provider, chaos, CI, flaky policy | 261 | QA, engineer |

Baris di atas adalah hasil audit terakhir. Jika dokumen berubah, perbarui angka ini.

## 3. Cara membaca

### 3.1 Kalau kamu engineer yang akan membangun

1. Baca 00-overview.md bagian 1 sampai 6.
2. Baca ARCHITECTURE.md bagian 1 sampai 8 untuk memahami bentuk sistem.
3. Baca 01-requirements.md untuk requirement yang relevan dengan modulmu.
4. Baca dokumen subsistem: 02 untuk CLI, 03 untuk agent, 04 untuk memory dan ekstensi, 05 untuk provider, 06 untuk layanan, 07 untuk keamanan.
5. Baca ACCEPTANCE-CRITERIA.md untuk tahu kapan pekerjaanmu selesai.
6. Baca TECH-STACK-DECISIONS.md sebelum menambah dependency.
7. Ikuti IMPLEMENTATION-ROADMAP.md untuk urutan milestone.

### 3.2 Kalau kamu PM atau reviewer

1. 00-overview.md.
2. FEATURE-PARITY.md.
3. 01-requirements.md bagian 9 (NFR).
4. IMPLEMENTATION-ROADMAP.md.
5. ACCEPTANCE-CRITERIA.md bagian 14 (gate rilis).

### 3.3 Kalau kamu operator

1. 06-runtime-and-services.md bagian gateway, scheduler, messaging.
2. 07-security-and-operations.md bagian deployment, instalasi, observability.
3. ARCHITECTURE.md bagian 9 (storage) dan 10 (config).
4. TESTING-STRATEGY.md bagian recovery.

## 4. Peta 48 bab PRD

| Bab yang diminta | Lokasi | Status |
|---|---|---|
| 1. Executive Summary | 00-overview.md §1 | Lengkap |
| 2. Product Vision | 00-overview.md §2 | Lengkap |
| 3. Product Goals | 00-overview.md §3 | Lengkap |
| 4. Non-Goals | 00-overview.md §4 | Lengkap |
| 5. Target Users | 00-overview.md §5 | Lengkap |
| 6. Product Principles | 00-overview.md §6 | Lengkap |
| 7. Feature Inventory | 00-overview.md §7 | Lengkap |
| 8. Functional Requirements | 01-requirements.md §8 | 151 FR |
| 9. Non-Functional Requirements | 01-requirements.md §9 | 24 NFR |
| 10. UX/UI Specifications | 02-cli-ux-and-commands.md §10 | Lengkap |
| 11. Slash Command Registry | 02-cli-ux-and-commands.md §11 | 97 command |
| 12. Agent Architecture | 03-agent-core.md §12 | Lengkap |
| 13. Coding Engine Architecture | 03-agent-core.md §14 | Lengkap |
| 14. Multi-Agent Architecture | 03-agent-core.md §15 | Lengkap |
| 15. Memory Architecture | 04-memory-skills-tools.md §16 | Lengkap |
| 16. Skills Architecture | 04-memory-skills-tools.md §17 | Lengkap |
| 17. Tools Architecture | 04-memory-skills-tools.md §19 | Lengkap |
| 18. MCP Architecture | 04-memory-skills-tools.md §20 | Lengkap |
| 19. Plugin Architecture | 04-memory-skills-tools.md §21 | Lengkap |
| 20. Hooks Architecture | 04-memory-skills-tools.md §22 | Lengkap |
| 21. Provider Architecture | 05-models-and-routing.md §23 | Lengkap |
| 22. Smart Router Architecture | 05-models-and-routing.md §25 | Lengkap |
| 23. Context Management | 05-models-and-routing.md §26 | Lengkap |
| 24. Git Integration | 06-runtime-and-services.md §27 | Lengkap |
| 25. Browser Automation | 06-runtime-and-services.md §28 | Lengkap |
| 26. Background Task System | 06-runtime-and-services.md §29 | Lengkap |
| 27. Scheduler | 06-runtime-and-services.md §30 | Lengkap |
| 28. Gateway | 06-runtime-and-services.md §31 | Lengkap |
| 29. Messaging Integrations | 06-runtime-and-services.md §32 | Lengkap |
| 30. Web Dashboard | 06-runtime-and-services.md §33 | Lengkap |
| 31. Security Architecture | 07-security-and-operations.md §34 | Lengkap |
| 32. Storage Architecture | ARCHITECTURE.md §9 | Lengkap |
| 33. Configuration Architecture | ARCHITECTURE.md §10 | Lengkap |
| 34. API Specifications | ARCHITECTURE.md §11 | JSON-RPC, REST, WS |
| 35. Data Models | ARCHITECTURE.md §12 | Lengkap |
| 36. Database Schema | ARCHITECTURE.md §9.3 | 37 tabel |
| 37. Directory Structure | ARCHITECTURE.md §9.2 | Lengkap |
| 38. Workflow Diagrams | 03 §12, ARCHITECTURE §7 dan §8 | Mermaid |
| 39. Error Handling | ARCHITECTURE.md §13 | Taksonomi dan retry |
| 40. Performance Requirements | 07 §35, 01 §9 | Terukur |
| 41. Testing Strategy | TESTING-STRATEGY.md | Lengkap |
| 42. Acceptance Criteria | ACCEPTANCE-CRITERIA.md | 151 AC |
| 43. Implementation Milestones | IMPLEMENTATION-ROADMAP.md | 16 milestone |
| 44. Dependencies | TECH-STACK-DECISIONS.md §Dependency eksternal | Lengkap |
| 45. Risks & Mitigations | IMPLEMENTATION-ROADMAP.md §7 | 11 risiko |
| 46. Deployment Architecture | 07 §37, ARCHITECTURE §15 | Lokal, VPS, multi-node |
| 47. Installation & Distribution | 07 §38 | npm, binary, Docker |
| 48. Maintenance & Observability | 07 §39 | Lengkap |

Catatan: dokumen memakai nomor bab global yang berurutan (01: 8-9, 02: 10-11, 03: 12-15, 04: 16-22, 05: 23-26, 06: 27-33, 07: 34-39, ARCHITECTURE: 1-15). Tabel ini memetakan outline 48 bab ke lokasi sebenarnya; beberapa bab outline digabung dalam satu bab dokumen agar tidak ada duplikasi.

## 5. Requirement summary

| Kelompok | FR | Jumlah | Dokumen |
|---|---|---|---|
| Terminal dan command | 001-020 | 20 | 02 |
| Agent dan planning | 021-039 | 19 | 03 |
| Coding engine | 040-052 | 13 | 03 |
| Multi-agent | 053-062 | 10 | 03 |
| Memory dan instruksi | 063-076 | 14 | 04 |
| Skills dan tools | 077-090 | 14 | 04 |
| MCP, plugin, hooks | 091-100 | 10 | 04 |
| Provider, router, context | 101-114 | 14 | 05 |
| Git, browser, background, scheduler | 115-126 | 12 | 06 |
| Gateway, messaging, dashboard | 127-136 | 10 | 06 |
| Security, storage, config, ops | 137-150 | 14 | 07 |
| Self-improvement | 151 | 1 | 07 §34.9 |
| Total | 001-151 | 151 | |

Prioritas:

- P0: 116 FR, jalur kritis V1.
- P1: 34 FR, wajib V1 tetapi bisa menyusul dalam urutan milestone.
- P2: 1 FR, tetap wajib V1, dijadwalkan setelah P1.

Tidak ada FR yang ditandai V2 atau ditunda di luar V1.

## 6. Keputusan arsitektur kunci

| Keputusan | Alasan | Konsekuensi |
|---|---|---|
| CLI tipis + daemon persisten | Task bertahan saat terminal ditutup | Butuh IPC dan lifecycle |
| SQLite + FTS5 + sqlite-vec | Local-first, satu file, transaksional | Satu writer, perlu antrean |
| Adapter provider + capability registry | Tidak mengasumsikan semua model sama | Tes kontrak wajib |
| JSON-RPC internal, REST/WS eksternal | Pemisahan internal dan publik | Dua kontrak yang harus dijaga |
| Plugin di proses terpisah | Isolasi kode tidak tepercaya | Latensi dan kompleksitas |
| Path lease + merge queue | Mencegah konflik multi-agent | Perlu heartbeat dan TTL |
| Verifier sebelum `done` | Klaim harus punya bukti | Task bisa lebih lama |
| Audit hash chain | Jejak tidak bisa diubah diam-diam | Biaya tulis dan verifikasi |
| Gateway self-hosted | Kendali penuh, tanpa akun wajib | Operator mengelola TLS |

Detail dan alternatif yang ditolak ada di TECH-STACK-DECISIONS.md.

## 7. Alur utama

### 7.1 Pengguna membuka terminal dan memberi tugas

```
rann
> perbaiki bug login dan tambahkan tes
```

Alur:

1. CLI mengirim `session.send` ke daemon.
2. Daemon menyimpan pesan dan membuat turn.
3. Agent membangun konteks: instruksi, memory, file relevan, riwayat.
4. Planner membuat task graph jika perlu.
5. Approval diminta untuk perubahan berisiko.
6. Tool dijalankan, hasil diobservasi, agent mengevaluasi.
7. Verifier menjalankan tes.
8. Laporan dikirim ke CLI dengan bukti.

### 7.2 Pengguna menjalankan task dari Telegram

```
/run perbaiki tes yang gagal di project unsolved
```

Alur:

1. Gateway menerima pesan, memverifikasi token dan scope.
2. Gateway memetakan chat/topic ke sesi.
3. Daemon menjalankan task yang sama seperti CLI.
4. Approval dikirim sebagai tombol inline.
5. Hasil dikirim ke chat asal, dengan ringkasan dan tautan dashboard.

### 7.3 Task panjang ditinggal

```
rann -p "refactor modul pembayaran" --background
```

Alur:

1. Task masuk antrean SQLite.
2. Worker mengambil job dan menulis heartbeat.
3. Terminal boleh ditutup.
4. Jika daemon restart, task dipulihkan dari checkpoint.
5. Notifikasi dikirim saat selesai atau butuh approval.

## 8. Batas dan asumsi

- Rann Code tidak menyediakan model. Pengguna harus punya API key atau server model.
- Kualitas hasil bergantung pada model dan konteks yang tersedia.
- Sandbox OS tidak tersedia di semua platform; mode izin tetap berlaku.
- Gateway publik membutuhkan domain, TLS, dan konfigurasi firewall oleh operator.
- Multi-node tidak berbagi database; setiap node punya state sendiri.
- Harga model bisa berubah; registry harga harus bisa diperbarui.
- Beberapa fitur platform (keychain, sandbox macOS, Node SEA) perlu verifikasi saat M0.

## 9. Pertanyaan terbuka

Pertanyaan berikut belum diputuskan dan tidak menghalangi implementasi karena ada default yang disebutkan. Keputusan akhir ada di pemilik produk.

| Pertanyaan | Default yang dipakai dokumen | Dampak jika berubah |
|---|---|---|
| Nama paket npm dan scope | `rann-code`, binary `rann` | Instalasi dan dokumentasi |
| Lisensi | Proprietary, source available | Distribusi dan kontribusi |
| Provider default | Tidak ada; pengguna memilih saat onboarding | Pengalaman first-run |
| Model default | `auto` dengan router | Biaya dan kualitas |
| Telemetry | Mati | Privasi dan analytics |
| Bahasa UI default | Indonesia, Inggris tersedia | Dokumentasi dan QA |
| Signature plugin | Wajib untuk registry publik, opsional untuk lokal | Keamanan ekosistem |
| Multi-node state | Terpisah per node | Konsistensi dan failover |
| Dukungan Windows sandbox | Mode `ask` jika AppContainer tidak tersedia | Keamanan Windows |
| Harga model | Registry lokal yang bisa diperbarui | Akurasi biaya |

## 10. Aturan konsistensi dokumen

1. Setiap FR punya AC dengan nomor sama.
2. Setiap AC merujuk FR dan punya metode verifikasi.
3. Setiap command yang disebut di dokumen harus ada di registry 02.
4. Setiap tabel database yang disebut di dokumen harus ada di ARCHITECTURE §9.3.
5. Setiap dependency eksternal harus ada di TECH-STACK-DECISIONS.
6. Setiap milestone harus merujuk FR dan AC.
7. Tidak ada em dash atau en dash di seluruh dokumen.
8. Tidak ada karakter non-Latin yang tidak disengaja.
9. Angka dan ambang harus konsisten antar dokumen.
10. Perubahan perilaku memperbarui FR, AC, tes, dan changelog dalam satu perubahan.

Audit otomatis yang dijalankan:

- Ekstraksi `RC-FR-\d{3}` dan cek 001-151 tanpa celah.
- Ekstraksi `RC-AC-\d{3}` dan cek 001-151 tanpa celah.
- Cek FR tanpa AC dan AC tanpa FR.
- Cek karakter em dash, en dash, dan CJK.
- Cek referensi dokumen yang tidak ada.
- Cek command yang disebut tetapi tidak ada di registry.

## 11. Self-review terhadap instruksi akhir

| Pertanyaan audit | Jawaban | Bukti |
|---|---|---|
| Apakah seluruh fitur utama Claude Code tercakup? | Ya | FEATURE-PARITY §2, 151 FR |
| Apakah seluruh fitur utama Hermes tercakup? | Ya | FEATURE-PARITY §2 |
| Apakah fitur tambahan Rann Code tercakup? | Ya | FR 053-062, 099-100, 113-114, 151 |
| Apakah semua fitur punya implementasi jelas? | Ya | FR + dokumen subsistem + ARCHITECTURE |
| Apakah ada fitur placeholder? | Tidak | Tidak ada TODO atau "not implemented" di jalur pengguna |
| Apakah dependency sudah didefinisikan? | Ya | TECH-STACK §Dependency eksternal |
| Apakah ada konflik arsitektur? | Tidak | Konflik dan resolusi ada di §12 |
| Apakah keamanan diperhitungkan? | Ya | 07, FR 137-145, TESTING §8 |
| Apakah sistem bisa local-first? | Ya | ARCHITECTURE §9, §15.1 |
| Apakah sistem bisa berjalan di VPS? | Ya | ARCHITECTURE §15.2, 07 §37 |
| Apakah remote agent aman? | Ya | FR 128-131, TLS, token hash, scope |
| Apakah task bisa dipulihkan setelah crash? | Ya | FR 038, 122, checkpoint, job recovery |
| Apakah seluruh fitur bisa diuji? | Ya | 151 AC, TESTING-STRATEGY |
| Apakah semua kemampuan bisa diakses lewat CLI? | Ya | Registry 97 command, 02 §11 |

## 12. Konflik dan resolusi

| Konflik | Resolusi |
|---|---|
| SQLite satu writer vs banyak agen | Antrean tulis internal dan WAL; baca paralel |
| Multi-node vs satu database | Setiap node punya database sendiri; routing berdasarkan project |
| Model dipatok vs fallback | Fallback hanya jika `allowFallback`; jika tidak, error |
| Plugin kuat vs isolasi | Proses terpisah, permission deklaratif, output tidak tepercaya |
| Context besar vs biaya | Retrieval, compaction, dan budget token |
| Banyak fitur vs V1 | Semua fitur masuk V1; urutan milestone, bukan pemotongan |
| Dashboard vs CLI state | Satu API dan satu database; dashboard tidak menyimpan state bisnis |
| Sandbox vs kompatibilitas | Sandbox OS jika tersedia; fallback policy aplikasi dan mode lebih ketat |
| Audit lengkap vs privasi | Audit menyimpan metadata dan hash, bukan isi secret atau prompt penuh |
| Multi-bahasa vs konsistensi | UI Indonesia dan Inggris; prompt sistem netral bahasa |

## 13. Status kesiapan

| Area | Status |
|---|---|
| Requirement | Siap, 151 FR |
| Non-functional | Siap, 24 NFR |
| Arsitektur | Siap, diagram dan batas modul |
| Storage | Siap, DDL dan migrasi |
| API | Siap, JSON-RPC, REST, WS |
| Keamanan | Siap, model ancaman dan kontrol |
| Testing | Siap, strategi dan gate |
| Roadmap | Siap, 16 milestone dan estimasi |
| Dokumentasi pengguna | Belum ditulis; menjadi deliverable M15 |
| Kode | Belum ada, sesuai instruksi |

## 14. Langkah berikutnya

1. Review dokumen ini dan putuskan pertanyaan terbuka di §9.
2. Setujui stack di TECH-STACK-DECISIONS.
3. Mulai M0 di IMPLEMENTATION-ROADMAP.
4. Gunakan ACCEPTANCE-CRITERIA sebagai definisi selesai.
5. Perbarui dokumen dalam PR yang sama dengan perubahan perilaku.
