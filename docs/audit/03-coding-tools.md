# Audit 03. Coding engine, file/patch, Git, browser, tools, sandbox

- Repo: `/root/rann-code`, commit `82270f1`
- Lingkup: RC-FR-040 sampai RC-FR-052, RC-FR-086 sampai RC-FR-090, RC-FR-115 sampai RC-FR-120 (24 FR)
- Sumber: `docs/prd/01-requirements.md` 8.3, 8.6, 8.9; `docs/prd/04-memory-skills-tools.md` 19; `docs/prd/ARCHITECTURE.md` 4, 7.2; `docs/prd/IMPLEMENTATION-ROADMAP.md` M5, M6; `docs/prd/ACCEPTANCE-CRITERIA.md`
- Metode: baca kode, grep simbol, jalankan tes yang tidak butuh SQLite native

## 1. Ringkasan status

| Status | Jumlah |
|---|---|
| done | 0 |
| partial | 6 |
| missing | 18 |

Tes yang dijalankan:

- `./node_modules/.bin/vitest run packages/runtime/src/tools.test.ts packages/runtime/src/policy.test.ts` lulus 16/16.
- Suite penuh: 4 file gagal, 15 tes gagal, semuanya karena `better-sqlite3` tidak bisa `self-register` di Node 26.7.0 (`Module did not self-register`). Ini masalah lingkungan, bukan regresi kode audit ini, tetapi membuat tes storage/daemon tidak bisa diverifikasi di mesin ini.

| ID | Ringkasan | Status |
|---|---|---|
| RC-FR-040 | Eksplorasi repository dan project map | missing |
| RC-FR-041 | Pencarian kode semantik | missing |
| RC-FR-042 | Operasi file dasar | partial |
| RC-FR-043 | Patch editing yang aman | partial |
| RC-FR-044 | Modifikasi multi-file dan transaksi | missing |
| RC-FR-045 | Code generation dan refactoring | missing |
| RC-FR-046 | Debugging dan diagnosis error | missing |
| RC-FR-047 | Generasi dan eksekusi tes | missing |
| RC-FR-048 | Code review | missing |
| RC-FR-049 | Analisis arsitektur dan dependensi | missing |
| RC-FR-050 | Build, lint, typecheck, dependency | missing |
| RC-FR-051 | Integrasi Git | missing |
| RC-FR-052 | Dokumentasi dan inisialisasi project | partial |
| RC-FR-086 | Registry tool bawaan | partial |
| RC-FR-087 | Tool kustom dan eksternal | missing |
| RC-FR-088 | Validasi skema dan chaining | partial |
| RC-FR-089 | Permission, timeout, retry, log tool | partial |
| RC-FR-090 | Cakupan kategori tool | missing |
| RC-FR-115 | Operasi Git dasar | missing |
| RC-FR-116 | Checkpoint dan rollback | missing |
| RC-FR-117 | Worktree dan konflik | missing |
| RC-FR-118 | Browser automation dasar | missing |
| RC-FR-119 | Isolasi sesi dan autentikasi browser | missing |
| RC-FR-120 | Perbedaan search, fetch, browser | missing |

Konteks angka: registry berisi 8 tool (`fs_read`, `fs_list`, `fs_write`, `fs_edit`, `shell_run`, `memory`, `skill`, `task`). Roadmap M6 meminta 16 kategori dan minimal 40 tool bawaan.

## 2. Detail per FR

### 8.3 Coding engine

#### RC-FR-040. Eksplorasi repository. missing
- Bukti: `packages/cli/src/main.ts:992` `initCommand()` hanya membuat `.rann/config.toml` dan `RANN.md` statis. `packages/runtime/src/instructions.ts:4` hanya memuat `RANN.md`/`AGENTS.md`/`CLAUDE.md`.
- Kekurangan: tidak ada pemindaian file, lockfile, konfigurasi build, atau README. Tidak ada deteksi bahasa dominan, package manager, entry point, perintah build/test/lint. `.rann/project-map.json` tidak pernah dibuat, tidak ada mode incremental, tidak ada pelaporan asumsi saat deteksi ambigu. `/init` sebagai slash command juga tidak ada; hanya `rann init`.
- Tes belum ada: pemindaian repo 5.000 file di bawah 30 detik (RC-AC-040), deteksi perintah dari lockfile, update incremental, kasus ambigu.

#### RC-FR-041. Pencarian kode semantik. missing
- Bukti: satu-satunya primitif baca adalah `fs_read` dan `fs_list` di `packages/runtime/src/tools/index.ts:120-194`. Tidak ada grep tool, indeks simbol, atau indeks vektor.
- Kekurangan: tidak ada penggabungan grep + tree-sitter + vektor, tidak ada path/baris/cuplikan/alasan relevansi, tidak ada pembatasan hasil dan skor, tidak ada `/index rebuild`, tidak ada penghormatan `.gitignore` (hanya skip keras `.git` dan `node_modules`).
- Tes belum ada: query semantik "fungsi yang menghitung pajak" menghasilkan minimal satu hasil relevan di 5 teratas (RC-AC-041), rebuild indeks, file yang di-ignore tidak muncul.

#### RC-FR-042. Operasi file dasar. partial
- Bukti: `tools/index.ts:120` `fs_read`, `:156` `fs_list`, `:195` `fs_write`, `:219` `fs_edit`. Validasi path di `policy.ts:84` `resolveInsideWorkspace`. Tes: `tools.test.ts:23` (baca/tulis/edit/list), `:44` (path keluar workspace), `:51` (read-only).
- Kekurangan: `delete_file`, `stat_file`, dan `glob` tidak ada. `resolveInsideWorkspace` hanya memakai `path.resolve`, tidak memanggil `realpath`, jadi symlink di dalam workspace yang menunjuk keluar tetap lolos. `fs_write` langsung menimpa tanpa membandingkan mtime/hash hasil baca sebelumnya, sehingga perubahan pengguna bisa hilang tanpa konfirmasi. Tidak ada trash internal, tidak ada mode `hard`. Tidak ada pencatatan audit hash sebelum/sesudah (`appendAudit` di `repos.ts:546` tidak pernah dipanggil dari mana pun). `fs_read` membaca biner sebagai UTF-8 tanpa penolakan. `fs_list` tidak mengabaikan `dist`, `build`, `.rann`, atau `coverage`.
- Tes belum ada: symlink keluar workspace, overwrite file yang berubah sejak dibaca, delete ke trash dan restore, hash audit, penolakan file biner.

#### RC-FR-043. Patch editing yang aman. partial
- Bukti: `tools/index.ts:219-250` `fs_edit` dengan `old`/`new`, gagal bila 0 kemunculan, gagal bila lebih dari 1 kecuali `all=true`.
- Kekurangan: tidak menerima unified diff. Tidak ada pembacaan ulang dan perbandingan hash setelah tulis. `all=true` melewati aturan "ditemukan lebih dari sekali berarti gagal" tanpa padanan di PRD. Diff tidak dihitung, tidak ditampilkan, dan tidak disimpan karena tabel `file_changes` tidak ada di `packages/storage/src/db.ts`. Tidak ada lease, sehingga `E_LEASE_CONFLICT` tidak mungkin dilempar. Error memakai `E_TOOL_FAILED`, bukan kode spesifik patch.
- Tes belum ada: edit 1 fungsi pada file 200 baris dengan diff minimal dan hash terverifikasi (RC-AC-043), old_string duplikat gagal tanpa mengubah file, konflik lease.

#### RC-FR-044. Modifikasi multi-file dan transaksi. missing
- Bukti: tidak ada tool transaksi di `tools/index.ts`. Tidak ada tabel `file_changes` atau `transactions`.
- Kekurangan: seluruh lima butir tidak terpenuhi. Tidak ada rollback, tidak ada pencatatan hash awal, tidak ada penolakan file yang berubah di luar transaksi, tidak ada ringkasan file/baris/status. Kegagalan di tengah rangkaian `fs_write` meninggalkan perubahan setengah jadi.
- Tes belum ada: 3 file, file kedua gagal, file pertama dan ketiga kembali ke isi awal (RC-AC-044).

#### RC-FR-045. Code generation dan refactoring. missing
- Bukti: tidak ada tool refactor, rename simbol, atau formatter. `shell_run` bisa menjalankan formatter, tetapi tidak ada orkestrasi.
- Kekurangan: tidak ada jaminan tes sebelum/sesudah, tidak ada rename lintas file, tidak ada bukti grep sebelum menghapus kode, tidak ada pemecahan patch besar, tidak ada integrasi Prettier/ESLint/gofmt/rustfmt sebagai langkah wajib.
- Tes belum ada: refactor fixture 20 file lulus tes (gate M5), rename simbol lintas file, penolakan hapus kode tanpa bukti.

#### RC-FR-046. Debugging dan diagnosis error. missing
- Bukti: tidak ada `/debug`, tidak ada harness reproduksi, tidak ada penyimpanan hipotesis.
- Kekurangan: kelima butir tidak terpenuhi. `shell_run` hanya menangkap stdout/stderr dan exit code; tidak ada pengumpulan stack trace terstruktur, tidak ada tes regresi wajib, tidak ada larangan `catch` kosong yang ditegakkan.
- Tes belum ada: reproduksi kegagalan lalu tes regresi gagal-sebelum/lulus-sesudah (RC-AC-046).

#### RC-FR-047. Generasi dan eksekusi tes. missing
- Bukti: hanya `shell_run` (`tools/index.ts:251`). Tidak ada `run_tests`, `test_run`, atau parser hasil.
- Kekurangan: tidak ada deteksi framework, tidak ada ringkasan lulus/gagal/skip, tidak ada output asli terstruktur, tidak ada penandaan flaky dan retry maksimal dua kali, tidak ada penjagaan agar tes tidak dihapus atau dilemahkan.
- Tes belum ada: modul tanpa tes lalu tes dibuat dan dijalankan dengan hasil terstruktur (RC-AC-047), deteksi flaky.

#### RC-FR-048. Code review. missing
- Bukti: `/review` tidak ada di daftar slash command (`main.ts:510-582`). README menyebut review hanya lewat prompt bebas (`README.md:179`), bukan fitur.
- Kekurangan: tidak ada analisis diff terstruktur, tidak ada model temuan dengan path/baris/severity/penjelasan/saran, tidak ada filter temuan tanpa lokasi, tidak ada pemisahan temuan pasti dan dugaan.
- Tes belum ada: diff 200 baris menghasilkan temuan berlokasi dan berseverity (RC-AC-048), temuan tanpa lokasi tidak muncul.

#### RC-FR-049. Analisis arsitektur dan dependensi. missing
- Bukti: `dependency-cruiser` hanya devDependency repo (`package.json`, `.dependency-cruiser.cjs`), bukan tool agent.
- Kekurangan: tidak ada deteksi siklus, layer dilanggar, atau package tidak terpakai yang bisa dipanggil agent. Tidak ada import graph untuk JS/TS di runtime, tidak ada laporan lisensi dan ukuran dependency baru, tidak ada ekspor Markdown/JSON.
- Tes belum ada: project TypeScript melaporkan siklus dan pelanggaran layer (RC-AC-049), ekspor Markdown dan JSON.

#### RC-FR-050. Build, lint, typecheck, dependency. missing
- Bukti: `shell_run` generik. Skrip `build`/`lint`/`typecheck` ada di `package.json` repo, tetapi tidak ada deteksi atau pemanggilan otomatis.
- Kekurangan: tidak ada deteksi perintah dari `package.json`, lockfile, atau Makefile; tidak ada label asumsi; tidak ada tool build/lint/typecheck terpisah; tidak ada pencatatan lockfile yang berubah; tidak ada penolakan perintah yang mengubah lingkungan global.
- Tes belum ada: project Node, perintah terdeteksi dari lockfile, exit code asli dilaporkan, kegagalan tidak ditelan (RC-AC-050).

#### RC-FR-051. Integrasi Git. missing
- Bukti: `git_remote` hanya kolom di `packages/storage/src/db.ts:45`. Tidak ada tool Git di registry. `policy.ts:16` memblokir semua `git push` secara buta.
- Kekurangan: tidak ada status, diff, log, blame, branch, show, remote, stage, unstage, commit. Tidak ada pencatatan working tree kotor sebelum task. Tidak ada trailer `Rann-Code-Session`. `/commit` tidak ada. Blokir `git push` total bertentangan dengan RC-FR-117 butir 5 yang mengizinkan push dengan izin.
- Tes belum ada: `/git status` dan `/git diff` sama dengan git asli tanpa mengubah state (RC-AC-115), working tree kotor dicatat (RC-AC-051), trailer commit.

#### RC-FR-052. Dokumentasi dan inisialisasi project. partial
- Bukti: `main.ts:992-1003` `initCommand()` membuat `RANN.md` bila belum ada dan tidak menimpa file yang sudah ada.
- Kekurangan: isi `RANN.md` adalah placeholder generik, tepat hal yang dilarang butir 2. Tidak ada `RANN.md` berisi perintah, konvensi, dan batasan hasil deteksi repo. Tidak ada pembaruan dokumentasi setelah perubahan besar, tidak ada pilihan bahasa, dan `.rann/config.json` yang disebut RC-AC-052 tidak dibuat (yang dibuat `config.toml`).
- Tes belum ada: project kosong menghasilkan `RANN.md` dan config berisi fakta yang bisa diedit (RC-AC-052), file lama tidak tertimpa.

### 8.6 Skills dan tools

#### RC-FR-086. Registry tool bawaan. partial
- Bukti: array `tools` di `tools/index.ts:119-454`, `toolSpecs()` di `:456`, `findTool()` di `:460`, `executeTool()` di `:464`. `ToolSpec` di `providers/types.ts:17` hanya punya `name`, `description`, `parameters`.
- Kekurangan: hanya 8 tool dari 16 kategori yang dijanjikan. `ToolDefinition` tidak punya `outputSchema`, `permission`, `timeoutMs`, `idempotent`, `maxOutputBytes`, `category`, atau `tags` seperti `04-memory-skills-tools.md` 19.1. Tool yang tidak tersedia di platform tidak ditandai karena tidak ada konsep platform. `/tools` (`main.ts:528-531`) mencetak string hardcoded, bukan membaca registry, sehingga status dan izin tidak pernah tampil. Tidak ada mekanisme mematikan tool per project.
- Tes belum ada: `/tools` menampilkan semua tool dengan kategori, skema, dan status izin (RC-AC-086), tool dinonaktifkan per project.

#### RC-FR-087. Tool kustom dan eksternal. missing
- Bukti: tidak ada loader `.rann/tools/`, tidak ada `defineTool`, tidak ada eksekusi tool sebagai proses dengan input/output JSON. `/tool test` tidak ada.
- Kekurangan: kelima butir tidak terpenuhi. Tidak ada validasi skema saat registrasi, tidak ada deklarasi permission dan timeout, tidak ada penolakan tool tanpa skema.
- Tes belum ada: tool di `.rann/tools` terdaftar dan muncul, tool tanpa skema ditolak (RC-AC-087), tool eksternal gagal dengan output non-JSON.

#### RC-FR-088. Validasi skema dan chaining. partial
- Bukti: `parse()` di `tools/index.ts:111-117` memakai Zod dan menyusun pesan berisi `issue.path.join(".")` plus `issue.message`, dilempar sebagai `E_TOOL_INVALID_ARGS`. Tes `tools.test.ts:87`.
- Kekurangan: hanya input yang divalidasi, output tidak. Tidak ada chaining, sehingga tidak ada validasi kecocokan output A ke input B, tidak ada penilaian izin per langkah, dan tidak ada penyimpanan output antara sebagai artefak.
- Tes belum ada: argumen salah tipe tidak dieksekusi dan pesan menyebut path field (RC-AC-088), sambungan pipeline yang tidak cocok ditolak, pipeline lebih dari 10 langkah ditolak.

#### RC-FR-089. Permission, timeout, retry, log tool. partial
- Bukti: `policy.ts:49` `decide`, `:65` `assertAllowed`, `ToolRisk` di `:4`. Timeout shell di `tools/index.ts:278` dan pembunuhan process group di `:309-321` lewat `detached` plus `process.kill(-pid)`. Pembatalan lewat `AbortSignal` di `:322`. Pemotongan output 100.000 karakter di `:42`. Pencatatan `tool_calls` di `agent.ts:392` dan `:396`.
- Kekurangan: `ToolRisk` hanya `read`, `write`, `exec`, tidak ada `net` dan `admin` seperti tabel izin PRD. Tidak ada timeout default per tool di definisi tool; hanya shell yang punya. Tidak ada matriks retry dan tidak ada penanda idempoten, sehingga retry tidak mungkin diputuskan. Log menyimpan `args_json` mentah tanpa sanitasi dan tanpa trace id atau span. Output besar dipotong tanpa artefak: `artifactsDir` dibuat di `paths.ts:46` tetapi tidak pernah dipakai. `audit_log` ada di `db.ts:144` dan `appendAudit` di `repos.ts:546`, tetapi tidak dipanggil untuk tool call. `shell_run` mewarisi seluruh `process.env` ke proses anak, termasuk API key.
- Tes belum ada: timeout membunuh seluruh child process dan mencatat `E_TOOL_TIMEOUT` (RC-AC-089), retry hanya untuk tool idempoten, artefak menyimpan output penuh, audit memuat setiap tool call, args sensitif tersanitasi.

#### RC-FR-090. Cakupan kategori tool. missing
- Bukti: 8 tool yang ada hanya mencakup filesystem, terminal, memori, skill, dan subagent. Kategori lain tidak ada kode sama sekali.
- Kekurangan: git, web search, HTTP, browser, eksekusi kode terisolasi, database, package, testing, gambar, dokumen, sistem, scheduling, dan messaging tidak ada. Butir 2 sampai 5 (database read-only, PDF/DOCX/XLSX, resize/crop/OCR, adapter messaging) tidak bisa dipenuhi karena tidak ada tool-nya.
- Tes belum ada: minimal satu tool berfungsi per kategori (RC-AC-090), penolakan write database tanpa izin, ekstraksi teks dokumen, OCR.

### 8.9 Git, browser, background, scheduler

#### RC-FR-115. Operasi Git dasar. missing
- Bukti: tidak ada modul Git. `grep -rn "git"` hanya menemukan kolom `git_remote`, pola blokir `git push`, dan skip `.git` di `fs_list`.
- Kekurangan: sepuluh operasi yang diminta tidak ada. Tidak ada pembuatan commit message dari diff, tidak ada mekanisme persetujuan commit, tidak ada trailer `Rann-Code-Session`, tidak ada deteksi konflik sebelum commit.
- Tes belum ada: status, diff, log, show, blame, branch, remote, stage, unstage, commit; commit ditolak saat repo berkonflik.

#### RC-FR-116. Checkpoint dan rollback. missing
- Bukti: `checkpointsDir` dibuat di `paths.ts:47` dan `:60`, tidak ada pembaca atau penulis.
- Kekurangan: tidak ada pembuatan checkpoint sebelum perubahan berisiko atau setelah verifikasi, tidak ada rollback file dan state task, tidak ada penolakan saat ada perubahan pengguna setelah checkpoint, tidak ada riwayat dan pembersihan, tidak ada audit rollback. `/undo` dan `/checkpoint` tidak ada.
- Tes belum ada: task mengubah 4 file lalu `/undo` mengembalikan semuanya dan tercatat di audit (RC-AC-116), rollback ditolak saat file berubah setelah checkpoint.

#### RC-FR-117. Worktree dan konflik. missing
- Bukti: tidak ada. Tidak ada konsep task worktree di `packages/storage/src/db.ts`.
- Kekurangan: tidak ada worktree per task atau agen, tidak ada merge berbasis diff dengan deteksi konflik, tidak ada pembersihan worktree, tidak ada kebijakan pull/push selain blokir total `git push` di `policy.ts:16`.
- Tes belum ada: dua worktree mengubah file sama dan merge mendeteksi konflik tanpa menimpa (RC-AC-117), force push ditolak (RC-AC-146).

#### RC-FR-118. Browser automation dasar. missing
- Bukti: tidak ada dependensi browser di `packages/runtime/package.json` (hanya `@rann/shared`, `@rann/storage`, `zod`). Tidak ada modul browser.
- Kekurangan: navigate, click, type, scroll, select, screenshot, extract, download, upload, dan evaluate tidak ada. Tidak ada timeout per aksi, tidak ada penyimpanan artefak, tidak ada izin untuk aksi yang mengubah data, tidak ada blocklist domain.
- Tes belum ada: navigate, click, type, screenshot tersimpan sebagai artefak (RC-AC-118), domain diblokir ditolak, aksi pengiriman form butuh izin.

#### RC-FR-119. Isolasi sesi dan autentikasi browser. missing
- Bukti: tidak ada. Bergantung penuh pada RC-FR-118 yang juga tidak ada.
- Kekurangan: tidak ada browser context per task, tidak ada profil persisten opsional, tidak ada penjagaan kredensial agar tidak masuk log, tidak ada alur 2FA, tidak ada pembersihan context.
- Tes belum ada: dua task paralel memakai context terpisah dan cookie tidak bocor (RC-AC-119), kredensial tidak muncul di transcript.

#### RC-FR-120. Perbedaan search, fetch, dan browser. missing
- Bukti: tidak ada `web_search`, `http_request`, atau browser.
- Kekurangan: kelima butir tidak terpenuhi, termasuk pencatatan alasan pemilihan metode dan fallback antar metode.
- Tes belum ada: pertanyaan "harga terbaru" membuat agent membedakan search, fetch, dan browser serta mencatat alasannya (RC-AC-120), batas ukuran dan robots dihormati.

## 3. Prioritas

### P0. Wajib sebelum gate M5 dan M6

1. Tool Git lengkap plus checkpoint/rollback (RC-FR-051, 115, 116). Gate M5 menyebut checkpoint restore dan blokir `reset --hard` serta force push; saat ini tidak ada satu pun operasi Git yang bisa dipanggil agent. Mulai dari service Git tipis di atas `shell_run` dengan allowlist subcommand, lalu checkpoint berbasis tabel dan `checkpointsDir`.
2. Patch aman dan transaksi multi-file (RC-FR-043, 044). Gate M5: patch gagal tidak mengubah file, rollback bersih. Perlu hash sebelum/sesudah, tabel `file_changes`, dan rollback berurutan terbalik.
3. Path guard yang menyelesaikan symlink plus `delete_file`/`stat_file`/`glob` (RC-FR-042). Gate M6: symlink keluar workspace ditolak. `resolveInsideWorkspace` harus memakai `realpathSync` pada komponen yang ada.
4. Audit dan artefak untuk setiap tool call (RC-FR-089). Gate M6: audit mencatat setiap tool call. `appendAudit` sudah ada tetapi tidak dipanggil, dan `artifactsDir` sudah dibuat tetapi tidak dipakai.
5. Registry tool dengan metadata penuh dan kategori (RC-FR-086, 090). Tanpa `category`, `outputSchema`, `permission`, `timeoutMs`, dan `idempotent`, `/tools` tidak bisa jujur dan retry tidak bisa diputuskan.
6. Eksplorasi repo, deteksi perintah, review, dan tes (RC-FR-040, 047, 048, 050). Ini yang membuat agent bisa bekerja tanpa disuapi perintah, dan menjadi prasyarat verifikasi RC-FR-039.

### P1. Dibutuhkan V1, bisa menyusul setelah alur inti hidup

7. `web_search` dan `http_request` dengan risk `net` (RC-FR-120). Risiko lebih rendah daripada browser dan menutup sebagian besar kebutuhan riset.
8. Browser automation dan isolasi context (RC-FR-118, 119). Perlu dependensi baru dan manajemen proses, jadi kerjakan setelah policy `net` stabil.
9. Analisis arsitektur dan dependensi (RC-FR-049). Bisa dibangun di atas import graph yang sama dengan indeks simbol.
10. Pencarian kode (RC-FR-041). Bergantung pada indeks simbol; grep sederhana bisa lebih dulu.
11. Worktree dan konflik (RC-FR-117). Baru berguna setelah Git dan checkpoint ada.

### P2. Penyempurnaan

12. Tool kustom dan eksternal plus `/tool test` (RC-FR-087).
13. Chaining dan validasi output (RC-FR-088).
14. Refactoring dan debugging terinstrumentasi (RC-FR-045, 046) yang bergantung pada tes dan review.
15. Sandbox proses nyata: filter env, isolasi jaringan, dan pembatasan cwd di luar `resolve`. Saat ini `shell_run` mewarisi seluruh `process.env` dan menjalankan `bash -lc`.

## 4. File yang perlu disentuh

- `packages/runtime/src/tools/index.ts`: pecah menjadi `tools/fs.ts`, `tools/shell.ts`, `tools/git.ts`, `tools/web.ts`, `tools/browser.ts`; tambah metadata `category`, `outputSchema`, `permission`, `timeoutMs`, `idempotent`, `maxOutputBytes`.
- `packages/runtime/src/tools/registry.ts` (baru): registrasi, validasi skema, lookup, filter per project dan platform.
- `packages/runtime/src/policy.ts`: tambah risk `net` dan `admin`, ganti blokir `git push` buta dengan aturan per subcommand, tambah `realpath` di `resolveInsideWorkspace`.
- `packages/runtime/src/agent.ts`: panggil `appendAudit` per tool call, sanitasi args, simpan artefak saat output dipotong, teruskan trace id.
- `packages/runtime/src/git.ts` (baru): status, diff, log, show, blame, branch, remote, stage, unstage, commit dengan trailer.
- `packages/runtime/src/checkpoint.ts` (baru): buat, daftar, restore, bersihkan, catat audit.
- `packages/runtime/src/patch.ts` (baru): patch old/new dan unified diff, hash verify, diff output, transaksi multi-file.
- `packages/runtime/src/browser.ts` (baru): context per task, artefak screenshot dan unduhan.
- `packages/runtime/src/search.ts` (baru): grep, indeks simbol, skor, alasan relevansi.
- `packages/runtime/src/project-map.ts` (baru): pemindaian repo, deteksi bahasa dan perintah, tulis `.rann/project-map.json`.
- `packages/storage/src/db.ts` dan `repos.ts`: tabel `file_changes`, `checkpoints`, `artifacts`, `transactions`; fungsi CRUD dan pemanggilan audit.
- `packages/cli/src/main.ts`: `/init`, `/review`, `/test`, `/debug`, `/git`, `/commit`, `/checkpoint`, `/undo`, `/index`, `/tools` dinamis, `/tool test`.
- `packages/runtime/src/providers/types.ts`: `ToolSpec` perlu membawa skema output bila provider mendukung.
- `packages/runtime/src/tools.test.ts` dan tes baru per modul: symlink escape, hash verify, rollback transaksi, timeout process group, audit entry, artefak.
