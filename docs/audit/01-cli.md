# Audit 01. CLI, TUI, dan Slash Command Registry

- Lingkup: RC-FR-001 sampai RC-FR-020 (20 FR) dan daftar command di `docs/prd/02-cli-ux-and-commands.md` 11.1 sampai 11.4 (97 baris command).
- Basis PRD: `docs/prd/01-requirements.md` 8.1, `docs/prd/02-cli-ux-and-commands.md` 10 sampai 12, `docs/prd/IMPLEMENTATION-ROADMAP.md` M3, `docs/prd/ACCEPTANCE-CRITERIA.md` RC-AC-001 sampai RC-AC-020, `docs/prd/ARCHITECTURE.md` 13.4.
- Kode yang diperiksa: `packages/cli/src/{main,args,ui,stream,config-store,daemon,daemon-main}.ts` (1.535 baris), `packages/shared/src/{errors,rpc,events,config}.ts`, `packages/runtime/src/{rpc,agent}.ts`, `packages/storage/src/{db,repos}.ts`.
- Commit: `82270f1`. Build `packages/cli/dist` tanggal 5 Nov, sumber CLI terakhir diubah 5 Nov 11:24.
- Audit ini tidak mengubah kode.

## 1. Ringkasan

| Status | Jumlah | FR |
|---|---|---|
| done | 0 | tidak ada |
| partial | 13 | 001, 004, 006, 007, 008, 011, 012, 013, 014, 015, 016, 018, 020 |
| missing | 7 | 002, 003, 005, 009, 010, 017, 019 |

Aturan verdict yang dipakai: **done** bila semua requirement bernomor terpenuhi dan diuji; **partial** bila ada implementasi nyata untuk minimal satu requirement tetapi sisanya belum; **missing** bila tidak ada implementasi untuk requirement mana pun, atau bentuk yang diminta tidak ada sama sekali (misalnya status bar vs perintah `/status`).

Tidak ada satu pun FR di lingkup ini yang memenuhi seluruh requirement. Yang benar-benar bekerja adalah eksekusi satu turn non-interaktif (`-p`), streaming teks mentah ke stdout, dan prompt approval berbasis baris. Selebihnya adalah lapisan tipis di atas `readline`: tidak ada Ink atau React di dependensi (`packages/cli/package.json:15-19`), tidak ada command registry, tidak ada palette, tidak ada status bar, tidak ada history persisten, tidak ada multiline, dan tidak ada penanganan resize.

Dari 20 FR, 17 berprioritas P0. Tidak satu pun P0 berstatus done, sehingga M3 belum bisa dimulai dari kondisi "tinggal merapikan": sebagian besar deliverable M3 harus dibangun dari nol.

Cakupan command registry: dari 97 baris command di 11.2, 9 baris punya handler slash di REPL, 15 baris hanya punya padanan subcommand CLI dengan semantik berbeda atau lebih sempit, dan 73 baris tidak ada sama sekali. Definisi command sesuai 11.1 (skema argumen, permission, handler, help, error map) tidak ada untuk satu command pun.

### 1.1 Metode dan kondisi uji

- `grep -rniE "CommandDefinition|registry|registerCommand"`, `"palette|fuzzy|autocomplete"`, `"theme|SIGWINCH|markdown|ink|react"`, `"history"`, `"commands"` di `packages/*/src` tanpa `node_modules`: nol hasil untuk registry, palette, fuzzy, autocomplete, theme, SIGWINCH, markdown, Ink, React, dan direktori command kustom. `history` hanya muncul sebagai riwayat pesan agent (`packages/runtime/src/agent.ts:319`), bukan riwayat input.
- Semua uji perilaku dijalankan dengan `RANN_HOME` terisolasi di `$TMPDIR/rann-home-{c,d,e}`, build `packages/cli/dist`, dan provider `mock` (default config, `packages/shared/src/config.ts:34`).
- Node yang dipakai: v22.23.3 dari `/root/.nvm/versions/node/v22.23.3/bin`. Dengan Node v18.19.1 (`/usr/bin/node`) CLI gagal start daemon: `rann: E_DAEMON_DOWN: Daemon gagal start. Cek log di .../logs`, exit 4, dan folder log yang dirujuk kosong sehingga penyebabnya tidak terlihat. `packages/cli/package.json` tidak punya field `engines`, jadi versi Node yang tidak didukung tidak ditolak saat instalasi. Ini masalah build/distribusi, bukan CLI, tetapi terlihat langsung oleh pengguna sebagai first-run yang gagal.
- Baseline tes: 52 tes di 11 berkas lulus. Tidak ada satu pun tes untuk `packages/cli`. `vitest.config.ts` menyertakan `packages/*/src/**/*.test.ts`, dan tidak ada berkas `*.test.ts` di `packages/cli/src`.

## 2. Terminal interface (RC-FR-001 sampai RC-FR-020)

### RC-FR-001. REPL interaktif

- Ringkasan: `rann` tanpa argumen membuka REPL di TTY dan mode non-interaktif di pipe; header berisi project, branch, session id pendek, model, mode izin; prompt menerima teks, slash, `@`, `!`, lampiran; status turn berubah; Ctrl+D menutup dengan pilihan saat ada task.
- Status: **partial**
- Bukti: dispatch di `packages/cli/src/main.ts:82-91`; REPL di `main.ts:450-604`; header di `main.ts:478-482`; prompt `readline` di `main.ts:496-511`; `Ctrl+C` di `main.ts:499-507`.
- Kekurangan:
  1. Requirement 1 hanya separuh. `rann` tanpa argumen di TTY membuka REPL, tetapi bila stdin atau stdout bukan TTY ia mencetak `HELP` dan keluar 0 (`main.ts:85-91`). `printf 'halo\n' | rann` menghasilkan bantuan, bukan membaca stdin sebagai konteks. Diuji: exit 0, stdout berisi teks bantuan.
  2. Header tidak memuat nama project dan branch Git. Yang tampil hanya `Rann Code  <cwd>`, `sesi ses_...` (id penuh, tidak dipendekkan), model, dan mode izin. Tidak ada pemanggilan Git sama sekali di `packages/cli`.
  3. Prompt tidak menerima `@` (file), `!` (shell), atau lampiran. Baris yang diawali `!ls` dikirim ke model sebagai prompt biasa, dan `@src/app.ts` juga.
  4. Tidak ada status turn (`mengirim`, `menunggu model`, `menjalankan tool`, `memverifikasi`, `selesai`). Event `turn.started` dipublikasikan runtime (`packages/runtime/src/agent.ts:263`) tetapi tidak pernah ditangani `packages/cli/src/stream.ts:124-183`.
  5. Ctrl+D tidak menutup REPL. Dua pengujian: `printf 'halo\n' | script -qec "rann chat" /dev/null` berakhir dengan `rann: E_INTERNAL: Aborted with Ctrl+D` (exit 1), dan REPL dengan stdin EOF langsung menggantung sampai `timeout 8` membunuhnya (exit 124). Tidak ada handler `close` pada `readline`.
- Tes yang belum ada: `rann` tanpa argumen di pipe harus membaca stdin (bukan help); snapshot header untuk repo dengan branch; Ctrl+D saat idle harus exit 0; Ctrl+D saat turn berjalan harus menawarkan tunggu/batal/background; urutan status turn.

### RC-FR-002. Slash command registry

- Ringkasan: registry menyimpan 11 field per command (nama, alias, deskripsi, kategori, skema argumen, opsi, permission, handler, output, error map, help), palette saat `/`, command tidak tersedia tetap terlihat, konflik nama diselesaikan project > plugin > bawaan, command bisa berasal dari `~/.rann/commands/` dan `.rann/commands/`.
- Status: **missing**
- Bukti: tidak ada modul registry. `KNOWN_COMMANDS` di `main.ts:48-68` hanya whitelist dispatch 19 subcommand, bukan registry: tidak menyimpan deskripsi, alias, skema, permission, atau handler. Slash command di REPL adalah rantai `if` literal di `main.ts:514-582`. `grep -rn "commands" packages/*/src` nol hasil, jadi direktori command kustom tidak pernah dibaca.
- Kekurangan:
  1. Semua field kontrak 11.1 tidak ada. Tidak ada `CommandDefinition`, `CommandContext`, `CommandResult`.
  2. Tidak ada palette. Mengetik `/` hanya membuka baris kosong; tidak ada daftar command.
  3. Command yang tidak tersedia tidak pernah ditampilkan dengan alasan, dan tidak ada `hideUnavailable`.
  4. Tidak ada resolusi konflik project/plugin/bawaan, tidak ada pelaporan konflik saat registrasi.
  5. Tidak ada loader `.rann/commands/*.md` maupun `~/.rann/commands/*.md`, tidak ada validasi frontmatter.
  6. `/help` di REPL hanya string hardcoded 8 command (`main.ts:515-517`).
- Tes yang belum ada: registrasi 97 command valid; command tanpa `args` schema ditolak saat start; konflik nama menghasilkan error yang menyebut kedua sumber; command kustom dari file muncul di palette; `/` membuka palette < 100 ms; command tidak tersedia tampil dengan alasan.

### RC-FR-003. Autocomplete dan fuzzy search

- Ringkasan: fuzzy pada nama, alias, kata kunci deskripsi; autocomplete kontekstual untuk model, provider, session, task, skill, MCP server, path; navigasi panah/Tab/Enter/Esc; maksimal 50 hasil terurut relevansi; saran terdekat bila kosong.
- Status: **missing**
- Bukti: tidak ada `completer` pada `readline.createInterface` (`main.ts:496`), tidak ada skor fuzzy, tidak ada pencarian kandidat. `grep -iE "fuzzy|autocomplete|palette|completer"` di `packages/cli/src` nol hasil.
- Kekurangan: seluruh requirement tidak terpenuhi. Tab tidak menampilkan saran command; tidak ada daftar kandidat saat `/tidaka` diketik.
- Tes yang belum ada: `/mo` + Tab menampilkan `/model` dan `/models` tanpa mengeksekusi; panah memindahkan seleksi; Esc menutup tanpa mengubah input; 200 kandidat dipotong ke 50 dengan urutan relevansi; input tanpa hasil menampilkan tiga saran.

### RC-FR-004. Keyboard shortcuts

- Ringkasan: Enter, Shift+Enter, Ctrl+C, Ctrl+D, Ctrl+L, Ctrl+R, Ctrl+O, Ctrl+E, Ctrl+K, PgUp/PgDn; `/help keys`; shortcut yang tidak didukung ditandai; bisa dinonaktifkan lewat config.
- Status: **partial**
- Bukti: Enter mengirim baris dan Ctrl+C membatalkan turn saat sibuk (`main.ts:499-511`); panah atas memakai riwayat in-memory `readline`. Tidak ada `Ctrl+O`, `Ctrl+E`, `Ctrl+K`, `Shift+Enter`, `SIGWINCH`, dan PgUp/PgDn. Ctrl+D justru menghasilkan `E_INTERNAL` (lihat RC-FR-001).
- Kekurangan: dari 10 shortcut yang diminta, hanya Enter dan Ctrl+C yang bekerja sesuai kontrak. `Shift+Enter` tidak mungkin di `readline` mode baris karena Enter langsung mengirim; `Ctrl+O` (perluas tool) tidak ada meski output tool dilipat secara implisit; Ctrl+D rusak; `/help keys` tidak ada; tidak ada tabel kapabilitas terminal; tidak ada config shortcut; `Ctrl+L`/`Ctrl+R` hanya kebetulan dari `readline` dan tidak diuji.
- Tes yang belum ada: setiap shortcut minimum diuji pada PTY; `/help keys` memuat semua shortcut; shortcut yang dinonaktifkan tidak bereaksi; tidak ada tabrakan dengan binding terminal umum.

### RC-FR-005. Multiline input dan editor eksternal

- Ringkasan: Shift+Enter menambah baris; paste multiline tidak langsung mengirim; batas 100.000 karakter; Ctrl+E membuka `$EDITOR`; tampilan multiline dengan indentasi dan highlight blok kode; batal di editor tidak mengubah prompt.
- Status: **missing**
- Bukti: `const line = (await rl.question(...)).trim()` (`main.ts:511`) memproses satu baris per turn. Tidak ada buffer multiline, tidak ada pemanggilan `$EDITOR`/`$VISUAL`, tidak ada deteksi paste, tidak ada pengecekan panjang (batas 200.000 karakter hanya di skema RPC `packages/shared/src/rpc.ts:60`).
- Kekurangan: paste tiga baris akan mengirim tiga turn terpisah, bukan satu prompt. Tidak ada editor eksternal. Tidak ada syntax highlight. Tidak ada batas 100.000 karakter dengan saran lampiran.
- Tes yang belum ada: paste multiline menghasilkan satu turn; Shift+Enter menambah baris tanpa mengirim; Ctrl+E membuka `$EDITOR` tiruan dan menyimpan hasil; batal di editor mempertahankan prompt lama; input 100.001 karakter ditolak dengan saran.

### RC-FR-006. Input history

- Ringkasan: riwayat per project dan profil, maksimal 1.000 entri; panah atas/bawah; Ctrl+R fuzzy; tidak menyimpan file, secret, atau prompt `private`; `/history`, `/history clear`, filter tanggal; bertahan setelah restart dan tidak bocor antar profil.
- Status: **partial**
- Bukti: riwayat hanya in-memory dari `readline` selama proses `chat` berjalan, jadi panah atas berfungsi dalam satu sesi. Tidak ada penulisan riwayat ke disk; `grep -rn "history" packages/cli/src` nol hasil.
- Kekurangan: requirement inti tidak terpenuhi. Setelah keluar riwayat hilang; tidak ada pemisahan per project/profil; tidak ada batas 1.000 entri; tidak ada `/history`, filter tanggal, atau redaksi secret/prompt `private`.
- Tes yang belum ada: 3 prompt lalu restart, panah atas memunculkan yang terakhir; riwayat tidak berisi isi file yang dilampirkan; `/history clear` mengosongkan; profil berbeda tidak saling melihat riwayat; batas 1.000 entri memotong yang terlama.

### RC-FR-007. Streaming response

- Ringkasan: delta dengan throttle maksimal 30 fps, tanpa kedip/duplikasi; marker `[stream terputus]` dan pilihan lanjut/ulangi; reasoning delta terpisah dan bisa dilipat; Markdown dirender setelah blok selesai; teks lama tidak dihapus saat reconnect.
- Status: **partial**
- Bukti: `packages/cli/src/stream.ts:124-135` menulis setiap `message.delta` langsung ke stdout tanpa buffer atau throttle. `stream.ts:156-165` menutup turn. Tidak ada penanganan `message.completed`, tidak ada reconnect.
- Kekurangan:
  1. Tidak ada throttle. Mock mengirim potongan 24 karakter (`packages/runtime/src/providers/mock.ts:40-43`), tetapi provider nyata mengirim per token; tanpa buffer 16 ms ini akan menulis ratusan kali per detik.
  2. Tidak ada marker `[stream terputus]`. Kode `E_STREAM_TRUNCATED` ada di `packages/shared/src/errors.ts:17` tetapi tidak pernah dilempar atau dipublikasikan (`grep E_STREAM_TRUNCATED` hanya menemukan definisi).
  3. Tidak ada reasoning delta. `ProviderChunk` hanya `text | tool_call | usage | done` (`packages/runtime/src/providers/types.ts:32-36`), jadi tidak ada kanal reasoning untuk ditampilkan.
  4. Tidak ada render Markdown. Teks ditulis apa adanya, termasuk fence dan tabel.
  5. Tidak ada mekanisme reconnect; teks yang sudah tampil dipertahankan hanya karena proses tidak pernah menghapusnya.
- Tes yang belum ada: 500 delta dalam 1 detik menghasilkan ≤ 30 flush; stream yang berakhir tanpa `turn.completed` memunculkan marker dan prompt pilihan; reasoning tidak bercampur dengan jawaban; fence ditutup lalu di-highlight; reconnect tidak menduplikasi teks.

### RC-FR-008. Live tool execution display

- Ringkasan: blok tool menampilkan nama, args ringkas, status, durasi, ringkasan hasil; output panjang dilipat dan Ctrl+O memperluas; shell menampilkan cwd dan exit code; edit file menampilkan diff; penolakan policy menampilkan alasan.
- Status: **partial**
- Bukti: `stream.ts:137-151`. Dua baris: `[tool] <nama>` saat mulai dan `[tool] <nama> ok|error` saat selesai. Diuji dengan `-p 'tool:shell_run {"command":"echo halo"}' --yes`: stdout memuat kedua baris itu tanpa args, durasi, atau output tool.
- Kekurangan: tidak ada args, durasi, ringkasan hasil, exit code, cwd, diff, jumlah baris berubah, path artefak, alasan policy, atau perluasan Ctrl+O. Status hanya `ok`/teks status mentah; status `menunggu izin`, `antre`, `jalan`, `dilewati`, `dibatalkan` tidak dipetakan. Tool paralel tidak dikelompokkan.
- Tes yang belum ada: blok memuat nama, args tersunting, durasi, dan ringkasan; shell menampilkan cwd + exit code; edit file menampilkan `+12 -3`; tool ditolak menampilkan alasan policy; > 10.000 karakter menghasilkan artefak dan baris rujukan; Ctrl+O membuka detail.

### RC-FR-009. Task dan agent progress

- Ringkasan: indikator `langkah x/y`, task aktif, waktu berjalan; status DAG selesai/berjalan/menunggu; penanda `replan`; progress tidak 100 persen sebelum verifikasi; progress background lewat `/tasks` dan notifikasi.
- Status: **missing**
- Bukti: tidak ada tabel `tasks`, `plans`, atau `checkpoints` di `packages/storage/src/db.ts:32-229` (hanya profiles, projects, sessions, turns, messages, tool_calls, usage_events, audit_log, events, config_kv, memories, schema_migrations). Tidak ada event plan/task di `packages/shared/src/events.ts:1-13`. Tidak ada `/tasks` di REPL.
- Kekurangan: seluruh requirement tidak terpenuhi. Satu-satunya progres yang terlihat adalah `steps` di akhir turn (`stream.ts:159`), bukan indikator berjalan.
- Tes yang belum ada: turn 5 langkah menampilkan `2/5` saat berjalan; penanda `replan` saat rencana berubah; progress tidak mencapai 100 persen sebelum verifikasi; `/tasks` menampilkan task background.

### RC-FR-010. Status bar

- Ringkasan: status bar satu baris berisi model, provider, token masuk/keluar, persentase context, biaya turn, mode izin; `$?` untuk model tanpa harga; zona warna context 50/75/90 persen; penanda provider bermasalah dan fallback; bisa dimatikan lewat config.
- Status: **missing**
- Bukti: tidak ada status bar. `/status` di REPL mencetak lima baris: sesi, model, izin, folder, status (`main.ts:519-527`). Tidak ada token, context, atau biaya.
- Kekurangan: seluruh requirement tidak terpenuhi. Tidak ada perhitungan biaya sama sekali: `recordUsage` dipanggil tanpa `costUsd` (`packages/runtime/src/agent.ts:377-384`), sehingga `cost_usd` selalu 0 dan `$?` vs `$0.00` tidak bisa dibedakan. Pemakaian hanya dicatat pada langkah yang tidak memanggil tool (`agent.ts:375-384`), jadi token dari langkah tool dan turn yang gagal tidak masuk `/usage`. Tidak ada perhitungan persentase context di CLI, dan tidak ada opsi config untuk mematikan status bar.
- Tes yang belum ada: status bar memuat 6 field; model tanpa harga menampilkan `$?`; context 90 persen menampilkan zona merah dan label; provider gagal menampilkan `!` dan fallback; config `ui.status_bar=false` menyembunyikannya.

### RC-FR-011. Approval dialog

- Ringkasan: dialog menampilkan jenis aksi, tool, args lengkap, path/target, dampak, dan tiga pilihan (sekali, selalu untuk pola, tolak); diff untuk edit, perintah + cwd untuk shell, domain + metode untuk jaringan; Esc menolak dan Enter tidak otomatis menyetujui aksi destruktif; keputusan dicatat di audit; pola diingat per sesi, tidak lintas project tanpa konfirmasi.
- Status: **partial**
- Bukti: `makeApprovalHandler` di `main.ts:426-446`; `askApproval` di `stream.ts:95-122`; `chooseWith` di `ui.ts:49-66`. Prompt menampilkan nama tool dan args (dipotong 500 karakter), tiga pilihan bernomor dengan default `deny`.
- Kekurangan:
  1. Tidak ada panel, hanya prompt baris. Tidak ada jenis aksi, dampak, path target, atau estimasi efek.
  2. Tidak ada diff untuk edit file, tidak ada cwd untuk shell, tidak ada domain/metode untuk jaringan. Args ditampilkan sebagai JSON mentah, bukan disunting per field.
  3. Esc tidak menolak (Esc hanya membatalkan baris `readline`); Enter memilih default `deny` sehingga aman, tetapi tidak ada penegasan khusus untuk aksi destruktif, dan tidak ada opsi "tolak dan beri alasan" dari 10.8 sehingga feedback tidak masuk ke konteks agen.
  4. Keputusan tidak masuk audit. `appendAudit` ada di `packages/storage/src/repos.ts:546` tetapi tidak dipanggil dari mana pun (`grep appendAudit` hanya menemukan definisi dan file `.d.ts`). `respondPermission` hanya menyelesaikan promise (`packages/runtime/src/rpc.ts:303-308`).
  5. "Selalu untuk pola ini" sebenarnya "selalu untuk tool ini" (`preApprovedTools.add(call.name)`, `agent.ts:457`), bukan pola args. Tidak ada cakupan project maupun pencabutan lewat `/permissions`.
  6. Tidak ada timeout approval khusus maupun status `waiting_approval`. Satu-satunya batas adalah timer turn 600 detik (`stream.ts:79-82`), dan itu menggagalkan seluruh turn dengan `E_TIMEOUT`, bukan menyimpan task untuk dilanjutkan.
  7. Mode non-interaktif menolak otomatis dan tetap keluar 0 bila model melanjutkan. Diuji dengan `-p 'tool:shell_run {...}'`: `[izin] ... Ditolak.` lalu `Balasan mock: ...`, exit 0. PRD 10.8 mewajibkan exit 3.
- Tes yang belum ada: dialog memuat tool, args, dampak, dan tiga pilihan; Esc menolak; Enter pada aksi destruktif tidak menyetujui; keputusan tercatat di `audit_log` dengan alasan; pola yang diingat berlaku di sesi yang sama dan tidak di project lain; timeout menghasilkan `waiting_approval`; non-interaktif tanpa `--allow-*` keluar 3.

### RC-FR-012. Interrupt, cancel, dan resume

- Ringkasan: Ctrl+C sekali mengosongkan input, dua kali dalam 2 detik membatalkan turn, tiga kali keluar; pembatalan menghentikan stream, membunuh process group, melepas lease, menyimpan checkpoint; `/resume` melanjutkan turn dari langkah terakhir; task background bisa dibatalkan; riwayat dan perubahan file tidak dihapus.
- Status: **partial**
- Bukti: handler `SIGINT` di `main.ts:499-507` memanggil `session.cancel` saat `busy`; `session.cancel` meng-abort controller (`packages/runtime/src/rpc.ts:180-186`); `agent.ts:318` dan `agent.ts:391` memeriksa `signal.aborted` dan melempar `E_CANCELLED`.
- Kekurangan:
  1. Tidak ada hitungan tekan. Saat idle Ctrl+C hanya mencetak baris kosong lalu prompt lagi; tidak pernah keluar dengan 130 pada tekan ketiga.
  2. Pembatalan menghentikan stream dan membunuh process group tool dengan SIGKILL (`packages/runtime/src/tools/index.ts:307-315`), tetapi tidak ada checkpoint dan lease. Direktori `checkpoints` dibuat di `paths.ts:47` tanpa tabel maupun pemakaian, jadi turn yang dibatalkan tidak bisa dilanjutkan dari langkah terakhir.
  3. Tidak ada `/resume` turn di REPL, dan `rann resume <sesi> "instruksi"` hanyalah alias `sendCommand` (`main.ts:110-111`), bukan melanjutkan turn yang dibatalkan.
  4. Tidak ada konsep task background untuk dibatalkan; `--detach` hanya melepas turn (`main.ts:381-398`) dan tidak ada perintah pembatalannya.
  5. Exit code 130/143 tidak dipetakan eksplisit; hanya mengandalkan perilaku default Node.
- Tes yang belum ada: tiga tekan Ctrl+C dalam 2 detik keluar 130; pembatalan menghentikan proses anak (bukan hanya stream); checkpoint bisa dilanjutkan setelah cancel; `/resume` memakai checkpoint terakhir; riwayat tetap utuh setelah cancel.

### RC-FR-013. Terminal resize dan fallback

- Ringkasan: respons `SIGWINCH` ≤ 100 ms; lebar < 60 kolom menyembunyikan elemen sekunder; `TERM=dumb`/`NO_COLOR` tanpa escape sequence; fallback bila Ink gagal dimuat; lebar sel CJK/emoji benar.
- Status: **partial**
- Bukti: tidak ada handler `SIGWINCH` dan tidak ada pembacaan `process.stdout.columns` di `packages/cli/src` (`grep -rn "SIGWINCH|stdout.columns"` nol hasil). `table()` di `ui.ts:25-30` menghitung lebar dengan `String.length`, sehingga karakter lebar dihitung 1. `TERM=dumb` diuji pada PTY: 0 byte ESC. `NO_COLOR=1` pada PTY masih menghasilkan 6 byte ESC dari `readline` (`\x1b[1G\x1b[0J`, `\x1b[3G`).
- Kekurangan:
  1. Tidak ada reflow. Layout tidak pernah dihitung ulang; tidak ada model tampilan.
  2. Tidak ada ambang lebar. Tabel dan bantuan akan meluber di 40 kolom.
  3. Requirement 3 baru separuh: `TERM=dumb` bersih, tetapi `NO_COLOR=1` masih mengeluarkan escape sequence `readline`. Prompt juga tetap memakai `›` Unicode tanpa fallback ASCII.
  4. Tidak ada Ink, jadi jalur fallback yang diminta belum ada; risikonya baru muncul bila M3 memilih Ink.
  5. Lebar sel CJK/emoji salah.
- Tes yang belum ada: resize 40x20 ke 200x60 tanpa overflow; `TERM=dumb` tidak menghasilkan byte ESC; `NO_COLOR=1` tetap menampilkan simbol status; tabel dengan teks CJK rata; `CI=1` menonaktifkan spinner.

### RC-FR-014. Non-interactive mode

- Ringkasan: `rann -p "<prompt>"` satu turn tanpa TUI; format `text`, `json`, `stream-json`, `ndjson`; `json` satu objek berisi `text`, `usage`, `sessionId`, `taskId`, `status`, `error`; `stream-json` satu objek per baris; exit code mengikuti ARCHITECTURE 13.4.
- Status: **partial**
- Bukti: `runPrompt`/`sendToSession` di `main.ts:347-424`; format di `main.ts:371-375`; payload JSON di `main.ts:405-418`; emitter stream-json di `stream.ts:76-78`, `99`, `133`, `140`, `149`, `161`, `171-172`.
- Kekurangan:
  1. `ndjson` tidak dikenali. Diuji: `--output-format ndjson` → `E_INVALID_PARAMS ... Pakai text, json, atau stream-json`, exit 2.
  2. Skema JSON tidak sesuai. Aktual: `{ok, result, session_id, turn_id, steps, usage:{input_tokens,output_tokens}, error}`. PRD 8.1 butuh `text`, `usage`, `sessionId`, `taskId`, `status`, `error`; PRD 10.12 butuh `ok`, `result`, `usage`, `cost`, `session_id`, `task_id`, `error`, `artifacts`. `text` tidak ada (namanya `result`), `task_id`, `status`, `cost`, dan `artifacts` tidak ada, dan `usage` tidak memuat biaya.
  3. `stream-json` hanya mengeluarkan `message.delta`, `tool.start`, `tool.end`, `turn.end`, `error`. Tidak ada `turn.start`, `plan.update`, atau `approval.request` kecuali approval benar-benar diminta. Diuji: hanya 2 baris untuk turn tanpa tool.
  4. Exit code tidak mengikuti 13.4. `errors.ts:36-68` memetakan `E_BUDGET_EXHAUSTED` ke 4 (PRD: 5), `E_NOT_FOUND` ke 6 (PRD: 6 adalah konflik state), `E_CONFLICT` ke 9 (tidak ada di tabel), `E_PERMISSION`/`E_APPROVAL_REQUIRED` ke 5 (PRD: 3), `E_CANCELLED` ke 8 dan `E_TIMEOUT` ke 7 (tidak ada di tabel). Exit 3 hanya muncul dari `E_CONFIG_INVALID`, bukan dari approval; 124, 130, dan 143 tidak pernah dipakai eksplisit.
  5. Flag yang diwajibkan tidak ada: `--max-turns`, `--timeout`, `--allow-tool`, `--allow-pattern`, `--permission-mode`, `--approval-timeout`. `--permission` ada, tetapi bukan nama yang diminta. Karena parser tidak mengenalinya, nilainya bocor ke prompt: `rann -p halo --max-turns 1 --timeout 5 --allow-tool shell_run --json` mengirim prompt `1 5 shell_run` (diuji, exit 0), bukan `halo`.
  6. Jalur gagal dapat menggantung. Dengan `budget.max_tokens_per_turn=1`, `-p ... --output-format json` tidak menghasilkan apa pun dan tidak keluar; `timeout 45` membunuhnya dengan 124. Penyebab: `agent.ts:353-358` melempar `E_BUDGET_EXHAUSTED` di dalam loop, lalu `catch` di `agent.ts:477-483` memanggil `finalize("failed")` tanpa `publish("turn.failed")`, sehingga `stream.ts` tidak pernah menerima event terminal dan hanya menunggu timer 600 detik.
- Tes yang belum ada: matriks 4 format output; validasi skema JSON dengan Zod untuk kasus sukses dan gagal; setiap kode error dipetakan ke exit yang benar; turn gagal selalu menghasilkan objek `{ok:false,...}` dalam ≤ 1 detik; `--timeout` menghasilkan 124 dan state tersimpan.

### RC-FR-015. Piped input dan output

- Ringkasan: stdin non-TTY dibaca sebagai konteks; stdout hanya hasil, log ke stderr; output bisa dipipe ke `jq`/`grep`; input biner ditolak; gambar lewat `@file`; SIGPIPE ditangani tanpa stack trace.
- Status: **partial**
- Bukti: `readPipedStdin` di `main.ts:338-345`; penggabungan konteks di `main.ts:348-349`; pencetakan `sesi <id>` ke stdout di `main.ts:367`; blok `[tool]` ke stdout di `stream.ts:139-148`.
- Kekurangan:
  1. Stdin hanya dibaca bila prompt diberikan lewat argumen/`-p`. `printf 'halo' | rann` mencetak help (diuji, exit 0).
  2. stdout tercemar. Diuji pada sesi baru: baris pertama stdout adalah `sesi ses_...`, lalu jawaban. Blok `[tool]` juga ke stdout. Ini melanggar "stdout bersih" dan merusak `rann -p ... | jq`.
  3. Input biner tidak ditolak. Diuji dengan 200 byte `/dev/urandom`: seluruh byte di-decode UTF-8 dengan karakter pengganti dan dikirim ke model, exit 0.
  4. Tidak ada penanganan `EPIPE` eksplisit. Uji `... | head -1` tidak menghasilkan stack trace, tetapi karena kebetulan buffer menampung tulisan; tidak ada jaminan.
  5. Konteks stdin dipotong silent pada 200.000 karakter (`main.ts:349`) tanpa memberi tahu pengguna; batas PRD untuk lampiran adalah 20 MB/50 MB, bukan 200 ribu karakter.
- Tes yang belum ada: `printf 'a\nb\n' | rann -p "ringkas"` dengan stdout hanya jawaban; `--output-format json` bisa diparse `jq` tanpa praproses; input biner ditolak dengan `E_UNSUPPORTED`; pipe tertutup tidak menghasilkan stack trace; input > batas ditolak dengan pesan, bukan dipotong diam-diam.

### RC-FR-016. Tema dan aksesibilitas

- Ringkasan: tema `dark`, `light`, `auto`, `custom` dengan token warna; kontras ≥ 4.5:1; status tidak hanya warna; `NO_COLOR`, `FORCE_COLOR`, `--no-color` dihormati; mode `screen-reader` menonaktifkan animasi dan menambah label.
- Status: **partial**
- Bukti: `ui.ts:1-2` mematikan warna bila `NO_COLOR` ada atau `TERM=dumb` atau `RANN_NO_COLOR=1`; `COLOR_ENABLED` juga mensyaratkan `stdout.isTTY`, sehingga `FORCE_COLOR=1` pada pipe diabaikan: diuji `FORCE_COLOR=1 rann doctor > file`, 0 byte ESC. Enam helper warna di `ui.ts:8-15`; label `OK/WARN/FAIL` di `main.ts:274` sehingga status tidak hanya warna.
- Kekurangan: tidak ada sistem token, tidak ada tema, tidak ada `--theme`, tidak ada `--accessible`, `FORCE_COLOR` dan `--no-color` tidak dibaca (keduanya diabaikan tanpa error), tidak ada mode screen-reader, tidak ada pengukuran kontras. `ui.color` di config (`config.ts:97`) tidak pernah dipakai CLI.
- Tes yang belum ada: `NO_COLOR=1` tidak menghasilkan ESC; `FORCE_COLOR=1` pada pipe tetap berwarna; `--no-color` setara `NO_COLOR`; tema terang memenuhi kontras 4.5:1; `--accessible` menghilangkan spinner dan menambah label.

### RC-FR-017. Shell passthrough

- Ringkasan: `!<command>` menjalankan shell tanpa model; `!!<command>` mengirim output sebagai konteks; cwd project; policy izin sama dengan tool shell; exit code dan pemotongan output; perintah berbahaya tetap minta konfirmasi.
- Status: **missing**
- Bukti: tidak ada parsing `!` di `main.ts:512-582`; baris `!ls -la` jatuh ke cabang "kirim ke model".
- Kekurangan: seluruh requirement tidak terpenuhi. Tidak ada `!!`, tidak ada eksekusi lokal, tidak ada audit, tidak ada pemotongan artefak.
- Tes yang belum ada: `!ls` tidak memanggil provider; `!!git diff` menambahkan output ke konteks; `!rm -rf` meminta konfirmasi; exit code ditampilkan; output > 10.000 karakter dipotong dengan rujukan artefak.

### RC-FR-018. Project dan session switching

- Ringkasan: `/project` daftar dan pindah; pindah memuat `RANN.md`, config, indeks; `/sessions` per project dengan status dan waktu; `/resume <id>` membuka sesi lain tanpa menutup yang sekarang; draft tidak hilang.
- Status: **partial**
- Bukti: `/sessions` di `main.ts:574-578` (10 sesi, penanda `*`); `rann new`, `rann sessions --all`, `rann chat --session <id>` (`main.ts:453-464`); `/new` mengganti `sessionId` (`main.ts:538-549`).
- Kekurangan:
  1. Tidak ada `/project`. Tabel `projects` ada dan terisi otomatis saat sesi dibuat (`packages/storage/src/repos.ts:80-87`), tetapi tidak ada command untuk daftar, pindah, trust, atau untrust.
  2. Tidak ada pemuatan ulang `RANN.md`/config saat pindah; config dibaca sekali oleh daemon saat start.
  3. `/sessions` hanya 10 sesi, tanpa status/waktu, tanpa filter project selain cwd.
  4. `/resume <id>` tidak ada di REPL. `rann resume` mengirim prompt baru, bukan membuka sesi lain sambil mempertahankan sesi aktif.
  5. Draft input tidak ada karena input tidak pernah disimpan sebagai draft.
- Tes yang belum ada: `/project switch` mengubah header dan memuat `RANN.md` project baru; `/sessions` menampilkan status + waktu; `/resume id` mempertahankan sesi lama di daemon; draft bertahan setelah perpindahan.

### RC-FR-019. Lampiran dan multimodal input

- Ringkasan: `@path` melampirkan file dengan validasi workspace; PNG/JPEG/WebP/GIF/PDF/teks; artefak dengan hash, bukan base64 di DB; model non-multimodal menerima ekstraksi teks atau ditolak dengan saran; batas 20 MB per lampiran dan 50 MB per turn.
- Status: **missing**
- Bukti: tidak ada parsing `@` di CLI. Skema `session.send` tidak punya field lampiran (`packages/shared/src/rpc.ts:58-64`). Tidak ada tipe MIME, validasi path, hash, atau tabel artefak (direktori `artifacts` dibuat di `paths.ts:46,59` tetapi tidak dipakai kode lain).
- Kekurangan: seluruh requirement tidak terpenuhi. Tidak ada cara mengirim gambar sama sekali, bahkan lewat CLI non-interaktif.
- Tes yang belum ada: `@gambar.png` mengirim bagian image ke provider vision; path di luar workspace ditolak; file 21 MB ditolak; PDF diekstrak jadi teks untuk model non-vision; artefak menyimpan hash dan pesan hanya merujuk id.

### RC-FR-020. Help dan error contract

- Ringkasan: `/help`, `/help <command>`, `rann --help` dari registry yang sama; setiap error punya kode stabil, pesan, saran, `traceId`; `--debug` membuka detail; error izin menjelaskan cara mengubah izin; pesan Indonesia dan bisa Inggris.
- Status: **partial**
- Bukti: kode error stabil dan pesan Indonesia di `packages/shared/src/errors.ts:36-135`; output error di `main.ts:1009-1013` (`rann: <kode>: <pesan>`); help hardcoded di `main.ts:13-46`; `--help` berfungsi (exit 0).
- Kekurangan:
  1. Help bukan dari registry. `HELP` adalah string literal di `main.ts:13-46`; `/help` di REPL string lain lagi (`main.ts:515-517`). Tidak ada `/help <command>`.
  2. Tidak ada `traceId`. `grep -rn "traceId|trace_id"` di `packages/*/src` nol hasil.
  3. Tidak ada saran tindakan pada error. Contoh: `E_TURN_NOT_FOUND: Turn tidak ditemukan: turn_tidakada` tanpa langkah berikutnya.
  4. `--debug` tidak ada (`grep -rn "debug" packages/cli/src` nol hasil); flag ini diterima parser sebagai flag tak dikenal dan diabaikan.
  5. Error izin tidak menjelaskan cara mengubah izin. Tidak ada `/permissions`, dan pesan hanya `E_APPROVAL_REQUIRED`.
  6. Tidak ada i18n. `ui.language` ada di skema config (`config.ts:98`) tetapi tidak dibaca kode mana pun.
  7. Pesan error tidak selalu punya kode: slash command tak dikenal hanya mencetak `perintah tidak dikenal: /x. Coba /help` (`main.ts:579-581`), bukan `E_UNKNOWN_COMMAND` seperti RC-AC-020. Diuji lewat pipe, `/tidakada` malah dikirim ke model dan dijawab `Balasan mock: /tidakada`.
- Tes yang belum ada: `/help`, `/help model`, dan `rann --help` memuat entri yang identik dari registry; setiap error memuat kode + saran + traceId; `--debug` menambah stack trace; tanpa `--debug` tidak ada path internal; `E_UNKNOWN_COMMAND` dengan saran Levenshtein; pesan berubah bahasa saat `ui.language=en`.

## 3. Slash command registry (dokumen 02 bagian 11)

### 3.1 Kontrak definisi command (11.1)

Tidak ada satu pun elemen kontrak yang terpenuhi.

| Elemen | Kondisi aktual |
|---|---|
| `name`, `aliases`, `category` | Tidak ada objek command. Dispatch berupa `switch` 19 string (`main.ts:93-141`) dan rantai `if` 9 slash (`main.ts:514-582`). |
| `description` | Hanya teks bebas di string `HELP`. |
| `args: ZodSchema`, `options` | Tidak ada. Parser global `args.ts` menerima flag apa pun tanpa skema. |
| `permission` | Tidak ada per command. Mode izin hanya per sesi (`--permission`). `/permission` di REPL tidak memvalidasi terhadap registry. |
| `handler` | Ada, tetapi inline dan tidak terdaftar. |
| `output` (`text/json/markdown`) | Tidak ada. Sebagian command punya `--json` ad hoc. |
| `errors` | Tidak ada map kode → pesan per command. |
| `help` | Tidak ada per command. |
| `hidden`, `plugin` | Tidak ada. |
| Validasi saat start, `rann doctor` gagal bila command invalid | Tidak ada. `doctor` hanya memeriksa node, home, daemon, database, config, provider key (`main.ts:205-281`). |
| Timeout handler 30 detik | Tidak ada. |
| Audit eksekusi command | Tidak ada. `appendAudit` tidak pernah dipanggil. |
| Dokumentasi dari definisi yang sama | Tidak ada; help dan dokumen ditulis manual. |

### 3.2 Cakupan per kategori

Kolom S = ada handler slash di REPL, C = hanya ada padanan subcommand CLI (sering lebih sempit atau beda semantik), `-` = tidak ada.

| Kategori | Baris | S | C | - | Catatan |
|---|---|---|---|---|---|
| General | 12 | 4 | 2 | 6 | `clear`, `compact`, `improve`, `feedback`, `update`, `whatsnew` tidak ada. |
| Model dan provider | 10 | 2 | 3 | 5 | `cost`, `budget`, `route`, `login`, `logout` tidak ada; tidak ada keychain. |
| Agent | 14 | 0 | 0 | 14 | Tidak ada task/plan/approve/deny; RPC juga tidak punya method `task.*`/`plan.*`. |
| Memory | 5 | 0 | 4 | 1 | `profile` tidak ada; `remember`/`recall`/`forget` hanya lewat `rann memory`. |
| Skills | 5 | 0 | 3 | 2 | `install-skill`, `update-skill` tidak ada. |
| Tools/MCP/plugin/hook | 5 | 1 | 0 | 4 | `/tools` hanya mencetak string statis (`main.ts:528-531`), tidak membaca runtime. |
| Project | 16 | 0 | 1 | 15 | Hanya `init`. Tidak ada `review`, `test`, `git`, `diff`, `commit`, `index`, `search`. |
| Sessions | 10 | 2 | 1 | 7 | `resume` semantiknya salah; `fork`, `rename`, `history`, `rewind`, `export`, `import`, `attach` tidak ada. |
| Configuration | 7 | 0 | 1 | 6 | Hanya `config get/set/explain`; tidak ada `permissions`, `theme`, `secrets`, `env`, `sandbox`. |
| Infrastructure | 13 | 0 | 0 | 13 | Tidak ada `gateway`, `scheduler`, `background`, `logs`, `health`, `metrics`, `dashboard`, `whoami`. |
| **Total** | **97** | **9** | **15** | **73** | |

Nama yang benar-benar punya handler slash: `/help`, `/exit`, `/quit`, `/status`, `/model`, `/tools`, `/usage`, `/sessions`, `/new`. `/permission` ada tetapi bukan nama di PRD (PRD memakai `/permissions`). `/q` hanya alias di dalam cabang `if`, bukan baris tabel.

### 3.3 Ketidaksesuaian angka

`docs/prd/02-cli-ux-and-commands.md:455` menyatakan "84 nama utama, 27 alias", sedangkan tabel 11.2 berisi 97 baris dan 62 token alias (61 unik). `IMPLEMENTATION-ROADMAP.md:141` memakai angka 97. Untuk audit ini saya memakai 97 baris tabel sebagai daftar acuan; PRD perlu menetapkan satu angka sebelum M3 dimulai, karena definition of done M3 berbunyi "seluruh command di registry muncul di `/help` dan bisa dipanggil".

### 3.4 Parser argumen dan flag

`args.ts` adalah parser longgar tanpa skema:

- `SUBCOMMAND_COMMANDS` hanya 6 nama (`args.ts:8`); `daemon`, `config`, `provider`, `db`, `memory`, `skill`. Command lain tidak punya subcommand, sehingga `rann sessions --all` bergantung pada flag, bukan subcommand.
- `VALUE_FLAGS` adalah daftar tertutup 24 nama (`args.ts:10-35`). Flag di luar daftar dianggap boolean dan token berikutnya menjadi positional.
- Dampak nyata: `rann -p "prompt asli" --theme dark --json` mengirim prompt `"dark"`, bukan `"prompt asli"`, karena `--theme` dianggap boolean, `dark` masuk positional, dan positional menimpa `-p` (`main.ts:83-85`). Diuji, hasilnya `Balasan mock: dark`. PRD 10.12 memang menetapkan positional menang, tetapi `-p` harus menjadi konteks tambahan; di kode, `-p` dibuang seluruhnya.
- Pola yang sama merusak prompt untuk semua flag bernilai yang belum dikenal: `rann -p halo --max-turns 1 --timeout 5 --allow-tool shell_run --json` mengirim `1 5 shell_run` dan mengabaikan ketiga batas itu tanpa error (diuji, exit 0).
- Tidak ada validasi jumlah argumen per command. `rann memory remove` tanpa id baru gagal setelah membuka daemon.
- `--` didukung untuk memisahkan positional (`args.ts:65-68`), tetapi nilai `-p` yang diawali tanda hubung disimpan sebagai `true`, bukan sebagai teks prompt (`args.ts:69-78`).

### 3.5 Semantik command khusus (11.3)

Delapan command di 11.3 punya kontrak perilaku yang lebih ketat daripada sekadar "ada". Ringkasnya:

| Command | Yang diminta 11.3 | Aktual |
|---|---|---|
| `/model` | `auto`, `--pin`, `/models --cap tool,vision`, tolak model tak dikenal dengan saran, peringatan model tanpa tool | Hanya `/model` (daftar) dan `/model <nama>` (`main.ts:550-560`). Tidak ada `auto`, `--pin`, filter kapabilitas, validasi nama, atau peringatan tool-less. |
| `/provider` | Wizard `add`, `test` dengan latensi/auth/streaming, `remove` non-destruktif | Tidak ada di REPL. CLI punya `provider add/test` (`main.ts:93-141`) tetapi bukan command slash dan tidak memakai wizard. |
| `/delegate` | Subagent dengan profil, `--wait`/`--detach`, agregasi hasil ke parent | Tidak ada. Tidak ada RPC `subagent.*`; event `subagent.*` ada di `events.ts` tanpa penghasil. |
| `/plan` | `new`, `edit`, `approve`, `show --json` (DAG) | Tidak ada. Tidak ada tabel/event plan. |
| `/memory` | Subcommand dengan id `mem_`, `edit`, `rm --confirm`, skor FTS/vektor | Tidak ada di REPL; hanya `rann memory list/get/add/remove/search` yang menulis langsung ke DB (`packages/runtime/src/rpc.ts` method `memory.*`). |
| `/permissions` | `mode`, `allow`, `deny`, `test` dengan penjelasan rule | Tidak ada. Hanya `/permission <mode>` yang mengubah variabel lokal. |
| `/gateway` | `start`, `token` sekali-tampil, pairing | Tidak ada. |
| `/scheduler` | `add` cron/interval, timezone, retry, notifikasi | Tidak ada. |

Konsekuensinya, 15 baris "C" di tabel 3.2 bukan pengganti: subcommand CLI tidak memenuhi kontrak slash yang diminta, terutama untuk `/provider`, `/memory`, dan `/model`.

## 4. Temuan lintas-FR (defect yang terlihat pengguna)

Semua di bawah ini direproduksi, bukan dugaan.

1. **Mode JSON menggantung saat turn gagal tanpa event terminal.** `budget.max_tokens_per_turn=1` lalu `rann -p "halo" --output-format json` tidak mencetak apa pun dan tidak keluar; `timeout 45` → exit 124. Akar: `agent.ts:353-358` melempar `E_BUDGET_EXHAUSTED`, `agent.ts:477-483` hanya `finalize` tanpa `publish("turn.failed")`, `stream.ts:124-183` menunggu selamanya sampai timer 600 detik. Dampak: otomasi CI bisa menggantung 10 menit per kegagalan.
2. **Ctrl+D tidak menutup REPL.** EOF saat idle menggantung (exit 124 setelah 8 detik); EOF setelah satu baris menghasilkan `rann: E_INTERNAL: Aborted with Ctrl+D`. Dampak: REPL tidak bisa ditinggalkan tanpa `/exit`.
3. **stdout tidak bersih.** Baris `sesi <id>` (`main.ts:367`) dan blok `[tool]` (`stream.ts:139-148`) ditulis ke stdout, sehingga `rann -p ... | jq` gagal pada mode teks dan pipeline mencampur hasil dengan status.
4. **Approval non-interaktif tidak menghasilkan exit 3.** Tool ditolak otomatis, model melanjutkan, exit 0. PRD 10.8 dan ARCHITECTURE 13.4 mewajibkan 3.
5. **Tabel exit code menyimpang dari 13.4.** `E_BUDGET_EXHAUSTED`=4, `E_CONFLICT`=9, `E_NOT_FOUND`=6, `E_PERMISSION`=5, `E_CANCELLED`=8, `E_TIMEOUT`=7; exit 3 hanya dari `E_CONFIG_INVALID` (bukan approval), dan 124/130/143 tidak pernah dipakai.
6. **Audit log tidak pernah ditulis.** `audit_log` dan `appendAudit` ada, tetapi nol pemanggil. Keputusan approval, eksekusi command, dan shell passthrough tidak tercatat.
7. **Folder log kosong.** `doctor` dan pesan `E_DAEMON_DOWN` merujuk `profiles/<p>/logs`, tetapi daemon tidak menulis log ke sana. Saat `better-sqlite3` gagal dimuat, pengguna hanya melihat "cek log" tanpa isi.
8. **Input biner diterima.** 200 byte acak dikirim ke model sebagai teks dengan karakter pengganti, exit 0. PRD 8.1 butuh penolakan jelas.
9. **Nol tes CLI.** 52 tes lulus, tidak satu pun menyentuh `packages/cli`. Tidak ada tes untuk parser, exit code, format output, atau REPL.
10. **Nilai flag tak dikenal bocor ke prompt.** `-p halo --max-turns 1 --timeout 5 --allow-tool shell_run --json` mengirim `1 5 shell_run`, bukan `halo`, dan tidak menolak satu flag pun. Batas keamanan yang diminta PRD hilang diam-diam.

## 5. Prioritas dan estimasi

Estimasi dalam LOC bersih (bukan hari-orang); asumsi satu implementasi penuh per butir tanpa desain ulang arsitektur.

Label P0/P1 di bawah adalah prioritas implementasi menurut audit ini, bukan Prioritas PRD. FR-005, 006, 008, 010, 013, dan 019 tetap P0 di PRD tetapi tidak memblokir M3 atau otomasi, sehingga ditempatkan di gelombang kedua.

### P0. Menutup kontrak yang memblokir M3 dan otomasi

| Butir | FR | Berkas yang disentuh | Estimasi |
|---|---|---|---|
| Command registry + `CommandDefinition` + validasi start + `/help` dari registry + `doctor` memeriksa command | 002, 020 | baru `packages/cli/src/commands/registry.ts`, `commands/types.ts`; ubah `main.ts`, `doctorCommand` | 350-450 |
| Handler untuk 97 command (atau subset yang disepakati) dengan skema Zod, permission, output, error map | 002 | baru `commands/general.ts`, `model.ts`, `agent.ts`, `memory.ts`, `skills.ts`, `tools.ts`, `project.ts`, `sessions.ts`, `config.ts`, `infra.ts` | 1.800-2.600 |
| Loader command kustom `.rann/commands/*.md` + validasi frontmatter + konflik nama | 002 | baru `commands/custom.ts` | 150-200 |
| Palette + fuzzy + autocomplete kontekstual + saran terdekat | 003 | baru `repl/palette.ts`, `repl/fuzzy.ts`; ubah `main.ts` | 350-450 |
| Perbaiki kontrak non-interaktif: `ndjson`, skema JSON (`text`, `task_id`, `status`, `cost`, `artifacts`), event `turn.start`, jangan menggantung saat gagal | 007, 014, 015 | `stream.ts`, `main.ts`, `packages/runtime/src/agent.ts` (publish di semua jalur gagal) | 200-300 |
| Tabel exit code sesuai 13.4 + exit 3 untuk approval non-interaktif + 124 untuk timeout | 011, 014 | `packages/shared/src/errors.ts`, `stream.ts`, `main.ts` | 80-120 |
| stdout bersih: status/log ke stderr, `sesi` dan `[tool]` tidak ke stdout | 015 | `main.ts`, `stream.ts`, `ui.ts` | 50-80 |
| REPL: Ctrl+D benar, `rann` tanpa argumen di pipe membaca stdin, Ctrl+C tiga tekan, status turn | 001, 012 | `main.ts` (atau `repl/session.ts` baru) | 150-250 |
| Parser argumen ketat: tolak flag tak dikenal, jangan biarkan nilai flag menimpa prompt | 001, 014, 020 | `args.ts` | 120-180 |

### P1. Membuat CLI layak dipakai harian

| Butir | FR | Berkas | Estimasi |
|---|---|---|---|
| Input multiline + `$EDITOR` + batas 100k + paste | 005 | baru `repl/editor.ts`; `main.ts` | 200-300 |
| History persisten per project/profil + `/history` + redaksi | 006 | baru `repl/history.ts` | 150-220 |
| Streaming: buffer 16 ms, marker `[stream terputus]`, reasoning terpisah, Markdown | 007 | `stream.ts`, baru `render/markdown.ts` | 300-450 |
| Tool block lengkap: args, durasi, ringkasan, diff, exit code, Ctrl+O, artefak | 008 | `stream.ts`, baru `render/tool-block.ts` | 250-350 |
| Approval panel: diff/cwd/domain, 4 pilihan, Esc, timeout, audit | 011 | baru `render/approval.ts`; `packages/runtime/src/rpc.ts` | 250-350 |
| Status bar + context % + biaya (`$?`) + zona + config matikan | 010 | baru `render/status-bar.ts`; `packages/runtime/src/agent.ts` (cost), `storage` | 200-300 |
| Resize: SIGWINCH, ambang lebar, prompt ASCII, lebar sel CJK/emoji | 013 | `ui.ts`, baru `render/layout.ts` | 180-260 |
| Tema/token + `--no-color`/`FORCE_COLOR` + `--accessible` | 016 | baru `theme.ts`; `ui.ts` | 150-220 |
| `@` lampiran + protokol attachments + artefak hash + batas ukuran | 019 | `main.ts`, `packages/shared/src/rpc.ts`, `packages/runtime/src/rpc.ts`, `storage` | 300-450 |
| `!`/`!!` shell passthrough + policy + audit | 017 | `main.ts`, `packages/runtime/src/tools` | 120-180 |
| `/project` + registry project + reload `RANN.md`/config | 018 | `main.ts`, `packages/runtime/src/{rpc,daemon}.ts`, `storage` | 200-300 |
| Task progress + `/tasks` (butuh M4) | 009 | bergantung `tasks`/`plans`; `render/progress.ts` | 150-250 setelah M4 |

### P2. Penyempurnaan

| Butir | FR | Berkas | Estimasi |
|---|---|---|---|
| `/help keys` dan tabel kapabilitas terminal | 004 | `commands/general.ts`, `render/layout.ts` | 60-90 |
| i18n `ui.language` untuk seluruh pesan | 020 | `packages/shared/src/errors.ts`, `ui.ts`, `commands/registry.ts` | 150-220 |
| `/feedback`, `/update`, `/whatsnew`, `/improve` | 002 | `commands/general.ts` | 80-120 |
| Preview tema dan validasi kontras otomatis | 016 | `theme.ts`, tes | 80-120 |
| Snapshot test 20 layar utama dengan PTY | semua | `packages/cli/test/snapshots/*` | 250-350 |
| Telemetri durasi per fase tool dan panel aktivitas satu baris (10.2, 10.6) | 008 | `render/tool-block.ts`, `packages/runtime/src/tools/index.ts` | 100-160 |

### Berkas baru dan perubahan minimum untuk M3

Baru:
- `packages/cli/src/commands/{registry,types,custom,general,model,agent,memory,skills,tools,project,sessions,config,infra}.ts`
- `packages/cli/src/repl/{session,palette,fuzzy,editor,history}.ts`
- `packages/cli/src/render/{markdown,tool-block,approval,status-bar,layout,progress}.ts`
- `packages/cli/src/theme.ts`
- `packages/cli/test/*.test.ts` (tidak ada satu pun saat ini)

Diubah:
- `packages/cli/src/main.ts` (1.013 baris; dispatch dan REPL perlu dipecah, bukan ditambah)
- `packages/cli/src/{args,ui,stream}.ts`
- `packages/cli/package.json` (bila memilih Ink/React; saat ini nol dependensi UI)
- `packages/shared/src/{errors,rpc,events,config}.ts`
- `packages/runtime/src/{rpc,agent}.ts` (method task/plan, attachments, publish di semua jalur gagal, cost)

## 6. Lampiran: bukti perintah

Ringkas, dengan `RANN_HOME` terisolasi dan provider mock.

```
$ node packages/cli/dist/main.js --help
rann-code 0.1.1

Pemakaian:
  rann "instruksi"              kirim tugas ke sesi terbaru, buat sesi baru kalau perlu
  rann chat                     sesi interaktif (REPL)
  rann -p "instruksi"           sama, gaya non-interaktif
  ... 21 baris pemakaian, termasuk provider add/test dan config get/explain/set

Flag umum:
  --model <nama>        override model
  --permission <mode>   read-only | ask | accept-edits | trusted | custom
  --yes                 setujui otomatis semua permintaan tool
  --detach              jalankan turn di latar, langsung cetak id turn
  --output-format <f>   text | json | stream-json
  --json                keluaran JSON
  -v, --version         versi
  -h, --help            bantuan
(help tidak memuat --debug, --timeout, --max-turns, --allow-tool, --no-color, --theme)
exit 0

$ node packages/cli/dist/main.js -p "halo, jawab satu kalimat" --output-format json
{"ok":true,"result":"Balasan mock: halo, jawab satu kalimat","session_id":"ses_...","turn_id":"turn_...","steps":1,"usage":{"input_tokens":6,"output_tokens":10},"error":null}
exit 0

$ node packages/cli/dist/main.js -p tes --output-format ndjson
rann: E_INVALID_PARAMS: output-format tidak dikenal: ndjson. Pakai text, json, atau stream-json.
exit 2

$ printf 'baris satu\nbaris dua\n' | node packages/cli/dist/main.js -p "ringkas konteks" --output-format json
{"ok":true,"result":"Balasan mock: ringkas konteks\n\nKonteks tambahan dari stdin:\nbaris satu\nbaris dua", ...}
exit 0

$ printf 'halo dari pipe\n' | node packages/cli/dist/main.js
rann-code 0.1.1 ... (teks bantuan)
exit 0

$ node packages/cli/dist/main.js tidakada
Balasan mock: tidakada
exit 0

$ printf '/tidakada\n' | node packages/cli/dist/main.js chat
Balasan mock: /tidakada
exit 0

$ node packages/cli/dist/main.js -p "halo"        # sesi baru, mode teks
sesi ses_...
Balasan mock: halo
exit 0

$ node packages/cli/dist/main.js -p 'tool:shell_run {"command":"echo halo"}'
[tool] shell_run
[tool] shell_run error
[izin] shell_run butuh persetujuan, tapi sesi ini non-interaktif. Ditolak.
Balasan mock: tool:shell_run {"command":"echo halo"}
exit 0

$ node packages/cli/dist/main.js -p "prompt asli" --theme dark --json
{"ok":true,"result":"Balasan mock: dark", ...}

$ node packages/cli/dist/main.js -p "halo lagi" --output-format json   # budget.max_tokens_per_turn=1
(tidak ada output; timeout 45 membunuh proses)
exit 124

$ printf 'halo\n' | TERM=dumb script -qec "node packages/cli/dist/main.js chat" /dev/null
Rann Code  /root/rann-code
sesi ses_...  model mock-1  izin ask
ketik /help untuk perintah, /exit untuk keluar
› halo
Balasan mock: halo
› rann: E_INTERNAL: Aborted with Ctrl+D

$ timeout 8 script -qec "node packages/cli/dist/main.js chat" /dev/null < /dev/null
exit 124   # EOF tidak menutup REPL

$ head -c 200 /dev/urandom | node packages/cli/dist/main.js -p "baca" --json
{"ok":true,"result":"Balasan mock: baca\n\nKonteks tambahan dari stdin:\n<200 byte biner sebagai teks>", ...}
exit 0

$ node packages/cli/dist/main.js doctor
OK   node         v22.23.3 (butuh >= 22.11)
OK   home         /root/.../rann-home-e mode 700
OK   daemon       pid 2771957, socket aktif
OK   database     skema 2, quick_check ok
OK   config       1 berkas, provider mock, mode ask
OK   provider-key mock tidak butuh key

instalasi siap dipakai
exit 0

$ node packages/cli/dist/main.js turn turn_tidakada
rann: E_TURN_NOT_FOUND: Turn tidak ditemukan: turn_tidakada
exit 6
```
