# TECH-STACK-DECISIONS. Rann Code V1

- Dokumen induk: MASTER.md
- Versi: 1.0
- Format: Architecture Decision Record ringkas. Setiap keputusan menyebut konteks, pilihan, alternatif yang ditolak, dan konsekuensi.
- Prinsip: teknologi dipilih karena cocok dengan batasan, bukan karena populer.

## Ringkasan stack

| Lapisan | Pilihan | Alasan singkat |
|---|---|---|
| Bahasa | TypeScript 5.x, strict | Tipe lintas paket, ekosistem agent dan tool matang |
| Runtime | Node.js 22 LTS | Stabil, dukungan jangka panjang, performa I/O baik |
| Monorepo | pnpm workspace + Turborepo | Instalasi cepat, cache build, batas paket jelas |
| CLI parser | Commander | Stabil, ringan, mudah dipetakan ke registry |
| TUI | Ink 5 + React 18 | Komponen deklaratif, ekosistem luas, testable |
| Database | SQLite 3.45+ mode WAL | Local-first, transaksi, satu file, tanpa server |
| Driver DB | better-sqlite3 | Sinkron, cepat, kontrol transaksi penuh |
| Query builder | Kysely | Tipe aman tanpa menyembunyikan SQL |
| FTS | SQLite FTS5 | Sudah termasuk, cukup untuk skala lokal |
| Vektor | sqlite-vec | Satu file, tanpa layanan eksternal |
| Provider | Adapter native `fetch` + Zod | Normalisasi streaming dan error seragam |
| Gateway | Fastify 5 + `ws` | Cepat, skema validasi, plugin matang |
| Dashboard | React 19 + Vite + TanStack + Tailwind + Radix | Build cepat, aksesibel, tanpa lock-in |
| Antrean | Tabel SQLite + worker | Tidak perlu Redis untuk instalasi tunggal |
| Scheduler | Croner | Timezone dan DST ditangani |
| Sandbox | bubblewrap / sandbox-exec / container | Isolasi di tingkat OS |
| Plugin | Proses anak + JSON-RPC | Isolasi kode tidak tepercaya |
| MCP | `@modelcontextprotocol/sdk` | Mengikuti spesifikasi resmi |
| Log | Pino + redaksi | Cepat, JSON, aman |
| Trace | OpenTelemetry + penyimpanan lokal | Standar, bisa diekspor |
| Test | Vitest + Playwright | Cepat, API kompatibel Jest, browser nyata |
| Distribusi | npm, Node SEA, Docker | Menjangkau pengguna CLI dan server |

## ADR-001. Bahasa dan runtime

**Konteks.** Produk harus berjalan di Linux, macOS, dan Windows, punya ekosistem tool dan MCP yang luas, serta mudah diperluas komunitas.

**Keputusan.** TypeScript 5.x strict di Node.js 22 LTS.

**Alternatif.**

| Pilihan | Kelebihan | Kekurangan | Putusan |
|---|---|---|---|
| Go | Binary tunggal, cepat, konkurensi baik | Ekosistem agent, MCP, dan TUI lebih kecil; iterasi lebih lambat | Ditolak |
| Rust | Performa dan keamanan memori | Biaya pengembangan tinggi untuk tim kecil | Ditolak |
| Python | Ekosistem AI terbesar | Distribusi CLI dan concurrency kurang rapi, typing tidak konsisten | Ditolak |
| Bun | Cepat, tooling terpadu | Ekosistem produksi dan stabilitas jangka panjang belum setara Node | Ditolak untuk V1 |
| Node + TypeScript | Ekosistem luas, tipe, satu bahasa untuk CLI, gateway, dashboard | Memori lebih besar dari Go/Rust | Dipilih |

**Konsekuensi.** RSS idle target 150 MB harus dijaga dengan lazy loading. Binary tunggal memakai Node SEA, bukan runtime terpisah.

## ADR-002. Struktur monorepo

**Konteks.** Enam aplikasi dan belasan paket harus berbagi tipe tanpa saling menyeret dependensi.

**Keputusan.** pnpm workspace, Turborepo untuk cache, `dependency-cruiser` untuk aturan batas modul.

**Alternatif.** Satu paket besar (ditolak: batas modul kabur), Nx (ditolak: konfigurasi berat untuk tim kecil), npm workspace (ditolak: resolusi dan kecepatan lebih lemah).

**Konsekuensi.** Setiap paket punya `package.json` dan `tsconfig` sendiri. Build memakai `tsup` per paket, dengan `exports` eksplisit.

## ADR-003. CLI parsing dan command registry

**Konteks.** Ada 97 command bawaan, alias, argumen opsional, dan command dari plugin.

**Keputusan.** Commander untuk parsing awal, lalu registry internal sebagai sumber kebenaran metadata command (nama, alias, skema Zod, permission, handler, help).

**Alternatif.** Yargs (ditolak: API global dan sulit diuji), oclif (ditolak: terlalu berat dan mengikat struktur), parser buatan sendiri (ditolak: risiko bug parsing).

**Konsekuensi.** Command plugin didaftarkan saat runtime; bentrok nama ditolak. Help dihasilkan dari registry, bukan dari string terpisah.

## ADR-004. Terminal UI

**Konteks.** Butuh layout kompleks, streaming, input multiline, dan komponen yang bisa diuji.

**Keputusan.** Ink 5 + React 18, dengan renderer throttled 30 fps dan buffer baris.

**Alternatif.** Blessed (ditolak: API lama, komunitas menurun), Textual/Go TUI (ditolak: bahasa berbeda), ANSI manual (ditolak: biaya perawatan tinggi).

**Konsekuensi.** Ink memakai Yoga untuk layout; ukuran terminal kecil harus diuji. Untuk `TERM=dumb`, renderer memakai mode teks sederhana tanpa React.

## ADR-005. Database dan akses data

**Konteks.** State harus lokal, transaksional, dan cukup cepat untuk ribuan sesi.

**Keputusan.** SQLite mode WAL, `better-sqlite3`, Kysely untuk query bertipe, migrasi SQL versioned.

**Alternatif.** PostgreSQL (ditolak: server eksternal melanggar local-first), DuckDB (ditolak: bukan untuk OLTP), Prisma (ditolak: runtime berat dan kontrol SQL terbatas), Drizzle (dipertimbangkan, tetapi Kysely lebih dekat ke SQL dan stabil untuk repository pattern).

**Konsekuensi.** Satu writer; semua tulisan lewat antrean storage. Untuk multi-node, setiap node punya DB sendiri dan tidak berbagi file DB.

## ADR-006. Pencarian vektor

**Konteks.** Retrieval memory dan knowledge butuh kemiripan semantik tanpa layanan tambahan.

**Keputusan.** `sqlite-vec` dengan tabel virtual, dimensi mengikuti model embedding, reindex saat model berubah.

**Alternatif.** Chroma/Qdrant (ditolak: proses dan penyimpanan tambahan), pgvector (ditolak: butuh PostgreSQL), FAISS (ditolak: indeks terpisah dan tidak transaksional dengan metadata).

**Konsekuensi.** Kualitas tergantung model embedding. Jika `sqlite-vec` tidak tersedia di platform, sistem fallback ke FTS + cosine di aplikasi dengan peringatan performa.

## ADR-007. Full-text search

**Keputusan.** FTS5 dengan tokenizer `porter unicode61`, trigger sinkron, dan RRF untuk menggabungkan FTS dan vektor.

**Alternatif.** Meilisearch (ditolak: server tambahan), Elasticsearch (ditolak: berat), LIKE (ditolak: tidak relevan untuk teks panjang).

**Konsekuensi.** Bahasa non-Latin tetap didukung lewat `unicode61`, tetapi stemming hanya untuk Inggris. Untuk bahasa Indonesia, pencarian memakai token utuh dan vektor.

## ADR-008. Abstraksi provider

**Konteks.** Provider berbeda dalam streaming, tool call, schema, error, dan usage. SDK resmi berubah cepat dan menyeret dependensi besar.

**Keputusan.** Adapter internal memakai `fetch` dan parser SSE sendiri, dengan Zod untuk validasi event. SDK resmi hanya dipakai jika diperlukan untuk OAuth atau signing.

**Alternatif.** SDK resmi semua provider (ditolak: ukuran, versi konflik, perbedaan event), LiteLLM (ditolak: proxy Python eksternal), OpenRouter saja (ditolak: mengunci pada satu perantara).

**Konsekuensi.** Tim harus merawat parser per wire protocol. Tes kontrak dan rekaman response menjadi wajib. Keuntungan: error dan usage seragam, tidak ada dependency besar.

## ADR-009. Gateway

**Keputusan.** Fastify 5, REST `/v1`, WebSocket untuk event, token opaque yang di-hash, bukan JWT.

**Alternatif.** Express (ditolak: performa dan validasi lebih lemah), Hono (dipertimbangkan, tetapi ekosistem plugin server lebih kecil), JWT (ditolak: tidak bisa dicabut seketika tanpa daftar blokir).

**Konsekuensi.** Token disimpan sebagai hash; pencabutan langsung berlaku. Setiap request melewati scope check dan audit.

## ADR-010. Dashboard

**Keputusan.** React 19, Vite, TanStack Router dan Query, Tailwind CSS v4, Radix primitives, Recharts.

**Alternatif.** Next.js (ditolak: SSR tidak dibutuhkan untuk dashboard lokal dan menambah kompleksitas), Vue/Svelte (ditolak: tim memakai React), komponen UI berbayar (ditolak: lisensi dan berat).

**Konsekuensi.** Dashboard adalah SPA yang dilayani gateway. Tidak ada akses langsung ke database. State derived dari API yang sama dengan CLI.

## ADR-011. Antrean dan worker

**Konteks.** Background task dan job harus bertahan setelah restart tanpa Redis.

**Keputusan.** Tabel `jobs` di SQLite, klaim dengan transaksi `BEGIN IMMEDIATE`, heartbeat, lease, dan worker in-process atau proses terpisah.

**Alternatif.** BullMQ + Redis (ditolak untuk default: dependensi eksternal), RabbitMQ (ditolak: berat), antrean in-memory (ditolak: hilang saat crash).

**Konsekuensi.** Throughput dibatasi satu writer. Untuk kebutuhan tinggi, adapter Redis bisa ditambahkan tanpa mengubah API antrean.

## ADR-012. Scheduler

**Keputusan.** Croner untuk parsing cron, interval, dan timezone; penyimpanan jadwal di SQLite; perhitungan `next_run_at` dalam UTC dengan evaluasi zona lokal.

**Alternatif.** node-cron (ditolak: timezone terbatas), Agenda (ditolak: butuh MongoDB), cron manual (ditolak: risiko DST).

**Konsekuensi.** Job yang terlewat saat daemon mati dijalankan sekali dengan kebijakan `catchUp` yang bisa dikonfigurasi.

## ADR-013. Sandbox eksekusi

**Keputusan.** Linux: bubblewrap (`bwrap`) dengan bind mount read-only dan network namespace opsional. macOS: `sandbox-exec` dengan profil. Windows: Job Object dan AppContainer bila tersedia; jika tidak, mode `ask` dengan peringatan. Container opsional untuk isolasi penuh.

**Alternatif.** Chroot (ditolak: butuh root dan tidak cukup), seccomp langsung (ditolak: kompleks dan rapuh), hanya validasi path (ditolak: tidak melindungi dari perintah shell).

**Konsekuensi.** Sandbox adalah lapisan pertahanan, bukan jaminan. Jika sandbox tidak tersedia, sistem menurunkan mode dan memberi tahu pengguna.

## ADR-014. Plugin runtime

**Keputusan.** Plugin pihak ketiga berjalan di proses anak Node dengan JSON-RPC stdio. Plugin tepercaya bisa berjalan in-process dengan flag eksplisit.

**Alternatif.** Semua in-process (ditolak: satu crash atau kebocoran mengancam daemon), WebAssembly (ditolak: API ekosistem terbatas), container per plugin (ditolak: terlalu berat untuk default).

**Konsekuensi.** Latensi panggilan plugin lebih tinggi. Plugin harus mendeklarasikan permission; akses file dan jaringan dibatasi wrapper.

## ADR-015. MCP

**Keputusan.** `@modelcontextprotocol/sdk`, transport stdio dan Streamable HTTP, OAuth 2.1 untuk server remote, namespacing `server.tool`.

**Alternatif.** Implementasi protokol sendiri (ditolak: risiko ketidakcocokan), hanya stdio (ditolak: tidak mendukung server remote).

**Konsekuensi.** Versi SDK harus dipin dan diuji terhadap spesifikasi. Perubahan protokol memerlukan adapter versi.

## ADR-016. Logging dan observability

**Keputusan.** Pino untuk log JSON dengan redaksi, OpenTelemetry untuk trace, penyimpanan span lokal di SQLite, ekspor OTLP opsional. Metrics gateway memakai `prom-client`.

**Alternatif.** Winston (ditolak: lebih lambat dan konfigurasi berat), log teks (ditolak: sulit diparse), hanya console (ditolak: tidak cukup untuk audit).

**Konsekuensi.** Log tidak boleh memuat prompt penuh secara default. Sampling trace default 10 persen, bisa dinaikkan per sesi debug.

## ADR-017. Testing

**Keputusan.** Vitest untuk unit dan integration, Playwright untuk dashboard dan browser automation, fixture provider rekaman, dan chaos test untuk recovery.

**Alternatif.** Jest (ditolak: lebih lambat dan konfigurasi ESM rumit), Mocha (ditolak: ekosistem assertion terpisah), Cypress (ditolak: lebih berat untuk dashboard lokal).

**Konsekuensi.** Tes provider memakai mock dan rekaman; tes nyata dijalankan manual dengan kunci di CI rahasia. Coverage inti ≥ 80 persen.

## ADR-018. Distribusi

**Keputusan.** npm sebagai jalur utama (`npm i -g rann-code`), Node SEA untuk binary per platform, Docker image untuk gateway, Homebrew tap untuk macOS, dan skrip installer untuk Linux.

**Alternatif.** Hanya npm (ditolak: butuh Node di mesin pengguna), hanya binary (ditolak: update lebih sulit), Snap/Flatpak (ditunda: biaya packaging).

**Konsekuensi.** Binary SEA harus diuji per platform. Auto-update memeriksa versi dan checksum, tidak pernah menimpa binary yang sedang berjalan.

## ADR-019. Secret management

**Keputusan.** Vault file `secrets/vault.enc` dengan XChaCha20-Poly1305, nonce per record, master key dari OS keychain bila tersedia, fallback file 0600 dengan passphrase. Rotasi kunci didukung.

**Alternatif.** Keytar (ditolak: proyek tidak aktif), env var saja (ditolak: bocor di proses dan log), plaintext config (ditolak: tidak aman).

**Konsekuensi.** Jika master key hilang, secret tidak bisa dipulihkan. Pengguna harus diberi peringatan saat setup dan opsi ekspor terenkripsi.

## ADR-020. Indeks simbol

**Keputusan.** Tree-sitter dengan grammar per bahasa populer, disimpan di tabel `symbols` dan diperbarui incremental saat file berubah.

**Alternatif.** Language Server Protocol (ditolak untuk V1: butuh server per bahasa dan konfigurasi pengguna), regex (ditolak: tidak akurat), ctags (ditolak: kurang terstruktur).

**Konsekuensi.** Bahasa tanpa grammar memakai fallback regex dan ditandai `approximate`. Indeks bisa dibangun ulang dengan `/index rebuild`.

## Dependency eksternal

| Dependensi | Wajib | Dampak jika tidak ada |
|---|---|---|
| API key provider | Ya untuk model nyata | Mock provider hanya untuk tes |
| Node.js 22 | Ya untuk npm | Binary SEA menghilangkan kebutuhan ini |
| Git | Ya untuk fitur Git | Fitur Git dinonaktifkan, sisanya jalan |
| bubblewrap | Tidak | Sandbox Linux turun ke mode `ask` |
| sqlite-vec | Tidak | Fallback FTS + cosine |
| Browser Chromium | Tidak | Tool browser dinonaktifkan |
| Docker | Tidak | Container sandbox dan deployment container tidak tersedia |
| Redis | Tidak | Antrean memakai SQLite |
| Object storage | Tidak | Backup lokal |

## Hal yang belum pasti

- Nama paket OS keychain yang dipakai di ketiga platform belum dipastikan; kandidat `@napi-rs/keyring`. Perlu uji coba sebelum M1.
- Dukungan Node SEA untuk modul native `better-sqlite3` perlu verifikasi pada Node 22.x terbaru. Jika gagal, binary memakai `node:sqlite` atau installer menyertakan Node.
- Kuota dan harga model berubah cepat; registry harga harus bisa diperbarui tanpa rilis aplikasi.
- Dukungan `sandbox-exec` di macOS versi terbaru perlu diuji; Apple dapat mengubah kebijakan.
