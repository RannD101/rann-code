# RANN CODE CLI. Ringkasan Produk

- Dokumen induk: MASTER.md
- Versi: 1.0
- Status: spesifikasi V1, siap implementasi
- Bahasa: Indonesia

## 1. Executive summary

Rann Code adalah ekosistem agent coding otonom yang berjalan sebagai CLI, daemon, gateway, dan dashboard. Ia menggabungkan tiga hal yang biasanya terpisah:

1. **Agent coding interaktif** yang membaca repository, menulis patch, menjalankan tes, dan memverifikasi hasil.
2. **Runtime persisten** yang membuat task tetap hidup saat terminal ditutup, daemon restart, atau koneksi putus.
3. **Gateway multi-kanal** yang membuat agent yang sama bisa diakses dari Telegram, Discord, Slack, web chat, dan dashboard.

Produk ini tidak bergantung pada satu provider model. Anthropic, OpenAI, Google Gemini, OpenRouter, endpoint kompatibel OpenAI, dan server model lokal diperlakukan sebagai adapter dengan capability registry. Router memilih model berdasarkan tugas, biaya, dan kesehatan provider, dan tidak mengganti model yang dipatok pengguna tanpa izin.

Semua state bisnis disimpan lokal di SQLite dengan FTS5 dan sqlite-vec. Tidak ada akun cloud wajib, tidak ada database server wajib, dan tidak ada telemetry aktif secara default. Gateway bersifat opsional dan bisa dijalankan di VPS dengan autentikasi, scope, dan audit.

V1 mencakup seluruh fitur yang dispesifikasikan di dokumen ini. Tidak ada fitur yang sengaja ditunda ke versi berikutnya. Roadmap internal dibagi menjadi 16 milestone, tetapi semuanya adalah bagian dari target V1.

## 2. Product vision

Menjadi runtime agent coding yang bisa dipercaya untuk pekerjaan nyata: bisa ditinggal, bisa dilanjutkan, bisa diaudit, dan tidak mengunci pengguna pada satu model atau satu vendor.

Visi ini punya tiga konsekuensi konkret:

- **Bisa ditinggal.** Task panjang harus bertahan tanpa terminal. Agent yang hanya hidup selama tab terbuka tidak cukup.
- **Bisa dipercaya.** Setiap perubahan file, tool call, approval, dan biaya harus punya jejak. Klaim selesai harus diverifikasi.
- **Tidak mengunci.** Provider, model, tool, skill, dan kanal komunikasi harus bisa diganti tanpa membangun ulang agent.

## 3. Product goals

| Goal | Metrik | Target V1 |
|---|---|---|
| G1. Agent menyelesaikan tugas coding nyata | Tingkat keberhasilan pada suite tugas fixture | ≥ 80 persen tanpa intervensi manusia |
| G2. Task bertahan terhadap gangguan | Pemulihan setelah kill -9 | ≤ 5 detik, tanpa mengulang tool sukses |
| G3. Biaya terkendali | Akurasi pencatatan biaya untuk model berharga diketahui | ± 2 persen dari invoice provider |
| G4. Konteks tidak overflow | Turn yang gagal karena context overflow | < 1 persen setelah compaction |
| G5. Multi-provider nyata | Provider yang lulus tes kontrak | Minimal 5 adapter |
| G6. Aman secara default | Aksi tulis atau eksekusi tanpa izin | 0 pada mode `read-only` dan `ask` |
| G7. Bisa dioperasikan | Startup CLI | < 1 detik p95 |
| G8. Bisa dipelajari | Waktu pengguna baru menyelesaikan tugas pertama | < 10 menit dengan dokumentasi |
| G9. Konsistensi klien | State sama di CLI, dashboard, messaging | 100 persen operasi inti |
| G10. Dokumentasi bisa dibangun | FR yang punya AC dan tes | 151 dari 151 |

## 4. Non-goals

Hal berikut secara eksplisit bukan tujuan V1:

- **Bukan IDE.** Rann Code tidak menggantikan editor. Ia berintegrasi lewat terminal, file, dan Git, bukan membangun editor grafis.
- **Bukan model AI.** Rann Code tidak melatih atau menjual model. Ia mengorkestrasi model yang ada.
- **Bukan platform SaaS multi-tenant.** V1 mendukung beberapa pengguna di satu instalasi dengan role, tetapi bukan layanan hosted dengan billing dan isolasi tenant tingkat perusahaan.
- **Bukan pengganti CI.** Rann Code bisa menjalankan tes dan build, tetapi bukan sistem CI/CD dengan runner terdistribusi.
- **Bukan alat hacking.** Tool keamanan yang disediakan untuk pengujian yang sah, bukan untuk menyerang sistem tanpa izin.
- **Bukan clone Claude Code atau Hermes.** Tidak ada kode proprietary yang disalin. Konsep publik dipelajari, implementasi ditulis sendiri.
- **Bukan aplikasi mobile.** Klien mobile memakai messaging atau web, bukan aplikasi native.
- **Bukan vector database umum.** Pencarian vektor hanya untuk memory dan knowledge project.

## 5. Target users

### 5.1 Pengguna utama: developer solo dan tim kecil

Randi, 24 tahun, membangun beberapa proyek web dan Android sendiri. Ia ingin agent yang bisa mengerjakan refactor, menjalankan tes, dan melanjutkan task besok tanpa mengulang konteks. Ia sensitif terhadap biaya dan tidak mau bergantung pada satu provider.

Kebutuhan:

- CLI yang cepat dan tidak mengganggu.
- Bisa memilih model murah untuk tugas rutin dan model kuat untuk debugging.
- Bisa melihat diff dan menyetujui perubahan berisiko.
- Bisa melanjutkan sesi dari laptop lain atau dari Telegram.

### 5.2 Pengguna kedua: operator VPS

Seorang operator mengelola beberapa project di VPS. Ia ingin agent berjalan sebagai service, menerima task dari Telegram, dan mengirim laporan. Ia peduli pada keamanan akses remote, audit, dan backup.

Kebutuhan:

- Gateway dengan pairing dan scope.
- Scheduler untuk backup dan pemantauan.
- Log dan health check.
- Isolasi sesi dan plugin.

### 5.3 Pengguna ketiga: penulis skill dan plugin

Seorang power user ingin menambahkan tool, command, dan skill untuk alur kerjanya. Ia butuh API yang stabil, validasi, dan cara membagikan hasilnya.

Kebutuhan:

- SDK plugin dan tool.
- Registry skill dengan checksum.
- Dokumentasi manifest dan permission.
- Dry-run dan validasi.

### 5.4 Pengguna keempat: tim engineering

Tim 3 sampai 10 orang memakai satu VPS atau beberapa node. Mereka butuh role, audit, dan kebijakan izin yang konsisten.

Kebutuhan:

- RBAC dan scope token.
- Audit yang bisa diekspor.
- Kebijakan per project.
- Dashboard untuk memantau task dan biaya.

## 6. Product principles

1. **Local-first, remote-ready.** Semua fitur inti berjalan tanpa jaringan selain provider. Remote adalah lapisan opsional.
2. **State adalah kebenaran.** Tampilan mengikuti state, bukan sebaliknya. Tidak ada fitur UI tanpa backend.
3. **Verifikasi sebelum klaim.** Agent tidak boleh mengatakan selesai tanpa bukti yang bisa diperiksa.
4. **Izin eksplisit untuk risiko.** Aksi destruktif, jaringan baru, dan perubahan besar butuh persetujuan.
5. **Transparan soal uang dan model.** Biaya, token, model, dan alasan routing selalu bisa dilihat.
6. **Jangan menebak.** Jika informasi tidak cukup, agent bertanya atau menyatakan asumsi.
7. **Bisa dipulihkan.** Setiap langkah yang mengubah state harus punya checkpoint atau jejak.
8. **Modular tanpa bocor.** Batas paket ditegakkan, bukan hanya konvensi.
9. **Aman secara default.** Read-only dan ask adalah default; trusted adalah pilihan sadar.
10. **Dokumentasi adalah bagian produk.** Fitur tanpa spesifikasi dan acceptance criteria dianggap belum selesai.

## 7. Feature inventory

| Kode | Subsistem | FR | Dokumen |
|---|---|---|---|
| A | Interactive terminal interface | 001-020 | 02-cli-ux-and-commands.md |
| B | Slash command system | 001-020 | 02-cli-ux-and-commands.md |
| C | Autonomous agent engine | 021-039 | 03-agent-core.md |
| D | Planning system | 021-039 | 03-agent-core.md |
| E | Coding engine | 040-052 | 03-agent-core.md |
| F | Subagents dan agent teams | 053-062 | 03-agent-core.md |
| G | Persistent memory | 063-075 | 04-memory-skills-tools.md |
| H | Personality dan instruction system | 076 | 04-memory-skills-tools.md |
| I | Skills system | 077-085 | 04-memory-skills-tools.md |
| J | Tools system | 086-090 | 04-memory-skills-tools.md |
| K | MCP integration | 091-094 | 04-memory-skills-tools.md |
| L | Plugin system | 095-098 | 04-memory-skills-tools.md |
| M | Hooks system | 099-100 | 04-memory-skills-tools.md |
| N | Multi-model dan provider | 101-112 | 05-models-and-routing.md |
| O | Smart model router | 113-114 | 05-models-and-routing.md |
| P | Context intelligence | 101-114 | 05-models-and-routing.md |
| Q | Git dan version control | 115-117 | 06-runtime-and-services.md |
| R | Browser dan web automation | 118-120 | 06-runtime-and-services.md |
| S | Background tasks | 121-123 | 06-runtime-and-services.md |
| T | Scheduler dan automation | 124-126 | 06-runtime-and-services.md |
| U | Gateway dan remote agent | 127-131 | 06-runtime-and-services.md |
| V | Messaging integrations | 132-134 | 06-runtime-and-services.md |
| W | Web dashboard | 135-136 | 06-runtime-and-services.md |
| X | Security dan permission | 137-146 | 07-security-and-operations.md |
| Y | Self-improvement | 151 | 07-security-and-operations.md |
| Z | Storage, config, operasi | 147-150 | 07-security-and-operations.md + ARCHITECTURE.md |

Catatan: penomoran FR tidak selalu satu subsistem satu rentang eksklusif. Pemetaan tepat ada di ACCEPTANCE-CRITERIA.md dan di setiap entri FR.

## 8. Definisi istilah

| Istilah | Arti |
|---|---|
| Session | Percakapan atau ruang kerja yang punya riwayat dan konteks |
| Turn | Satu giliran pengguna dan seluruh langkah agent yang dipicu olehnya |
| Task | Unit pekerjaan dengan goal, status, dan kriteria selesai |
| Plan | Rencana task graph yang bisa disetujui dan direvisi |
| Agent | Instance runtime yang mengeksekusi task dengan profil tertentu |
| Subagent | Agent yang dibuat oleh agent lain untuk bagian pekerjaan |
| Tool | Fungsi yang bisa dipanggil model dengan skema tertentu |
| Skill | Prosedur dan pengetahuan yang dimuat sesuai trigger |
| Provider | Layanan model yang menyediakan API |
| Adapter | Implementasi wire protocol untuk satu jenis provider |
| Capability | Fitur yang benar-benar didukung model, bukan asumsi |
| Lease | Hak sementara untuk menulis path tertentu |
| Checkpoint | Titik pemulihan state dan file |
| Gateway | Layanan HTTP/WS yang menghubungkan klien eksternal ke daemon |
| Profile | Kumpulan konfigurasi, memory, dan identitas terpisah |
| Hook | Program yang dijalankan pada event tertentu |
| MCP | Model Context Protocol untuk integrasi tool eksternal |

## 9. Asumsi dan ketergantungan

- Pengguna punya setidaknya satu API key provider atau server model lokal.
- Node.js 22 tersedia, atau pengguna memakai binary yang disediakan.
- Git tersedia untuk fitur version control.
- Sistem operasi mendukung sandbox, atau pengguna menerima mode izin yang lebih ketat.
- Provider memiliki kuota yang cukup; Rann Code tidak menyediakan kuota model.
- Waktu sistem akurat; scheduler bergantung pada jam sistem dan database timezone.
- Untuk gateway publik, pengguna menyediakan domain dan TLS.

## 10. Kriteria keberhasilan dokumentasi

Developer lain harus bisa:

1. Menjelaskan alur satu turn dari input sampai output tanpa membaca kode.
2. Menambah provider baru hanya dengan mengikuti satu dokumen adapter.
3. Menambah tool baru tanpa mengubah agent.
4. Membangun ulang database dari migrasi dan memahami setiap tabel.
5. Menjalankan seluruh acceptance criteria dan tahu kapan V1 selesai.
6. Menemukan keputusan teknologi beserta alasannya.
