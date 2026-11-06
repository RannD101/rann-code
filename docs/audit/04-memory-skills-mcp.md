# Audit 04. Memory, instruction system, skills, MCP, plugin, dan hooks

- Lingkup: RC-FR-063 sampai RC-FR-100 (38 FR)
- Sumber kebenaran: `docs/prd/01-requirements.md` §8.5-8.7, `docs/prd/04-memory-skills-tools.md` §16-22, `docs/prd/ARCHITECTURE.md` §10.5 dan §11.1, `docs/prd/IMPLEMENTATION-ROADMAP.md` M7-M9, `docs/prd/ACCEPTANCE-CRITERIA.md` RC-AC-063 sampai RC-AC-100
- Basis kode: commit `82270f1`, versi paket 0.1.1
- Tanggal audit: 7 November 2026
- Metode: baca kode sumber, grep simbol dan kolom skema, jalankan seluruh tes
- Hasil tes: 52 dari 52 tes lulus (`npx vitest run`) pada Node 22.23.3. Pada Node 26.7.0 suite gagal karena ABI `better-sqlite3` (NODE_MODULE_VERSION 127 vs 147), jadi CI dan dokumentasi harus mematok Node 22.

## 1. Ringkasan

| Kelompok | FR | Done | Partial | Missing |
|---|---|---|---|---|
| 8.5 Memory dan instruction (063-076) | 14 | 0 | 8 | 6 |
| 8.6 Skills dan tools (077-090) | 14 | 0 | 7 | 7 |
| 8.7 MCP, plugin, hooks (091-100) | 10 | 0 | 4 | 6 |
| Total | 38 | 0 | 19 | 19 |

Tidak ada satu FR pun yang memenuhi seluruh requirement. Yang ada adalah versi minimal yang bekerja untuk kasus tunggal: tabel `memories` dengan dua scope, pencarian FTS5, skill Markdown di dua folder, delapan tool, dan MCP stdio tanpa autentikasi. Seluruh subsistem plugin dan hooks belum ada kodenya sama sekali.

## 2. Temuan lintas potong

1. Audit log tidak terpasang. `appendAudit` didefinisikan di `packages/storage/src/repos.ts:546` tetapi tidak dipanggil satu kali pun di seluruh repo. Ini memblokir RC-FR-074, RC-FR-085, RC-FR-094, RC-FR-099, dan RC-FR-100 yang semuanya mewajibkan jejak audit.
2. Config `hooks` dan `plugins` dibuang diam-diam. `configSchema` memakai `z.object` tanpa `.strict()` (`packages/shared/src/config.ts:26-116`), sehingga `[hooks]` atau `[plugins]` di `config.toml` lolos validasi lalu hilang. Pengguna akan mengira hook aktif padahal tidak ada yang berjalan.
3. Tidak ada tipe event untuk memory, skill, dan hook. `EventType` hanya berisi 13 event session/turn/tool (`packages/shared/src/events.ts:1-14`). Hook `MemoryWrite`, `SkillLoad`, `ContextCompact`, `Stop`, dan `PreCompact` tidak bisa dipancarkan tanpa mengubah kontrak event.
4. Profil tidak ditegakkan di data. `ensureDefaultProfile` selalu memakai nama `default` (`repos.ts:72-79`) dan `sessions.profile_id` tidak pernah diisi dari `config.profile`. Isolasi memory antar profil saat ini hanya kebetulan karena setiap profil punya berkas DB sendiri (`packages/runtime/src/paths.ts:34-42`), bukan karena kolom `profile_id`.
5. Kontrak tool terlalu tipis. `ToolSpec` hanya `name`, `description`, `parameters` (`packages/runtime/src/providers/types.ts:17-21`). Tidak ada `outputSchema`, `permission`, `timeoutMs`, `idempotent`, `maxOutputBytes` seperti di `04-memory-skills-tools.md:443-455`, sehingga RC-FR-086, 088, dan 089 tidak bisa ditutup tanpa mengubah interface ini lebih dulu.
6. Semua perintah slash untuk domain ini belum ada. REPL hanya mengenal `/new`, `/status`, `/model`, `/permission`, `/tools`, `/usage`, `/sessions`, `/exit` (`packages/cli/src/main.ts:515-531`). Tidak ada `/memory`, `/remember`, `/recall`, `/forget`, `/context`, `/skills`, `/skill`, `/create-skill`, `/install-skill`, `/mcp`, `/plugins`, `/hooks`. Yang tersedia hanya subcommand CLI `rann memory` dan `rann skill`.

## 3. 8.5 Memory dan instruction system (RC-FR-063 sampai RC-FR-076)

### RC-FR-063. User memory
Status: **partial**

- Bukti: tabel `memories` dengan `scope IN ('global','project')` (`packages/storage/src/db.ts:186-198`), `addMemory` dengan dedup teks persis dan merge tag (`packages/storage/src/repos.ts:390-413`), `MemoryService.add` dengan batas 3 sampai 4.000 karakter (`packages/runtime/src/memory.ts:42-61`), RPC `memory.add|list|search|update|remove` (`packages/runtime/src/rpc.ts:210-239`), CLI `rann memory` (`packages/cli/src/main.ts:805-868`).
- Kekurangan: tidak ada scope `user`; preferensi user hanya menumpang di `global`. Tidak ada `profile_id` di tabel sehingga syarat "tidak lintas profil" tidak ditegakkan oleh data. `source` hanya string bebas dengan default `"agent"` (`memory.ts:59`), bukan `source_message_id`. Tidak ada penandaan `superseded` saat preferensi bertentangan; `addMemory` justru menggabungkan tag pada teks yang sama dan membiarkan teks berbeda hidup berdampingan. Tidak ada `/memory` dan `/remember` di REPL.
- Tes belum ada: isolasi antar profil, penandaan `superseded` saat dua preferensi bertentangan, penghapusan lewat CLI benar-benar menghilangkan entri dari prompt turn berikutnya.

### RC-FR-064. Project memory
Status: **partial**

- Bukti: filter `scope = 'project' AND project_path = ?` (`repos.ts:372-379`), `MemoryService` menyimpan `projectPath` (`memory.ts:37-40`, `53-60`), tes isolasi project A vs B (`packages/runtime/src/memory-skills.test.ts:30-53`).
- Kekurangan: tidak ada `memory_versions`, alasan perubahan, atau versi baru. `updateMemory` menimpa baris yang sama (`repos.ts:461-472`). Tidak ada export ke `RANN.md`; `rann init` hanya menulis template kosong (`packages/cli/src/main.ts:992-1002`). Larangan "tidak menyimpan isi file penuh" hanya dijaga batas 4.000 karakter, tanpa deteksi konten file. Tidak ada `title` dan `confidence` sehingga entri panjang sulit dipindai.
- Tes belum ada: update keputusan menyimpan versi lama beserta alasan, export memory ke `RANN.md`, penolakan entri yang menyalin isi file utuh.

### RC-FR-065. Session memory
Status: **missing**

- Bukti: tidak ada. Scope `session` tidak ada di CHECK constraint (`db.ts:188`). Ringkasan compaction hanya hidup di dalam array pesan untuk satu request (`packages/runtime/src/agent.ts:213-224`) dan tidak pernah ditulis ke DB.
- Kekurangan: ringkasan sesi tidak persisten, tidak ada promosi ringkasan menjadi memory, tidak ada penghapusan memory saat sesi dihapus, tidak ada update ringkasan saat compaction, tidak ada pemisahan per sesi karena fiturnya tidak ada.
- Tes belum ada: sesi panjang berakhir lalu ringkasan tersimpan, hapus sesi menghapus memory sesi, dua sesi paralel tidak saling membaca ringkasan.

### RC-FR-066. Agent memory
Status: **missing**

- Bukti: tidak ada kolom `agent_profile` di `memories`. Subagent memakai `MemoryService` dengan `projectPath` yang sama dengan induk (`packages/runtime/src/rpc.ts:474-480`), jadi kalau scope agent ditambahkan tanpa filter profil, memory akan bocor ke induk.
- Kekurangan: tidak ada pengikatan ke profil agen, tidak ada filter relevansi peran, tidak ada kontrol baca lintas agen, tidak ada metrik efektivitas, tidak ada tombol mati per profil agen. `config.memory.enabled` hanya global (`packages/shared/src/config.ts:43-49`).
- Tes belum ada: memory agen A tidak terbaca agen B, toggle per profil agen, pencatatan efektivitas dan penghapusan memory yang tidak terpakai.

### RC-FR-067. Knowledge memory
Status: **missing**

- Bukti: tidak ada pembacaan `.rann/knowledge`, tidak ada chunking, heading, rentang baris, sitasi, atau reindex. `fs_read` dan `fs_list` bisa membaca berkas (`packages/runtime/src/tools/index.ts:121-193`) tetapi itu akses file, bukan indeks pengetahuan.
- Kekurangan: seluruh pipeline indexing dokumen tidak ada, termasuk pengecualian dokumen rahasia lewat config.
- Tes belum ada: chunk menyimpan path, heading, dan rentang baris; retrieval mengembalikan sitasi `path#heading`; reindex saat file berubah; dokumen yang dikecualikan tidak muncul.

### RC-FR-068. Procedural memory
Status: **missing**

- Bukti: `kind` adalah string bebas sehingga `"procedure"` bisa ditulis (`tools/index.ts:353`), tetapi tidak ada struktur data prosedur.
- Kekurangan: tidak ada nama, trigger, prasyarat, langkah, verifikasi; tidak ada ambang keberhasilan tiga kali; tidak ada promosi ke skill; tidak ada status `stale` untuk prosedur yang gagal berulang; tidak ada aturan bahwa prosedur tidak menggantikan instruksi eksplisit.
- Tes belum ada: promosi setelah tiga keberhasilan, prosedur gagal berulang menjadi `stale`, konversi prosedur menjadi skill.

### RC-FR-069. Ekstraksi otomatis dan review kandidat
Status: **missing**

- Bukti: tidak ada ekstraktor. `runTurn` selesai tanpa memanggil apa pun setelah `finalize` (`agent.ts:375-388`). Penulisan memory hanya terjadi kalau model memanggil tool `memory` (`tools/index.ts:360-388`).
- Kekurangan: tidak ada kandidat dengan jenis, isi, sumber, dan keyakinan; tidak ada ambang keyakinan; tidak ada antrean review; tidak ada filter secret, data pribadi, dan instruksi sementara; tidak ada tombol mati per profil atau per project selain `memory.enabled`.
- Tes belum ada: kandidat keyakinan rendah masuk antrean dan tidak diinjeksi, kandidat berisi token ditolak, ekstraksi mati per project, persetujuan dan penolakan kandidat.

### RC-FR-070. Retrieval dan pencarian semantik
Status: **partial**

- Bukti: `searchMemories` memakai FTS5 `MATCH` dengan `ORDER BY rank` dan fallback `LIKE` (`repos.ts:440-459`), filter scope dan project (`repos.ts:372-379`), prompt dibatasi `promptChars` (`memory.ts:83-101`), jumlah hasil default 8 (`config.ts:47`).
- Kekurangan: tidak ada jalur vektor, tidak ada Reciprocal Rank Fusion, tidak ada skor numerik dan ambang 0,25. Budget memakai karakter, bukan token, dan hasil pencarian selalu dicampur delapan entri terbaru (`memory.ts:86-89`) sehingga memory tidak relevan tetap masuk prompt. Tidak ada `/recall --explain`. Filter status, terhapus, dan kedaluwarsa tidak mungkin karena kolomnya tidak ada.
- Tes belum ada: 10.000 entri dengan query relevan di bawah 80 ms p95, ambang relevansi menahan injeksi, explain menampilkan skor per jalur dan pemenang RRF.

### RC-FR-071. Indeks dan prioritas memory
Status: **partial**

- Bukti: indeks FTS5 `memories_fts` dengan trigger sinkron (`db.ts:200-216`), urutan `updated_at DESC` (`memory.ts:89`, `repos.ts:425`).
- Kekurangan: tidak ada `importance`, `last_used_at`, `use_count`, embedding, status embedding, job embedding asinkron, atau `/memory reindex`. Pemakaian memory tidak pernah menaikkan peringkat karena retrieval tidak mencatat pemakaian.
- Tes belum ada: entri yang sering dipakai naik peringkat, embedding gagal berstatus `pending` lalu retry, reindex penuh mempertahankan data.

### RC-FR-072. Konsolidasi dan deduplikasi
Status: **partial**

- Bukti: dedup teks identik per `scope` dan `project_path` dengan merge tag (`repos.ts:394-406`).
- Kekurangan: tidak ada hash konten ternormalisasi, tidak ada kemiripan vektor 0,92, tidak ada penyimpanan versi lama, tidak ada `contradicted_by`, tidak ada job konsolidasi berkala atau manual, tidak ada `/memory stats`. `updateMemory` menimpa tanpa jejak.
- Tes belum ada: dua entri mirip digabung dan versi lama tetap ada, kontradiksi eksplisit menandai entri lama, laporan konsolidasi di stats.

### RC-FR-073. Expiry dan staleness
Status: **missing**

- Bukti: tidak ada kolom `expires_at`, `status`, atau `last_used_at` di `memories` (`db.ts:186-196`). Retrieval tidak memfilter waktu (`repos.ts:372-379`).
- Kekurangan: TTL per jenis, transisi ke `stale`, perpanjangan TTL saat dirujuk, kebijakan retensi, dan job harian semuanya tidak ada.
- Tes belum ada: entri lewat TTL tidak muncul di retrieval tetapi masih bisa dilihat, TTL diperpanjang saat dipakai, hard delete hanya lewat perintah eksplisit.

### RC-FR-074. Koreksi, update, dan hapus
Status: **partial**

- Bukti: `updateMemory` (`repos.ts:461-472`), `removeMemory` (`repos.ts:474-477`), sinkronisasi FTS lewat trigger `memories_au` dan `memories_ad` (`db.ts:210-216`), RPC `memory.update` dan `memory.remove` (`rpc.ts:227-239`).
- Kekurangan: update tidak membuat versi baru dan tidak menyimpan alasan. Hapus selalu hard delete, tanpa soft delete, konfirmasi, atau retensi 30 hari. Tidak ada audit aktor dan waktu karena `appendAudit` tidak pernah dipanggil. Tidak ada transaksi eksplisit yang mencakup vektor karena vektor tidak ada.
- Tes belum ada: update menghasilkan versi baru dan alasan, soft delete masih terlihat di audit tetapi tidak di retrieval, hard delete butuh konfirmasi, baris audit berisi aktor.

### RC-FR-075. Import, export, dan inspeksi
Status: **partial**

- Bukti: daftar dan filter lewat `memory.list` dengan `scope` dan `limit` (`rpc.ts:210-214`), pencarian lewat `memory.search`, tampilan CLI `rann memory list|search` (`main.ts:827-867`).
- Kekurangan: tidak ada export JSONL, versi skema, import, deteksi konflik, strategi `skip|overwrite|merge`, atau redaksi secret. Tidak ada `/memory show` yang menampilkan sumber dan versi. `removeMemory` menerima teks sebagai kunci (`repos.ts:474`), yang berbahaya untuk operasi massal.
- Tes belum ada: round-trip export lalu import, konflik id dengan tiga strategi, file export tidak memuat secret.

### RC-FR-076. Instruction system
Status: **partial**

- Bukti: `loadInstructions` membaca `RANN.md`, `AGENTS.md`, `CLAUDE.md` plus `RANN.md` global opsional, dengan batas 32.000 karakter per file dan 64.000 total serta label sumber (`packages/runtime/src/instructions.ts:4-47`). Hasilnya dipasang ke system prompt (`agent.ts:106`, `275`). `rann init` membuat `RANN.md` (`main.ts:992-1002`).
- Kekurangan: `loadInstructions(workspaceRoot)` dipanggil tanpa `globalConfigDir` (`agent.ts:275`), sehingga `~/.rann/RANN.md` tidak pernah ikut walau fungsinya mendukung. `SOUL.md`, `USER.md`, `MEMORY.md`, dan `.rann/rules/*.md` tidak didukung. Tidak ada aturan per path, inheritance subdirektori, prioritas eksplisit, pencatatan konflik, atau `instruction_conflict`. Tidak ada `/context`. Batas memakai karakter, bukan 8.000 token.
- Tes belum ada: konflik `RANN.md` vs `AGENTS.md` beserta pemenang, rules yang hanya dimuat saat path cocok, instruksi global ikut terbaca, `/context` menampilkan sumber dan jumlah token.

## 4. 8.6 Skills dan tools (RC-FR-077 sampai RC-FR-090)

### RC-FR-077. Discovery dan metadata skill
Status: **partial**

- Bukti: `SkillStore.all` memindai builtin, global (`<profileDir>/skills`), dan project (`.rann/skills`) (`packages/runtime/src/skills.ts:134-142`), parser frontmatter `name`, `description`, `version` (`skills.ts:67-82`), daftar tanpa body (`skills.ts:144-148`), katalog untuk prompt (`skills.ts:150-158`), CLI `rann skill list` (`main.ts:879-903`).
- Kekurangan: `SkillInfo` hanya punya enam field (`skills.ts:7-14`), tanpa trigger, dependensi, `allowed-tools`, lisensi, atau status aktif. Parser membuang semua kunci frontmatter lain (`skills.ts:79`). Bentrok nama ditelan diam-diam karena `Map.set` menimpa builtin lalu global lalu project (`skills.ts:134-141`), padahal requirement minta bentrok dilaporkan. Tidak ada registry terpasang dan tidak ada `/skills`.
- Tes belum ada: 20 skill tampil tanpa memuat body, bentrok global vs project dilaporkan, trigger muncul di daftar.

### RC-FR-078. Progressive loading
Status: **partial**

- Bukti: dua tahap nyata, katalog metadata di system prompt (`skills.ts:150-158`) dan body penuh hanya saat `skill view` (`tools/index.ts:414-419`).
- Kekurangan: tahap ketiga (referensi dan skrip) tidak ada karena tidak ada pembacaan folder `references/` atau `scripts/`. Tidak ada pencatatan token per tahap, budget, mekanisme lewati dengan catatan, atau penanda bagian wajib. `skills.catalog_limit` di config tidak dipakai: `catalog()` selalu memakai default 40 (`skills.ts:144`).
- Tes belum ada: hanya `SKILL.md` yang dimuat saat aktivasi, referensi dimuat saat dirujuk, token per tahap tercatat, referensi dilewati saat budget habis.

### RC-FR-079. Aktivasi dan pemilihan skill
Status: **missing**

- Bukti: tidak ada fungsi seleksi atau aktivasi di `skills.ts`. Agent hanya menerima katalog lalu memutuskan sendiri (`agent.ts:277`).
- Kekurangan: tidak ada pencocokan trigger, skor kecocokan tugas, riwayat keberhasilan, alasan pemilihan, batas tiga skill aktif, mekanisme lepas, atau perintah paksa dan larang.
- Tes belum ada: prompt relevan memilih skill beserta alasan, maksimal tiga skill per turn, skill tidak relevan tidak mengubah prompt, `/skill` memaksa dan melarang.

### RC-FR-080. Eksekusi skill
Status: **missing**

- Bukti: skill hanya Markdown. Tidak ada eksekusi skrip, `allowed-tools`, sandbox, broker tool, atau `skill.run`. Method `skill.run` ada di daftar PRD (`ARCHITECTURE.md` §11.1) tetapi tidak ada di `packages/shared/src/rpc.ts:162-170` maupun di handler RPC.
- Kekurangan: cwd, env terbatas, timeout, pemotongan output, artefak, error terstruktur, dan larangan menaikkan izin semuanya belum ada.
- Tes belum ada: skrip skill berjalan dengan env terbatas, timeout membunuh process group, skill tidak bisa menaikkan permission, output dan error tercatat di trace.

### RC-FR-081. Pembuatan dan validasi skill
Status: **partial**

- Bukti: `SkillStore.create` memvalidasi nama 2-64 karakter, deskripsi minimal 12 karakter, body 20 sampai 60.000 karakter, menolak menimpa builtin, butuh `overwrite` eksplisit, menulis `SKILL.md` mode 0600 (`skills.ts:165-203`). Tool `skill action=create` berisiko `write` sehingga kena approval di mode `ask` (`tools/index.ts:420-425`, `packages/runtime/src/policy.ts:60-62`).
- Kekurangan: tidak ada trigger wajib, dependensi, contoh, validasi file referensi, dry-run, status nonaktif sampai diuji, atau `/create-skill`. Persetujuan yang ada adalah approval tool generik, bukan alur review skill.
- Tes belum ada: deskripsi tanpa trigger ditolak, dry-run tidak menulis apa pun, skill baru tidak aktif sebelum disetujui, file referensi yang hilang ditolak.

### RC-FR-082. Edit dan versioning skill
Status: **missing**

- Bukti: `version` selalu ditulis `"1"` saat create (`skills.ts:195`) dan overwrite menimpa isi lama (`skills.ts:187-201`). Tidak ada riwayat.
- Kekurangan: tidak ada semver, snapshot versi lama, rollback, changelog, pencatatan alasan dan aktor, atau penundaan perubahan saat skill sedang dipakai.
- Tes belum ada: dua edit menghasilkan versi 1.0.1, versi lama bisa dipulihkan, skill yang sedang dipakai tidak berubah di tengah turn.

### RC-FR-083. Dependensi skill
Status: **missing**

- Bukti: frontmatter `requires` tidak diparse (`skills.ts:79` hanya menyimpan name, description, version).
- Kekurangan: tidak ada deklarasi dependensi, urutan muat, gagal aktivasi dengan pesan jelas, deteksi siklus, atau pembatasan versi.
- Tes belum ada: dependensi hilang menggagalkan aktivasi, siklus ditolak, versi dependensi di luar rentang ditolak.

### RC-FR-084. Registry dan instalasi skill
Status: **missing**

- Bukti: tidak ada. Skill hanya bisa dibuat manual lewat `skill create`.
- Kekurangan: tidak ada sumber lokal, HTTPS tarball, Git, checksum, signature, tampilan manifest dan permission, persetujuan sumber tidak tepercaya, atau pencatatan sumber dan versi.
- Tes belum ada: instalasi tarball dengan checksum salah ditolak, sumber tidak tepercaya butuh persetujuan eksplisit, sumber dan versi tercatat untuk update.

### RC-FR-085. Hapus dan update skill
Status: **partial**

- Bukti: `SkillStore.remove` menghapus direktori dan menolak builtin (`skills.ts:205-215`), CLI `rann skill remove` (`main.ts:938-951`).
- Kekurangan: tidak ada audit setelah hapus, tidak ada update, perbandingan versi, changelog, penanganan konflik, penundaan sampai turn selesai, atau rollback.
- Tes belum ada: hapus meninggalkan baris audit, update menolak menimpa versi lokal yang lebih baru, rollback memulihkan versi sebelumnya.

### RC-FR-086. Registry tool bawaan
Status: **partial**

- Bukti: array `tools` dengan `spec` (name, description, parameters JSON Schema) dan `risk` (`tools/index.ts:36-40`, `119-454`), `toolSpecs`, `findTool`, `executeTool` (`tools/index.ts:456-482`), `/tools` menampilkan daftar hardcoded (`main.ts:528-531`).
- Kekurangan: hanya delapan tool dan dua kategori nyata (filesystem, terminal) dari 15 kategori di PRD. Tidak ada tool Git, web search, HTTP, browser, eksekusi kode, database, package, testing, gambar, dokumen, sistem, scheduling, dan messaging. Tidak ada `outputSchema`, permission, atau timeout default sebagai metadata. Tool yang tidak tersedia di platform tidak ditandai. `/tools` tidak menampilkan kategori, status, atau izin. Tool tidak bisa dimatikan per project.
- Tes belum ada: satu tes end-to-end per kategori, `/tools` menampilkan status dan izin, tool yang dimatikan per project tidak muncul di prompt.

### RC-FR-087. Tool kustom dan eksternal
Status: **missing**

- Bukti: tidak ada loader `.rann/tools/*.ts`, tidak ada `defineTool`, tidak ada eksekusi tool eksternal dengan JSON masuk dan keluar. `grep plugin` dan `grep defineTool` tidak menemukan apa pun di `packages/*/src`.
- Kekurangan: tidak ada deklarasi permission dan timeout, penolakan skema tidak valid saat registrasi, atau `/tool test`.
- Tes belum ada: tool kustom dimuat dan tampil di `/tools`, skema invalid ditolak saat registrasi, `/tool test` menjalankan contoh argumen.

### RC-FR-088. Validasi skema dan chaining
Status: **partial**

- Bukti: setiap tool memvalidasi input dengan Zod dan menyebut `path.field` pada pesan error (`tools/index.ts:111-117`, skema di `53-109`).
- Kekurangan: output tidak divalidasi dan tidak punya skema. Tidak ada chaining, validasi kompatibilitas antar tool, penilaian permission per langkah, atau penyimpanan output antara sebagai artefak.
- Tes belum ada: output invalid ditolak, chaining A ke B hanya jika skema cocok, chaining tetap kena permission di setiap langkah.

### RC-FR-089. Permission, timeout, retry, dan log tool
Status: **partial**

- Bukti: risk `read|write|exec` dengan `assertAllowed` (`policy.ts:49-77`), timeout shell dan pembunuhan process group (`tools/index.ts:309-326`), pemotongan output 100.000 karakter (`tools/index.ts:42-43`, `290-297`), pencatatan tool call dengan args, status, exit code, dan durasi (`repos.ts:254-276`, `agent.ts:392-415`), tool MCP dipaksa risk `exec` (`tools/index.ts:465-477`).
- Kekurangan: tidak ada retry dan matriks idempoten. Tidak ada trace id atau span. Args disimpan apa adanya tanpa sanitasi (`repos.ts:259`). Output besar hanya dipotong, tidak disimpan sebagai artefak. Timeout default hanya ada untuk shell dan MCP; memory dan skill tidak punya timeout.
- Tes belum ada: retry hanya untuk tool idempoten, args sensitif tersunting di `tool_calls`, output 1 MB menghasilkan artefak dan prompt tetap kecil, timeout membunuh anak proses shell.

### RC-FR-090. Cakupan kategori tool
Status: **missing**

- Bukti: hanya `fs_read`, `fs_list`, `fs_write`, `fs_edit`, `shell_run` yang diuji (`packages/runtime/src/tools.test.ts:22-96`). Tidak ada tool database, dokumen, gambar, atau messaging.
- Kekurangan: seluruh janji kategori di RC-FR-086 belum terpenuhi, termasuk query read-only yang menolak write, ekstraksi PDF/DOCX/XLSX, resize/crop/OCR, dan adapter messaging yang sama dengan gateway.
- Tes belum ada: `db_query` menolak write tanpa izin, `pdf_extract`/`docx_read`/`xlsx_read`, `image_resize`/`image_crop`/`image_ocr`, `send_message` lewat adapter gateway.

## 5. 8.7 MCP, plugin, dan hooks (RC-FR-091 sampai RC-FR-100)

### RC-FR-091. Konfigurasi dan transport MCP
Status: **partial**

- Bukti: skema `mcp.servers` dengan `command`, `args`, `env`, `cwd`, `enabled`, `timeout_ms` (`packages/shared/src/config.ts:78-94`), `McpManager` menjalankan server stdio (`packages/runtime/src/mcp.ts:132-168`), kegagalan muat tidak menjatuhkan turn karena `listTools` dibungkus try/catch (`agent.ts:299-306`), konfigurasi global dan project menyatu lewat merge `config.toml` (`config.ts:197-211`).
- Kekurangan: tidak ada field `transport`, `url`, `headers`, atau `permissions`. Hanya stdio; Streamable HTTP dan SSE tidak ada. Tidak ada `/mcp add|remove|list|reload` dan tidak ada method RPC `mcp.list` atau `mcp.reload`. Timeout default 20 detik, bukan 30 detik (`config.ts:89`). Validasi hanya terjadi saat load config, tidak ada jalur tambah server dengan validasi khusus.
- Tes belum ada: transport HTTP dan SSE, `/mcp reload`, config server invalid ditolak dengan path field, server global dan project dengan nama sama.

### RC-FR-092. Discovery tool, resource, dan prompt
Status: **partial**

- Bukti: `tools/list` dipanggil saat connect (`mcp.ts:100`), namespace `mcp__<server>__<tool>` (`mcp.ts:97`, `106`), `inputSchema` dipakai sebagai parameter tool (`mcp.ts:111-114`), diuji di `mcp.test.ts:57-70`.
- Kekurangan: `resources/list` dan `prompts/list` tidak pernah dipanggil dan tidak ada penyimpanan resource atau prompt. Notifikasi perubahan daftar diabaikan karena pesan tanpa `id` langsung `return` (`mcp.ts:189-190`). Skema tool tidak divalidasi: selain objek langsung diganti `{type:"object",properties:{}}`. Tidak ada cache berbasis hash konfigurasi atau refresh.
- Tes belum ada: resource dan prompt muncul dan bisa dibaca, notifikasi `list_changed` memicu refresh, tool dengan skema invalid tidak didaftarkan.

### RC-FR-093. Autentikasi dan lifecycle MCP
Status: **partial**

- Bukti: timeout per server dipakai pada setiap request dan diuji (`mcp.ts:216-226`, `mcp.test.ts:84-104`).
- Kekurangan: tidak ada OAuth 2.1 dengan PKCE, secret store, header auth kustom, atau redaksi header di log. Tidak ada restart dengan backoff maksimal tiga kali; saat proses keluar state hanya dihapus (`mcp.ts:160-164`) dan server baru dinyalakan lagi secara kebetulan saat `listTools` berikutnya. Tidak ada status `connecting`, `ready`, `degraded`, `failed`, `disabled`.
- Tes belum ada: server crash lalu reconnect dengan backoff, transisi status, token tidak pernah muncul di log, request timeout memakai nilai konfigurasi server.

### RC-FR-094. Permission dan isolasi MCP
Status: **partial**

- Bukti: tool MCP dipaksa risk `exec` sehingga mode `read-only` menolak dan mode `ask` meminta approval (`tools/index.ts:465-477`). Server berjalan di proses terpisah (`mcp.ts:135-140`). `close` mematikan server tanpa menghentikan sesi (`mcp.ts:263-271`).
- Kekurangan: env server mewarisi seluruh `process.env` lalu ditimpa `config.env` (`mcp.ts:137`), sehingga token host ikut masuk. Tidak ada permission per server atau per tool di config. Output server masuk ke prompt sebagai teks biasa tanpa penanda konten tidak tepercaya. Mode `trusted` otomatis mengizinkan semua tool MCP. Tidak ada sandbox atau container.
- Tes belum ada: env server tidak memuat variabel sensitif, tool MCP di luar allowlist ditolak, output MCP ditandai tidak tepercaya, server bisa dimatikan tanpa memutus sesi.

### RC-FR-095. Instalasi dan registrasi plugin
Status: **missing**

- Bukti: tidak ada kode plugin di `packages/*/src` (grep `plugin` kosong). Tidak ada kunci `plugins` di `configSchema`; karena `z.object` membuang kunci tak dikenal, `[plugins]` di `config.toml` diabaikan tanpa peringatan.
- Kekurangan: manifest, API version, permission, entry point, instalasi folder atau tarball HTTPS dengan checksum, status nonaktif sampai diaktifkan, penolakan nama bentrok, dan `/plugins` semuanya tidak ada.
- Tes belum ada: manifest valid dan invalid, nama bentrok ditolak, plugin terdaftar tetapi nonaktif, `/plugins` menampilkan status, versi, dan permission.

### RC-FR-096. Lifecycle dan dependensi plugin
Status: **missing**

- Bukti: tidak ada.
- Kekurangan: tidak ada status `installed|enabled|disabled|error`, pemuatan dependensi berurutan, isolasi crash, disable tanpa menghapus data, atau pemeriksaan kompatibilitas API saat update.
- Tes belum ada: plugin crash tidak menjatuhkan daemon dan ditandai `error`, dependensi hilang menggagalkan aktivasi, disable lalu enable mempertahankan data.

### RC-FR-097. API dan permission plugin
Status: **missing**

- Bukti: tidak ada.
- Kekurangan: tidak ada Plugin API untuk tool, command, hook, provider, dan messaging adapter; tidak ada permission manifest; tidak ada isolasi proses; tidak ada error terstruktur.
- Tes belum ada: plugin tanpa permission tidak bisa membaca secret, plugin tidak bisa mengakses storage internal, error plugin dikembalikan sebagai error terstruktur.

### RC-FR-098. Kompatibilitas dan update plugin
Status: **missing**

- Bukti: tidak ada.
- Kekurangan: tidak ada rentang versi API, penolakan dengan versi minimum, changelog update, konfirmasi saat permission berubah, rollback, atau penanda `stale` setelah 90 hari.
- Tes belum ada: plugin di luar rentang ditolak dengan pesan versi minimum, update yang menambah permission meminta konfirmasi, rollback bekerja.

### RC-FR-099. Event hooks
Status: **missing**

- Bukti: tidak ada modul hooks, tidak ada pemanggilan hook di `runTurn` maupun `executeTool`. `EventType` hanya berisi 13 event session/turn/tool (`packages/shared/src/events.ts:1-14`), tanpa `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `ToolError`, `PreTask`, `PostTask`, `AgentSpawn`, `AgentComplete`, `MemoryWrite`, `SkillLoad`, `ContextCompact`, `Stop`, `PreCompact`, dan `Notification`.
- Kekurangan: tidak ada payload JSON per event, keputusan `allow|deny|modify`, urutan prioritas, atau jaminan hook tidak bisa menaikkan permission dan mengubah goal.
- Tes belum ada: `PreToolUse` memblokir tool shell, urutan hook sesuai prioritas, hook tidak bisa menaikkan permission, `MemoryWrite` mencegah penulisan.

### RC-FR-100. Konfigurasi, validasi, timeout, dan error hook
Status: **missing**

- Bukti: tidak ada kunci `hooks` di `configSchema` (`packages/shared/src/config.ts:26-116`), sehingga konfigurasi hook dibuang diam-diam.
- Kekurangan: tidak ada tipe hook `command`, `HTTP`, `script`, atau `plugin`; tidak ada timeout default 10 detik dan pembunuhan proses; tidak ada `onError: block|warn|ignore`; tidak ada dry-run.
- Tes belum ada: hook melewati timeout dibunuh dan diperlakukan sesuai `onError`, `onError=block` menghentikan aksi, dry-run menampilkan payload tanpa efek samping, hook HTTP hanya menerima HTTPS kecuali localhost.

## 6. Matriks status

| FR | Status | Ringkasan |
|---|---|---|
| 063 | partial | Memory global/project dengan FTS, tanpa scope user dan tanpa supersede |
| 064 | partial | Memory project terisolasi path, tanpa versi dan export RANN.md |
| 065 | missing | Tidak ada session memory dan ringkasan persisten |
| 066 | missing | Tidak ada agent memory dan isolasi per profil agen |
| 067 | missing | Tidak ada indeks knowledge dan sitasi |
| 068 | missing | Tidak ada procedural memory terstruktur |
| 069 | missing | Tidak ada ekstraksi otomatis dan antrean kandidat |
| 070 | partial | FTS5 dan budget karakter, tanpa vektor, RRF, skor, ambang |
| 071 | partial | Indeks FTS, tanpa importance, last_used, embedding, reindex |
| 072 | partial | Dedup teks identik, tanpa hash, vektor, versi, kontradiksi |
| 073 | missing | Tidak ada TTL, stale, dan job pembersihan |
| 074 | partial | Update dan hard delete, tanpa versi, soft delete, audit |
| 075 | partial | Inspeksi list/search, tanpa export dan import JSONL |
| 076 | partial | RANN/AGENTS/CLAUDE terbaca, tanpa rules path, prioritas, konflik, /context |
| 077 | partial | Discovery tiga scope, tanpa trigger, dependensi, laporan bentrok |
| 078 | partial | Katalog lalu body, tanpa referensi, token, budget |
| 079 | missing | Tidak ada aktivasi berbasis trigger dan alasan |
| 080 | missing | Skill tidak mengeksekusi skrip atau tool |
| 081 | partial | Create dengan validasi dasar, tanpa trigger, dry-run, approval khusus |
| 082 | missing | Versi selalu 1, tanpa riwayat dan rollback |
| 083 | missing | Tidak ada dependensi dan deteksi siklus |
| 084 | missing | Tidak ada registry dan instalasi |
| 085 | partial | Remove saja, tanpa audit, update, rollback |
| 086 | partial | 8 tool, 2 dari 15 kategori, kontrak tool minim |
| 087 | missing | Tidak ada tool kustom dan eksternal |
| 088 | partial | Validasi input Zod, tanpa validasi output dan chaining |
| 089 | partial | Permission, timeout shell, log dasar, tanpa retry dan artefak |
| 090 | missing | Kategori database, dokumen, gambar, messaging tidak ada |
| 091 | partial | MCP stdio dan config dasar, tanpa HTTP/SSE dan perintah /mcp |
| 092 | partial | tools/list dan namespace, tanpa resource, prompt, notifikasi |
| 093 | partial | Timeout saja, tanpa OAuth, backoff, status |
| 094 | partial | Proses terpisah dan risk exec, env bocor, tanpa permission per server |
| 095 | missing | Tidak ada plugin |
| 096 | missing | Tidak ada lifecycle plugin |
| 097 | missing | Tidak ada Plugin API dan permission |
| 098 | missing | Tidak ada kompatibilitas dan update plugin |
| 099 | missing | Tidak ada hook engine dan 16 event |
| 100 | missing | Tidak ada config, timeout, onError, dry-run hook |

## 7. Prioritas

### P0. Blocker V1

1. Skema memory v3 (FR 063-075). Tambah enam ruang lewat `scope` atau tabel ruang, `profile_id`, `title`, `confidence`, `importance`, `status`, `expires_at`, `last_used_at`, `use_count`, `hash`, `source_type`, `source_ref`, dan tabel `memory_versions`. Tanpa ini, sepuluh FR memory tidak bisa ditutup. File: `packages/storage/src/db.ts`, `packages/storage/src/repos.ts`.
2. Retrieval hybrid dan skor (FR 070, 071, 072). Tambah tabel vektor, jalur FTS plus vektor plus RRF k=60, bobot scope/importance/recency/confidence, ambang 0,25, budget token 2.500, dan `--explain`. File: `packages/runtime/src/memory.ts`, `packages/storage/src/repos.ts`, `packages/shared/src/config.ts`.
3. Pipeline ekstraksi dan review kandidat (FR 069). Ekstraktor pasca-turn, skor keyakinan, filter secret, antrean persetujuan, dan tombol mati per project. File baru `packages/runtime/src/memory-extract.ts`, lalu `agent.ts`, `rpc.ts`, `cli/src/main.ts`, `shared/rpc.ts`.
4. Instruction loader v2 (FR 076). Dukung `SOUL.md`, `USER.md`, `MEMORY.md`, `RANN.md`, `AGENTS.md`, `CLAUDE.md`, `.rann/rules/*.md`, prioritas eksplisit, konflik tercatat, dan `/context`. Oper `globalConfigDir` yang saat ini tidak pernah dikirim. File: `packages/runtime/src/instructions.ts`, `agent.ts`, `cli/src/main.ts`.
5. Kontrak tool lengkap dan registry kategori (FR 086, 088, 089, 090). Tambah `outputSchema`, `permission`, `timeoutMs`, `idempotent`, `maxOutputBytes` ke `ToolSpec`, lalu isi kategori Git, HTTP, web, database, dokumen, gambar, sistem. File: `packages/runtime/src/providers/types.ts`, `packages/runtime/src/tools/index.ts` dan folder tool baru, `policy.ts`.
6. Hardening eksekusi tool (FR 089, 088). Sanitasi args sebelum masuk `tool_calls`, retry hanya untuk tool idempoten, trace id, dan artefak output di `artifactsDir`. File: `tools/index.ts`, `agent.ts`, `storage/src/repos.ts`.
7. Aktivasi, eksekusi, dan validasi skill (FR 077-081, 084). Parser frontmatter lengkap dengan trigger dan `requires`, seleksi maksimal tiga skill dengan alasan, runner skrip dengan env terbatas dan timeout, dry-run, serta instalasi dari path dan tarball. File: `packages/runtime/src/skills.ts` (pecah menjadi `skill-format.ts`, `skill-select.ts`, `skill-run.ts`), `tools/index.ts`, `cli/src/main.ts`.
8. MCP siap produksi (FR 091-094). Transport Streamable HTTP dan SSE, header auth dari secret store, status dan backoff, permission per server, env allowlist, dan `/mcp` dengan `mcp.list` serta `mcp.reload`. File: `packages/runtime/src/mcp.ts`, `shared/src/config.ts`, `rpc.ts`, `shared/src/rpc.ts`, `cli/src/main.ts`.
9. Hook engine 16 event (FR 099, 100). Modul baru dengan empat tipe hook, timeout 10 detik, `onError`, dry-run, dan penyisipan di `runTurn` serta `executeTool`. File baru `packages/runtime/src/hooks.ts`, lalu `shared/src/config.ts`, `shared/src/events.ts`, `agent.ts`, `tools/index.ts`.
10. Pasang audit log (FR 074, 085, 094, 099). Panggil `appendAudit` pada setiap mutasi memory, skill, MCP, dan hook. File: `repos.ts` atau service masing-masing.

### P1. Penting, bisa menyusul setelah P0 stabil

1. Session memory dan agent memory (FR 065, 066), termasuk promosi ringkasan dan filter per profil agen.
2. Indeks knowledge `.rann/knowledge` dengan chunk, heading, rentang baris, dan sitasi (FR 067).
3. Procedural memory dan promosi ke skill (FR 068).
4. TTL, staleness, dan job harian (FR 073).
5. Import dan export JSONL dengan tiga strategi konflik (FR 075).
6. Versioning, dependensi, dan update skill (FR 082, 083, 085).
7. Plugin manifest, loader, API, dan isolasi proses (FR 095-098).

### P2. Penyempurnaan

1. `/memory show`, `/memory stats`, dan redaksi secret pada tampilan dan export.
2. `catalog_limit` agar benar-benar dipakai, penanda skill aktif, dan status tool per project.
3. Penandaan tool yang tidak tersedia di platform dan laporan tool yang sering timeout.
4. Perbaikan pesan error validasi agar menyebut nilai yang diharapkan, bukan hanya path.
5. Pematokan Node 22 di CI dan dokumentasi instalasi karena `better-sqlite3` belum kompatibel dengan Node 26.

## 8. File yang perlu disentuh

| File | Alasan |
|---|---|
| `packages/storage/src/db.ts` | Migrasi 3: ruang memory, kolom status dan skor, `memory_versions`, tabel vektor, tabel kandidat |
| `packages/storage/src/repos.ts` | CRUD memory baru, FTS plus vektor, audit, soft delete, versi, kandidat, registry skill dan plugin |
| `packages/runtime/src/memory.ts` | Retrieval hybrid, skor, ambang, budget token, pencatatan pemakaian |
| `packages/runtime/src/memory-extract.ts` (baru) | Ekstraksi pasca-turn, filter secret, skor keyakinan, antrean review |
| `packages/runtime/src/instructions.ts` | Tujuh sumber instruksi, rules per path, prioritas, konflik, hitung token |
| `packages/runtime/src/skills.ts` | Frontmatter lengkap, seleksi, versioning, dependensi, registry, eksekusi |
| `packages/runtime/src/mcp.ts` | Transport HTTP dan SSE, auth, status, backoff, permission, env allowlist, resource dan prompt |
| `packages/runtime/src/hooks.ts` (baru) | Event bus 16 event, empat tipe hook, timeout, onError, dry-run |
| `packages/runtime/src/tools/index.ts` | Kontrak tool lengkap, kategori baru, retry, sanitasi args, artefak |
| `packages/runtime/src/agent.ts` | Sisip hook, ekstraksi pasca-turn, instruksi berlapis, pemakaian memory |
| `packages/runtime/src/rpc.ts` | Method `memory.*` lengkap, `skill.run`, `mcp.*`, `plugin.*`, `hook.*`, `context.show` |
| `packages/shared/src/config.ts` | Skema `hooks`, `plugins`, `mcp.transport`, TTL, embedding, retry, tool permission |
| `packages/shared/src/events.ts` | Event memory, skill, hook, plugin, dan event hook 16 buah |
| `packages/shared/src/rpc.ts` | Skema parameter untuk method baru |
| `packages/cli/src/main.ts` | Perintah `/memory`, `/remember`, `/recall`, `/forget`, `/context`, `/skills`, `/skill`, `/create-skill`, `/install-skill`, `/mcp`, `/plugins`, `/hooks`, `/tools` yang nyata |

## 9. Catatan penutup

Urutan yang paling masuk akal: skema memory dan audit lebih dulu, karena hampir semua FR lain menumpang di sana. Sesudah itu kontrak tool, karena skill, MCP, dan hook semuanya memanggil broker tool yang sama. Hook sebaiknya dikerjakan setelah event type diperluas, bukan sebaliknya; kalau hook dibuat lebih dulu, tim akan memaksa event masuk ke `log` dan kontraknya sulit dirapikan kemudian.
