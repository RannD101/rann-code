# Audit 151 FR

Tanggal: 2026-11-08. Total: 151. done: 7, partial: 140, missing: 4.

Status done berarti seluruh butir requirement dan acceptance terpenuhi dengan bukti kode atau tes.

## RC-FR-001 REPL interaktif [partial]
Bukti: packages/cli/src/main.ts:124-130 tanpa argumen hanya membuka chat jika stdin dan stdout TTY, selain itu mencetak help; packages/cli/src/main.ts:1142-1145 header mencetak cwd, branch, session id pendek, model, mode izin, dan profil; packages/cli/src/main.ts:1035-1050 LineEditor diberi prompt status, palette, completer, history, dan callback busy; packages/cli/src/main.ts:901-913 ekstraksi @path; main.ts:1262-1285 shell ! dan !!; main.ts:2110-2134 lampiran /attach; packages/cli/src/stream.ts:74-84 spinner mengirim dan menunggu model; stream.ts:262-267 spinner tool; packages/cli/src/line-editor.ts:684-705 Ctrl+D menutup REPL hanya saat buffer kosong; packages/cli/src/main.ts:1110-1116 saat sibuk Ctrl+D menawarkan tunggu, batalkan, atau keluar
Gap:
- Butir 1: `rann` tanpa argumen dengan stdout bukan TTY mencetak help (main.ts:128-130), bukan menjalankan mode non-interaktif.
- Butir 4: fase status hanya mengirim, menunggu model, dan menjalankan tool (stream.ts:74-84, 262-267); tidak ada fase memverifikasi dan selesai.
- Butir 5: Ctrl+D saat turn berjalan hanya menawarkan tunggu, batalkan, atau keluar (main.ts:1110-1116); tidak ada pilihan membiarkan turn berjalan di background.
- AC: header baru dicetak setelah ensureDaemon dan session.create (main.ts:918-960), sehingga tampil dalam 1 detik tidak dijamin dan tidak diuji.

## RC-FR-002 Slash command registry [partial]
Bukti: packages/cli/src/repl-commands.ts:17-33 ReplCommand menyimpan nama, alias, usage, deskripsi, kategori, permission, arguments, optionalParams, output, errors, handler, docs, available, source; packages/cli/src/repl-commands.ts:44-77 arguments dan optionalParams diturunkan dari usage, output dan errors diisi untuk registry; packages/cli/src/repl-commands.ts:195-209 registerCommands mencatat konflik dan menimpa entri lama; packages/cli/src/custom-commands.ts:132-158 loadCustomCommands memuat global dan project, project menang, nama inti ditolak; packages/cli/src/main.ts:945-951 direktori ~/.rann/commands dan .rann/commands dimuat ulang saat pindah project; packages/cli/src/main.ts:1038-1050 palette dibangun dari REPL_COMMANDS yang tersedia dan command kustom; packages/cli/src/line-editor.ts:484-486 Ctrl+K membuka palette; line-editor.ts:756-768 palette memakai fuzzy dan batas 12 item; packages/cli/src/custom-commands.test.ts:57-70 memuat global dan project dengan prioritas project; packages/cli/src/custom-commands.test.ts:72-78 menolak nama yang bentrok dengan command inti
Gap:
- Butir 2: mengetik `/` tidak membuka palette; palette hanya dibuka Ctrl+K (line-editor.ts:484-486), sedangkan `/` hanya disisipkan sebagai karakter biasa.
- Butir 3: palette menyaring command tidak tersedia (main.ts:1038) dan opsi `hideUnavailable` tidak ada; daftar lengkap dengan alasan hanya muncul di `/help` (main.ts:1236-1250).
- Butir 4: command project tidak bisa menimpa command bawaan karena loader menolak nama inti (custom-commands.ts:143-146), sehingga prioritas project di atas bawaan tidak berlaku.
- AC: palette tidak muncul saat `/` ditekan, jadi AC palette < 100 ms tidak terpenuhi meskipun pencarian fuzzy di palette berfungsi.

## RC-FR-003 Autocomplete dan fuzzy search [partial]
Bukti: packages/cli/src/repl-commands.ts:230-255 scoreCommand mencocokkan nama, alias, deskripsi, kategori, subsequence, dan typo; packages/cli/src/repl-commands.ts:251-254 hasil difilter skor, diurutkan relevansi, dan dibatasi 50; packages/cli/src/main.ts:1068-1098 completer kontekstual untuk model, provider, permission, theme, resume/history, skill, dan path; packages/cli/src/line-editor.ts:820-875 panah memindahkan pilihan overlay, Tab melengkapi, Enter memilih, Esc menutup; packages/cli/src/main.ts:1339-1342 command slash tak dikenal menampilkan tiga saran terdekat; packages/cli/src/repl-commands.test.ts:20-28 mencari perintah dengan typo dan sinonim; packages/cli/src/repl-commands.test.ts:30-34 melengkapi nama perintah untuk readline
Gap:
- Butir 2: autocomplete tidak mencakup task dan MCP server; cabang kontekstual hanya model, provider, permission, theme, resume/history, skill, attach/files/export (main.ts:1068-1098).
- Butir 5: saat Tab tidak menemukan kandidat, line editor hanya render ulang tanpa saran terdekat (line-editor.ts:829-833); saran terdekat hanya untuk command slash tak dikenal (main.ts:1339-1342).

## RC-FR-004 Keyboard shortcuts [partial]
Bukti: packages/cli/src/line-editor.ts:412-515 handleAction menangani Enter, newline, Ctrl+C, Ctrl+D, Ctrl+L, Ctrl+R, Ctrl+O, Ctrl+E, Ctrl+K, panah, PgUp/PgDn; packages/cli/src/line-editor.ts:80-105 peta escape sequence untuk Enter, Shift+Enter, Ctrl+J, Ctrl+R, Ctrl+O, Ctrl+E, Ctrl+K, PgUp, dan PgDn; packages/cli/src/main.ts:1209-1232 `/help keys` menampilkan tabel shortcut dan status; packages/cli/src/main.ts:1015-1025 disabledShortcuts dibaca dari config atau RANN_DISABLED_SHORTCUTS; packages/cli/src/line-editor.ts:39 opsi disabledShortcuts tersedia di LineEditor
Gap:
- Butir 3: PgUp dan PgDn ditandai "pakai scrollback terminal" (main.ts:1229) tetapi tidak dideteksi sebagai tidak tersedia; tidak ada penanda terminal yang tidak mendukung.
- Butir 4: `disabledShortcuts` dibaca (main.ts:1015-1025) tetapi tidak pernah diperiksa di handleAction (line-editor.ts:412-515), sehingga menonaktifkan shortcut tidak berpengaruh.
- AC: setelah dua Ctrl+C membatalkan turn, hitungan siklus tidak dilanjutkan; Ctrl+C ketiga saat idle hanya menampilkan petunjuk, bukan exit 130 (line-editor.ts:630-675).

## RC-FR-005 Multiline input dan editor eksternal [partial]
Bukti: packages/cli/src/line-editor.ts:121 batas MAX_INPUT_CHARS 100.000; packages/cli/src/line-editor.ts:565-574 input di atas batas ditolak dengan pesan memakai lampiran berkas; packages/cli/src/line-editor.ts:460-463 newline menambah baris tanpa submit; packages/cli/src/line-editor.ts:340-380 bracketed paste dan input multi-baris tidak langsung submit; packages/cli/src/line-editor.ts:866-884 Ctrl+E membuka RANN_EDITOR/VISUAL/EDITOR, membatalkan bila exit bukan 0, dan menyimpan hasil ke buffer; packages/cli/src/line-editor.ts:922-990 render multi-baris dengan prefix dua spasi untuk baris lanjutan
Gap:
- Butir 4: multiline hanya diberi prefix dua spasi (line-editor.ts:979); tidak ada indentasi terstruktur atau syntax highlight dasar untuk blok kode di editor.

## RC-FR-006 Input history [done]
Bukti: packages/cli/src/history.ts:31-33 file riwayat diberi hash cwd, sehingga terpisah per project; packages/cli/src/history.ts:42 maxEntries 1.000; packages/cli/src/history.ts:27-29 prompt private dan pola secret ditolak sebelum disimpan; packages/cli/src/history.ts:88-95 add menolak private/secret, menghindari duplikat, dan memotong ke 1.000 entri; packages/cli/src/history.ts:103-110 search memfilter tanggal dan fuzzy; packages/cli/src/line-editor.ts:452-458 panah atas/bawah menelusuri riwayat; line-editor.ts:496-497 Ctrl+R membuka pencarian fuzzy; packages/cli/src/main.ts:2072-2102 `/history` menampilkan daftar, clear, limit, search, since, dan until; packages/runtime/src/paths.ts:52 historyDir berada di profileDir, sehingga terpisah antar profil; packages/cli/src/history.test.ts:20-33 menyimpan dan memuat ulang per proyek; packages/cli/src/history.test.ts:35-48 tidak menyimpan prompt privat atau rahasia; packages/cli/src/history.test.ts:50-56 mencari dengan fuzzy dan batas waktu

## RC-FR-007 Streaming response [partial]
Bukti: packages/cli/src/stream.ts:113-134 buffer teks dan flush setiap 33 ms; packages/cli/src/stream.ts:219-224 message.delta masuk queueText; packages/cli/src/stream.ts:233-241 reasoning.delta ditampilkan sebagai blok [reasoning]; packages/cli/src/stream.ts:166-178 onClose mencetak [stream terputus] dan menyelesaikan turn gagal; packages/cli/src/markdown.ts:33-56 MarkdownStream hanya merender baris yang sudah lengkap; packages/cli/src/markdown.test.ts:20-24 hanya mengeluarkan baris yang sudah selesai
Gap:
- Butir 2: koneksi putus hanya mencetak `[stream terputus]` dan saran `/resume` (stream.ts:166-178); tidak ada pilihan lanjut atau ulangi.
- Butir 3: reasoning ditampilkan sebagai blok `[reasoning]` (stream.ts:233-241) tanpa mekanisme lipat.
- Butir 5: tidak ada reconnect; onClose langsung menyelesaikan turn gagal (stream.ts:166-178), jadi perilaku saat reconnect tidak diimplementasikan.

## RC-FR-008 Live tool execution display [partial]
Bukti: packages/cli/src/stream.ts:245-263 tool.start menampilkan nama, args ringkas, dan diff edit; packages/cli/src/stream.ts:271-286 tool.end menampilkan status, durasi, exit code, dan ringkasan 160 karakter; packages/cli/src/main.ts:1118-1136 Ctrl+O mengambil pesan tool turn terakhir dan menyimpan output > 20.000 karakter sebagai artefak; packages/cli/src/edit-preview.ts:1-80 menghitung diff dan jumlah baris tambah/hapus; packages/cli/src/edit-preview.test.ts:20-35 menghitung baris tambah dan hapus untuk fs_edit dan write_file
Gap:
- Butir 2: output tool tidak ditampilkan dalam keadaan terlipat; yang tampil hanya ringkasan 160 karakter (stream.ts:278-284), output penuh baru diambil saat Ctrl+O dan artefak hanya dibuat jika > 20.000 karakter (main.ts:1128-1136).
- Butir 3: blok shell menampilkan args dan exit code (stream.ts:271-286), tetapi tidak menampilkan working directory.
- Butir 5: tool yang ditolak hanya mengirim status error dan error_code (agent.ts:964), tanpa alasan policy; blok tool.end tidak menampilkan pesan penolakan.

## RC-FR-009 Task dan agent progress [partial]
Bukti: packages/cli/src/stream.ts:290-298 plan.update mencetak status dan jumlah langkah; packages/cli/src/stream.ts:300-316 task.update menghitung selesai, aktif, counter x/y, dan waktu berjalan; packages/runtime/src/plan-runtime.ts:81-100 task queued dan running dipublikasikan; packages/runtime/src/plan-runtime.ts:180-199 task selesai dipublikasikan sebagai done; packages/cli/src/main.ts:2499-2514 `/tasks` menampilkan plan dan status tiap task; packages/runtime/src/plan-runtime.test.ts:75-98 menjalankan task sesuai dependensi DAG dan menandai blocked; packages/runtime/src/plan-runtime.test.ts:121-137 memverifikasi perintah dan file, lalu melaporkan gap
Gap:
- Butir 3: tidak ada penanda `replan`; plan.update hanya menerima status yang dikirim plan runtime (stream.ts:290-298, plan-runtime.ts:81-100).
- Butir 4: counter task done mencapai x/y sebelum verifyPlanLive dijalankan (stream.ts:306-310, agent.ts:791), sehingga 100 persen bisa tampil sebelum verifikasi.
- Butir 5: task background tidak punya notifikasi; `/tasks` hanya membaca plan.list (main.ts:2499-2514).

## RC-FR-010 Status bar [partial]
Bukti: packages/cli/src/main.ts:990-1005 statusPrompt menampilkan model, provider:status, branch, durasi, token, in/out, persen ctx, biaya turn, biaya hari, dan mode izin; packages/cli/src/main.ts:1003 model tanpa harga memakai `$?`; packages/cli/src/main.ts:1000 zona ctx hijau < 50, kuning 50-89, merah >= 90; packages/cli/src/main.ts:1164-1168 status provider diambil dari provider.list; packages/cli/src/main.ts:1006 status prompt disembunyikan saat lebar < 64
Gap:
- Butir 3: hanya tiga zona warna; 50-74 dan 75-89 sama-sama kuning (main.ts:1000), zona oranye tidak ada.
- Butir 4: status provider ditampilkan (main.ts:1164-1168), tetapi fallback yang sedang aktif tidak ditampilkan.
- Butir 5: tidak ada pembacaan config untuk mematikan status bar; yang ada hanya pemendekan saat width < 64 (main.ts:1006).

## RC-FR-011 Approval dialog [partial]
Bukti: packages/cli/src/main.ts:860-886 dialog menampilkan tool, args, target, dampak, dan diff; packages/cli/src/main.ts:888-898 pilihan izinkan sekali, selalu izinkan pola dalam sesi, dan tolak; Enter jatuh ke tolak; packages/cli/src/ui.ts:211-230 chooseWith memakai fallback deny dan menerima n atau Esc sebagai tolak; packages/runtime/src/agent.ts:1117-1127 appendAudit mencatat approval.decision, args, dan remember; packages/runtime/src/rpc.ts:1451-1453 pola approval disimpan per sesi; packages/runtime/src/daemon.test.ts:71-131 meminta izin lewat event dan mengingat pilihan selalu
Gap:
- Butir 1: args dipotong 2.000 karakter di dialog (main.ts:876), jadi args lengkap tidak selalu tampil.
- Butir 2: untuk jaringan, dialog hanya menampilkan target atau URL, bukan metode HTTP (main.ts:860-886).
- Butir 4: audit approval.decision mencatat args dan remember (agent.ts:1119-1125), tetapi tidak mencatat alasan keputusan.

## RC-FR-012 Interrupt, cancel, dan resume [partial]
Bukti: packages/cli/src/line-editor.ts:630-675 Ctrl+C sekali mengosongkan buffer, dua kali dalam 2 detik membatalkan, tiga kali exit 130; packages/cli/src/main.ts:1107-1112 onCancel memanggil session.cancel; packages/runtime/src/rpc.ts:454-459 session.cancel memanggil controller.abort; packages/runtime/src/rpc.ts:1199-1207 pembatalan shell mengirim SIGTERM lalu SIGKILL ke process group; packages/runtime/src/tools/index.ts:573-610 lease file dilepas di finally; packages/runtime/src/agent.ts:863-877 checkpoint pre_tool menyimpan langkah, plan, tool, dan args sebelum tool; packages/cli/src/main.ts:2277-2294 `/resume` membaca checkpoint.latest dan mengirim lanjutan turn yang dibatalkan; packages/runtime/src/rpc.ts:592-596 background.cancel membatalkan job tanpa menghentikan daemon; packages/runtime/src/tools.test.ts:46-72 menolak lease milik sesi lain dan mencatat edit dalam transaksi
Gap:
- AC: setelah dua Ctrl+C membatalkan turn, hitungan siklus tidak dilanjutkan; Ctrl+C ketiga saat idle hanya menampilkan petunjuk, bukan exit 130 (line-editor.ts:630-675).

## RC-FR-013 Terminal resize dan fallback [partial]
Bukti: packages/cli/src/line-editor.ts:254-260 event resize dipasang dan dilepas; packages/cli/src/line-editor.ts:922-1006 layout menghitung ulang baris, lebar, dan posisi cursor dari process.stdout.rows/columns; packages/cli/src/line-editor.ts:192 mode interaktif dimatikan untuk TERM=dumb atau screen reader; packages/cli/src/line-editor.ts:294-305 fallback readline untuk non-TTY, TERM=dumb, atau screen reader; packages/cli/src/main.ts:1006 status prompt disembunyikan saat lebar < 64; packages/cli/src/ui.ts:134-160 displayWidth menghitung CJK, emoji, dan karakter lebar; packages/cli/src/ui.test.ts:5-10 menghitung lebar karakter lebar dan escape
Gap:
- Butir 3: `NO_COLOR` hanya mematikan warna (ui.ts:39-41), tetapi LineEditor tetap menulis escape cursor seperti `\u001b[0J` dan `\u001b[C` (line-editor.ts:992-1006), termasuk saat `--no-color`.
- Butir 4: tidak ada jalur fallback saat renderer TUI gagal dimuat; LineEditor hanya memakai readline untuk non-TTY, TERM=dumb, atau screen reader (line-editor.ts:192, 294).

## RC-FR-014 Non-interactive mode [partial]
Bukti: packages/cli/src/main.ts:124-128 `rann -p` dan prompt posisional memanggil runPrompt tanpa chatCommand; packages/cli/src/main.ts:768-790 runPrompt membaca stdin dan mengirim satu turn; packages/cli/src/main.ts:792-795 resolveOutputFormat menerima text, json, stream-json, dan ndjson; packages/cli/src/main.ts:826-846 payload json berisi text, result, sessionId, taskId, status, steps, usage, dan error; packages/cli/src/stream.ts:71 ndjson dipetakan ke stream-json; stream.ts:136 menulis satu objek JSON per baris; packages/cli/src/main.ts:850 hasil turn dikembalikan sebagai 0 atau 1; packages/shared/src/errors.ts:48-77 pemetaan exit code per ErrorCode
Gap:
- Butir 5: exit code turn hanya 0 atau 1 (main.ts:850); tabel ARCHITECTURE 13.4 tidak dipakai, misalnya E_PERMISSION dipetakan 5 dan E_BUDGET_EXHAUSTED 4 di errors.ts:55,77, sedangkan tabel meminta 3 dan 5.

## RC-FR-015 Piped input dan output [partial]
Bukti: packages/cli/src/main.ts:757-765 readPipedStdin membaca stdin non-TTY, menolak byte NUL, dan mengembalikan teks; packages/cli/src/main.ts:769-770 isi stdin ditempel sebagai konteks tambahan setelah prompt argumen; packages/cli/src/main.ts:1178-1188 chatCommand membaca stdin sebagai prompt bila stdin bukan TTY; packages/cli/src/main.ts:3812-3819 EPIPE pada stdout dan stderr keluar tanpa stack trace; packages/cli/src/stream.ts:126-136 output teks dan stream-json ditulis ke stdout, log tool ke stderr
Gap:
- Butir 1: isi stdin dipotong 200.000 karakter tanpa peringatan (main.ts:770), sehingga konteks besar hilang diam-diam.
- Butir 4: deteksi biner hanya `buffer.includes(0)` (main.ts:764); berkas biner tanpa byte NUL lolos sebagai teks, sedangkan gambar tetap didukung lewat @path.

## RC-FR-016 Tema dan aksesibilitas [done]
Bukti: packages/cli/src/ui.ts:17-43 tema dark, light, auto, custom dan NO_COLOR/FORCE_COLOR/RANN_NO_COLOR; packages/cli/src/ui.ts:72-93 loadThemeFile memvalidasi token warna custom; packages/cli/src/ui.ts:59-70 contrastRatio menghitung kontras WCAG; packages/cli/src/ui.test.ts:24-29 tema gelap dan terang memenuhi kontras teks utama di atas 7:1; packages/cli/src/main.ts:110-116 `--no-color` dan `--theme` diterapkan sebelum render; packages/cli/src/ui.ts:243-263 Spinner menulis label statis tanpa animasi saat NO_COLOR, screen reader, atau non-TTY; packages/cli/src/main.ts:1209-1229 `/help keys` memakai teks status, bukan hanya warna

## RC-FR-017 Shell passthrough [partial]
Bukti: packages/cli/src/main.ts:1262-1277 `!` dan `!!` dipisahkan; perintah kosong ditolak; packages/cli/src/main.ts:1279-1291 shell dijalankan dengan cwd process.cwd dan timeout 120 detik; packages/cli/src/main.ts:1292-1310 output > 100.000 karakter dipotong 6.000 karakter dan disimpan sebagai artefak; packages/cli/src/main.ts:1298-1309 exit code dicetak; `!!` mengirim output ke model, `!` tidak; packages/cli/src/main.ts:1269-1277 regex perintah berbahaya meminta konfirmasi kecuali mode trusted
Gap:
- Butir 3: `!` tidak memakai policy izin tool shell; mode read-only tidak dicek dan yang diperiksa hanya regex perintah berbahaya (main.ts:1269-1277).
- Butir 5: deteksi perintah berbahaya hanya regex terbatas (main.ts:1269), sehingga perintah berisiko di luar pola itu tidak meminta konfirmasi.

## RC-FR-018 Project dan session switching [partial]
Bukti: packages/cli/src/main.ts:2332-2344 `/project` menampilkan project dari project.list dan menandai project aktif; packages/cli/src/main.ts:2351-2372 `/project switch` membuat sesi baru, chdir, memuat ulang history, command kustom, dan tema; packages/runtime/src/agent.ts:451-452 RANN.md dimuat dari workspaceRoot saat turn berjalan; packages/cli/src/main.ts:2277-2314 `/resume` berganti sessionId tanpa menutup sesi lama; packages/cli/src/main.ts:2494-2498 `/sessions` mencetak id dan title; packages/runtime/src/daemon.ts:51 config dimuat sekali saat daemon start
Gap:
- Butir 2: config project tidak dimuat ulang saat pindah project; daemon memuat config sekali saat start (daemon.ts:51) dan session.create memakai config global (rpc.ts:1326-1336). Indeks project juga tidak dibangun ulang saat switch.
- Butir 3: `/sessions` hanya mencetak id dan title (main.ts:2494-2498), tanpa status dan waktu terakhir.
- Butir 5: draft input hilang karena command `/project` atau `/resume` dikirim sebagai satu baris dan buffer editor di-reset (line-editor.ts:597-610); tidak ada penyimpanan draft.

## RC-FR-019 Lampiran dan multimodal input [partial]
Bukti: packages/runtime/src/attachments.ts:24-25 batas 20 MB per lampiran dan 50 MB total; packages/runtime/src/attachments.ts:72-105 validasi path, folder, symlink, ukuran, dan total; packages/runtime/src/attachments.ts:83-94 path di luar workspace ditolak dengan E_PERMISSION; packages/runtime/src/attachments.ts:108-120 hash sha256 dan salinan artefak dengan nama hash; packages/runtime/src/rpc.ts:1408 model non-vision menolak gambar dengan E_UNSUPPORTED dan saran /model; packages/runtime/src/agent.ts:221-232 gambar dikirim sebagai base64 ke provider; database menyimpan AttachmentRef di content_json (agent.ts:382); packages/cli/src/main.ts:901-913 `@path` diekstrak dari prompt; packages/runtime/src/attachments.test.ts:18-64 menguji artefak berhash, gambar magic bytes, dan path luar workspace; packages/runtime/src/attachments.test.ts:66-72 menolak berkas 20 MB lebih, meski judul tes menyebut total 50 MB
Gap:
- Butir 1: `@path` yang tidak ada dilewati diam-diam di CLI (main.ts:909), sehingga path tidak divalidasi dan prompt tetap dikirim tanpa lampiran.
- AC: `@path` tidak menampilkan konfirmasi lampiran; hanya `/attach` yang mencetak status (main.ts:2133), sedangkan extractAttachments tidak mencetak apa pun (main.ts:901-914).
- Butir 5: batas total 50 MB belum diuji; tes berjudul total 50 MB hanya memeriksa berkas 20 MB lebih (attachments.test.ts:66-72).

## RC-FR-020 Help dan error contract [partial]
Bukti: packages/cli/src/main.ts:1212-1251 /help dan /help <command> membaca REPL_COMMANDS dan matchReplCommands, termasuk penanda perintah yang belum tersedia.; packages/cli/src/repl-commands.ts:197-211 registerCommands mendaftarkan perintah kustom ke registry yang sama dan mencatat konflik nama.; packages/cli/src/main.ts:20-56 teks bantuan `rann --help` adalah string HELP statis, terpisah dari registry REPL.; packages/shared/src/errors.ts:1-43 daftar kode error stabil; packages/shared/src/errors.ts:174-177 toRpcError menambahkan trace_id ke data error.; packages/cli/src/main.ts:3839-3844 mencetak kode, pesan, saran dari data.hint, trace id, dan stack hanya bila process.argv memuat --debug.; packages/cli/src/main.ts:2814-2818 perintah tak dikenal mencetak E_UNKNOWN_COMMAND dan tiga saran dari nearestCommands; packages/cli/src/repl-commands.ts:264-277 menghitung jarak Levenshtein.
Gap:
- Butir 1: `rann --help` memakai string statis (main.ts:20-56), bukan registry REPL_COMMANDS (repl-commands.ts:197), jadi kedua dokumentasi bisa berbeda isi.
- Butir 2: tidak semua error membawa saran tindakan; error tanpa data.hint dan tanpa entri failure-analysis hanya menampilkan kode dan pesan (main.ts:3839-3843).
- Butir 3: --debug hanya menambah stack pada penangan error tingkat atas (main.ts:3844); error yang dicetak di dalam REPL tidak berubah detailnya.
- Butir 4: jalur izin ditolak hanya mencetak `Izin ditolak user untuk <tool>` tanpa cara mengubah izin (agent.ts:1124-1126).
- Butir 5: tidak ada lapisan i18n atau locale; seluruh pesan berupa literal bahasa Indonesia dan tidak ada sakelar ke bahasa Inggris.

## RC-FR-021 Agent reasoning loop [partial]
Bukti: packages/runtime/src/agent.ts:596 loop berjalan dari langkah 1 sampai config.maxSteps.; packages/runtime/src/agent.ts:469-472 planDecision menentukan perlu plan dan mencatat alasan saat planner dilewati.; packages/runtime/src/agent.ts:497-512 plan disimpan lewat persistPlan lalu startFirstTask dijalankan.; packages/runtime/src/agent.ts:846-880 setiap tool call dijalankan berurutan, checkpoint DB dibuat, lalu tool.start diumumkan.; packages/runtime/src/agent.ts:789-805 verifyPlanLive dipanggil saat model berhenti tanpa tool call, dengan maksimal dua percobaan premature.; packages/runtime/src/agent.ts:832-835 finishPlan dan turn.end berstatus done setelah verifikasi.
Gap:
- Butir 1: tidak ada fase eksplisit understand, plan, act, observe, evaluate, verify, report; yang ada hanya plan.update, tool.start, tool.end, message, dan turn.end (agent.ts:596-1170).
- Butir 2: turn tetap difinalisasi done setelah dua kegagalan verifikasi dengan gap masih tersisa (agent.ts:793-832), dan turn tanpa plan langsung done saat model berhenti tanpa tool call.
- Butir 3: tidak ada event observe, evaluate, atau verify tersendiri; hasil tool hanya ditulis sebagai pesan tool (agent.ts:955-969).
- Butir 5: kelanjutan otomatis saat model berhenti tanpa tool call hanya berlaku bila ada plan aktif (agent.ts:789-805); tanpa plan tidak ada pertanyaan atau aksi lanjutan.

## RC-FR-022 Perencanaan otomatis [partial]
Bukti: packages/runtime/src/planner.ts:81-94 planDecision memicu planner untuk ≥3 penanda langkah, ≥2 penanda urutan, ≥3 file, operasi besar, atau task class modify/operate/research/incident.; packages/runtime/src/planner.ts:19-48 PlanTask dan PlanDraft memuat goal, task, dependensi, agen, file, risiko, estimasi, kriteria, dan asumsi.; packages/runtime/src/planner.ts:219-281 validatePlan memeriksa duplikasi id, acceptance kosong, dependensi hilang, siklus, dan file yang dipakai task paralel.; packages/runtime/src/agent.ts:497-512 persistPlan dijalankan sebelum startFirstTask.; packages/runtime/src/agent.ts:469-472 keputusan melewati planner dicatat lewat publish log level debug dengan reasons.; packages/runtime/src/planner.test.ts:36-45 menguji klasifikasi dan needsPlan; packages/runtime/src/planner.test.ts:58-74 menguji penolakan siklus dan acceptance kosong.
Gap:
- Butir 1: tidak ada deteksi dependensi eksternal (paket, layanan, API); planDecision hanya melihat langkah, file, operasi besar, dan task class (planner.ts:81-93).
- Butir 3: validasi bukan skema ketat; normalizePlan mengisi agen `coding`, risiko `low`, dan estimasi `[5,15]` saat field hilang (planner.ts:183-197).
- Butir 3: task tanpa agen atau tanpa file tetap lolos karena validatePlan hanya mewajibkan judul dan acceptance (planner.ts:224-231).
- AC: jumlah task minimal tiga tidak divalidasi; validatePlan menerima plan dengan satu task (planner.ts:221), sehingga goal kompleks bisa menghasilkan plan satu task.

## RC-FR-023 Mode plan eksplisit [partial]
Bukti: packages/cli/src/main.ts:2793-2810 `/plan <tugas>` mengirim turn dengan planOnly true.; packages/runtime/src/agent.ts:505-543 saat planOnly, agent menulis plan ke pesan dan langsung finalize done tanpa menjalankan tool.; packages/cli/src/main.ts:2769-2786 `/execute <tugas>` menjalankan turn baru dengan forcePlan true.; packages/cli/src/main.ts:846 hasil plan hanya dimasukkan ke payload JSON bila output-format JSON dipakai.; packages/runtime/src/planner.ts:100-119 workspaceBrief hanya membaca package.json dan nama entri direktori, bukan isi file.
Gap:
- Butir 2: tidak ada persetujuan, penolakan, atau pengeditan per task sebelum eksekusi; yang ada hanya approval boolean untuk plan berisiko tinggi (agent.ts:483-497).
- Butir 3: `--plan-only` menghasilkan JSON hanya jika `--json` juga diberikan (main.ts:846); mode teks default mencetak markdown.
- Butir 4: mode plan tidak bisa membaca file atau mencari informasi karena agent kembali sebelum loop tool (agent.ts:505-543) dan planner hanya menerima workspaceBrief (planner.ts:100-119).
- Butir 5: `/execute <tugas>` menyusun plan baru dari prompt baru (main.ts:2769-2786), bukan melanjutkan plan yang baru dibuat; `/plan` tanpa argumen tidak punya handler, hanya `/plan <tugas>` (main.ts:2793).

## RC-FR-024 Dekomposisi tugas dan DAG [partial]
Bukti: packages/runtime/src/planner.ts:19-28 PlanTask memuat id, title, description opsional, agent, dependsOn, files, risk, dan acceptance.; packages/runtime/src/planner.ts:232-257 dependensi diperiksa dan topological sort dijalankan dengan urutan id dan dependensi yang di-sort.; packages/runtime/src/planner.ts:245-247 siklus dilaporkan sebagai rantai edge, misalnya `a -> b -> a`.; packages/runtime/src/planner.ts:227 task tanpa acceptance ditolak; packages/runtime/src/planner.test.ts:58-74 menguji siklus dan acceptance.; packages/runtime/src/plan-runtime.ts:248-300 revisePlan menaikkan versi plan menjadi versi sebelumnya + 1; packages/runtime/src/plan-runtime.test.ts:163-214 menguji versi 2 dan task selesai yang dipertahankan.
Gap:
- Butir 1: tujuan task (description) opsional dan tidak divalidasi; agen serta file juga tidak wajib di validatePlan (planner.ts:224-231).
- Butir 4: tidak ada penanda task paralel dan tidak ada eksekusi bersamaan; plan task dijalankan satu per satu berdasarkan created_at (plan-runtime.ts:182-235, agent.ts:846).
- Butir 4: tidak ada penjadwalan yang mempertimbangkan konflik lease antar task paralel.
- AC: plan enam task dengan task tanpa agen atau tanpa file tetap lolos validasi selama judul dan acceptance ada (planner.ts:224-231).

## RC-FR-025 Deteksi dependensi dan urutan eksekusi [partial]
Bukti: packages/runtime/src/planner.ts:232-237 dependensi eksplisit dari task.dependsOn diperiksa terhadap id yang ada.; packages/runtime/src/planner.ts:239-257 topological sort deterministik dengan kunci id yang di-sort dan dependensi yang di-sort.; packages/runtime/src/plan-runtime.ts:144-175 blockRunningTask menandai task berjalan dan task turunannya `blocked`, bukan `failed`.; packages/runtime/src/plan-runtime.test.ts:75-98 menguji urutan DAG A ke B ke C; packages/runtime/src/plan-runtime.test.ts:100-118 menguji task blocked karena dependensi tidak pernah selesai.; packages/runtime/src/plan-runtime.ts:294-299 revisePlan memanggil validatePlan pada DAG baru sebelum menyimpan.
Gap:
- Butir 1: dependensi implisit dari file atau modul tidak dideteksi; hanya task.dependsOn eksplisit yang dipakai (planner.ts:232-237).
- Butir 4: tidak ada konsep dependensi non-kritis; semua dependensi diperlakukan sebagai prasyarat keras (plan-runtime.ts:214-215).
- Butir 2: urutan topologis dari validatePlan tidak dipakai saat eksekusi; advancePlanTask memilih task pertama berstatus queued yang dependensinya selesai berdasarkan created_at (plan-runtime.ts:182-215).

## RC-FR-026 Penilaian risiko [partial]
Bukti: packages/runtime/src/planner.ts:19-28 setiap PlanTask membawa risk low, medium, atau high.; packages/runtime/src/planner.ts:30-34 PlanRisk menyimpan taskId, level, dan reason.; packages/runtime/src/planner.ts:279 highRisk dihitung dari task berisiko high, risks high, atau lebih dari 20 file.; packages/runtime/src/agent.ts:483-497 plan berisiko tinggi memanggil approvePlan dan menolak eksekusi bila tidak disetujui.; packages/runtime/src/planner.ts:350-360 planToMarkdown menampilkan level risiko per task dan status risiko tinggi plan.
Gap:
- Butir 1: tidak ada klasifikasi risiko dari kategori perubahan skema, migrasi, penghapusan file, Git destruktif, auth, dependency baru, atau deploy; risiko berasal dari JSON model (planner.ts:183-192).
- Butir 2: task hanya menyimpan level, tidak menyimpan alasan; reason hanya ada pada array risks yang opsional (planner.ts:30-34, 199-207).
- Butir 4: normalizeRisk menurunkan nilai tak dikenal menjadi `low` (planner.ts:151-153), sehingga model bisa menghilangkan level tinggi tanpa penilaian independen.
- Butir 5: ringkasan approval tidak memuat alasan risiko, hanya level dan daftar task (planner.ts:350-360).
- AC: task migrasi database tidak otomatis ditandai high karena tidak ada detektor kategori migrasi (planner.ts:58-94).

## RC-FR-027 Estimasi eksekusi [partial]
Bukti: packages/runtime/src/planner.ts:36-39 PlanEstimate memakai pasangan menit dan biaya.; packages/runtime/src/planner.ts:143-149 asNumberPair menormalkan dua angka menjadi rentang terurut.; packages/runtime/src/planner.ts:350-355 planToMarkdown mencetak rentang menit dan dolar.; packages/runtime/src/planner.ts:76-90 menguji plan dengan estimasi tunggal dan hasil estimasi menjadi [5,15].
Gap:
- Butir 2: tidak ada label historical atau heuristic dan tidak ada pembacaan data historis task; estimasi sepenuhnya dari model.
- Butir 3: revisePlan mempertahankan estimasi lama bila revision.estimate tidak diisi (plan-runtime.ts:289), jadi estimasi tidak diperbarui otomatis saat plan berubah.
- Butir 4: nilai hilang diganti angka palsu [5,15] menit dan [0,0] dolar (planner.ts:196-197), bukan `tidak tersedia`.
- Butir 5: tidak ada pencatatan aktual versus estimasi setelah task selesai; tabel tasks tidak punya kolom aktual (schema-v3.ts:127-142).

## RC-FR-028 Persetujuan rencana [partial]
Bukti: packages/runtime/src/agent.ts:483-497 approval plan memuat goal, highRisk, dan teks markdown yang berisi task, risiko, file, dan estimasi.; packages/runtime/src/rpc.ts:1598-1605 approval plan memakai requestApproval dan mengembalikan keputusan boolean.; packages/runtime/src/rpc.ts:1247-1301 requestApproval mencatat audit actor user, waktu, alasan, dan keputusan allow atau deny.; packages/runtime/src/rpc.ts:131 timeout approval 10 menit, setelah itu keputusan dianggap deny dengan alasan timeout.
Gap:
- Butir 2: hanya ada setuju atau tolak seluruh plan; tidak ada persetujuan sebagian task dan tidak ada permintaan revisi dengan catatan.
- Butir 3: tidak ada status pending per task; setelah plan disetujui, startFirstTask langsung menjalankan task pertama (agent.ts:512).
- Butir 4: masa berlaku hanya timeout permintaan approval 10 menit (rpc.ts:131); plan yang sudah disetujui tidak punya kedaluwarsa dan tidak perlu disetujui ulang.
- Butir 5: audit mencatat aktor dan waktu, tetapi tidak mengikat keputusan ke versi plan atau daftar task yang disetujui (rpc.ts:1272-1285).

## RC-FR-029 Persistensi dan versi rencana [partial]
Bukti: packages/storage/src/schema-v3.ts:97-109 tabel plans menyimpan id, session_id, turn_id, goal, status, version, metadata_json, dan waktu.; packages/runtime/src/plan-runtime.ts:248-320 revisePlan menaikkan version dan menyimpan riwayat revisi di metadata_json.; packages/runtime/src/plan-runtime.test.ts:163-214 menguji versi plan menjadi 2 dan task selesai tetap done.; packages/cli/src/main.ts:2510-2518 `/tasks` menampilkan plan dan status task dari plan.list.; packages/storage/src/work-repos.ts:315-317 listTasks mengurutkan task per sesi.
Gap:
- Butir 2: plan lama tidak disimpan sebagai baris tersendiri dan status `superseded` tidak ada di CHECK status plans (schema-v3.ts:102); revisi menimpa baris yang sama (plan-runtime.ts:300-320).
- Butir 3: `/plan show` tidak ada; hanya `/plan <tugas>` (main.ts:2793) dan `/tasks` yang tidak menampilkan nomor versi atau riwayat versi.
- Butir 4: tidak ada perintah atau RPC untuk ekspor dan impor plan ke JSON; pencarian plan.export dan plan.import tidak menemukan implementasi.
- Butir 1: versi tersimpan, tetapi status plan setelah revisit hanya satu baris sehingga versi lama tidak bisa dibuka ulang sebagai plan utuh.

## RC-FR-030 Replanning dinamis [partial]
Bukti: packages/runtime/src/plan-runtime.ts:248-300 revisePlan membuat plan baru dengan version + 1 dan reason.; packages/runtime/src/plan-runtime.ts:301-320 metadata.revisions menyimpan alasan perubahan.; packages/runtime/src/agent.ts:1021-1085 plan_revise meminta approval ulang bila goal berubah atau ada task high baru.; packages/runtime/src/plan-runtime.ts:264-281 task yang sudah done dikeluarkan dari daftar task revisi sehingga tidak diulang.; packages/runtime/src/plan-runtime.test.ts:163-214 menguji versi 2, alasan revisi, dan task selesai yang dipertahankan.
Gap:
- Butir 1: tidak ada trigger otomatis untuk task gagal permanen, file target hilang, atau dependensi berubah; hanya model yang memanggil tool plan_revise, sementara kegagalan task hanya menandai blocked (plan-runtime.ts:144-175).
- Butir 3: approval ulang hanya untuk perubahan goal atau penambahan task high (agent.ts:1040-1052); perubahan besar lain tidak memicu approval.
- Butir 4: perubahan kecil seperti urutan task low tidak bisa otomatis dan tidak dicatat sebagai revisi terpisah; semua revisi harus lewat plan_revise.
- Butir 2: plan lama tidak tersimpan sebagai versi terpisah, hanya metadata pada baris plan yang sama (plan-runtime.ts:300-320).

## RC-FR-031 Eksekusi multi-langkah dan pemilihan tool [partial]
Bukti: packages/runtime/src/agent.ts:583-590 daftar tool dikirim ke model setelah filter config.tools dan ketersediaan memori, skill, serta delegate.; packages/runtime/src/tools/index.ts:1802-1804 toolSpecs mengembalikan seluruh tool tanpa filter izin.; packages/runtime/src/tools/index.ts:131-154 lease path diambil sebelum menulis dan dilepas di blok finally.; packages/runtime/src/agent.ts:853-875 setiap tool call mendapat id, checkpoint, event tool.start, dan audit saat selesai.; packages/runtime/src/agent.ts:846-880 tool call dijalankan berurutan dalam satu loop, bukan paralel.
Gap:
- Butir 2: tool yang tidak diizinkan tetap dikirim ke model; pemeriksaan izin baru terjadi saat eksekusi (agent.ts:583-590 vs tools/index.ts assertAllowed).
- Butir 1: tidak ada pemilihan tool berdasarkan capability, biaya, atau konteks; model memilih sendiri dari seluruh kandidat.
- Butir 4: tidak ada eksekusi tool paralel; semua call dijalankan berurutan (agent.ts:846-880).
- AC: tidak ada alasan pemilihan tool yang dicatat atau ditampilkan; trace hanya memuat nama tool dan args (agent.ts:875-880).
- Butir 3: timeout bergantung pada konfigurasi tiap tool, tidak ada batas waktu per tool call yang tercatat di metadata call (tools/index.ts:1093-1133).

## RC-FR-032 Observasi dan evaluasi [partial]
Bukti: packages/runtime/src/agent.ts:955-969 hasil tool ditulis sebagai pesan role tool berisi JSON error atau output.; packages/runtime/src/agent.ts:789-805 evaluasi hanya dilakukan di akhir plan lewat verifyPlanLive, bukan per langkah.; packages/runtime/src/tools/index.ts:496-506 hasil shell menandai truncated; packages/runtime/src/tools/index.ts:548 dan 748 juga menandai daftar yang terpotong.; packages/runtime/src/agent.ts:1175-1186 error turn dianalisis dengan analyzeFailure dan action.
Gap:
- Butir 1: tidak ada objek observation dengan status, ringkasan, data, dan artefak; hasil tool hanya JSON mentah di pesan tool (agent.ts:955-969).
- Butir 2: tidak ada evaluasi per langkah terhadap kriteria task; verifikasi hanya di akhir plan (agent.ts:789-805).
- Butir 3: hasil kosong tidak ditandai dan tetap dianggap sukses karena textResult selalu ok true (tools/index.ts:95-97).
- Butir 4: tidak ada event evaluasi beserta alasan; trace hanya mencatat tool.start, tool.end, dan error (agent.ts:875-969).
- Butir 5: tidak ada jalur `tidak tahu`; bila verifikasi tidak bisa dijalankan, turn tetap selesai dengan teks model.

## RC-FR-033 Self-correction dan strategi retry [partial]
Bukti: packages/runtime/src/agent.ts:1092-1106 retry hanya untuk tool baca dengan maksimal tiga percobaan dan hanya pada E_TOOL_TIMEOUT, E_CONFLICT, atau E_DB.; packages/runtime/src/agent.ts:984-996 tanda tangan tool dan args yang sama dihitung; E_NO_PROGRESS baru muncul saat hitungan melewati 3.; packages/runtime/src/failure-analysis.ts:31-97 tabel kategori error tidak memuat E_NO_PROGRESS.; packages/runtime/src/agent.ts:1124-1126 error izin menghentikan turn tanpa opsi strategi alternatif.
Gap:
- Butir 1: matriks retry di ARCHITECTURE bagian 13.3 tidak ada di repo; docs hanya berisi audit, prd, status.md, dan tutorial, tanpa ARCHITECTURE.md.
- Butir 2: percobaan ketiga dengan args identik masih dijalankan; penghentian baru terjadi pada percobaan keempat karena kondisi `seen > 3` (agent.ts:990-996).
- Butir 3: E_NO_PROGRESS tidak punya entri di tabel failure-analysis, jadi analisisnya jatuh ke kategori unknown dengan saran generik (failure-analysis.ts:101-105).
- Butir 4: tidak ada catatan perubahan strategi atau parameter; retry mengulang args yang sama (agent.ts:1097-1105).
- Butir 5: retry otomatis hanya pada tool baca yang idempoten, tetapi tidak ada mekanisme yang mencegah model memanggil ulang tool tulis secara identik sampai batas empat kali (agent.ts:984-996).

## RC-FR-034 Pemulihan error [partial]
Bukti: packages/runtime/src/failure-analysis.ts:3-15 mengklasifikasikan provider, auth, rate_limit, timeout, budget, permission, context, stream, plan, tool, cancelled, dan unknown.; packages/runtime/src/failure-analysis.ts:31-97 tabel memberi retryable dan action per kode error; packages/runtime/src/failure-analysis.test.ts:6-25 menguji kategori auth, rate limit, timeout, dan unknown.; packages/runtime/src/agent.ts:1092-1106 error transient pada tool baca diretry hingga tiga kali.; packages/runtime/src/tools/index.ts:131-154 lease path dilepas di blok finally setelah tool selesai atau gagal.; packages/runtime/src/agent.ts:853-875 checkpoint DB dibuat sebelum setiap tool call dan checkpoint file sebelum tool mutasi pertama.
Gap:
- Butir 2: conflict tidak memicu replan dan budget hanya menghentikan turn; tidak ada pemetaan transient, permanent, conflict, budget, policy ke aksi berbeda (failure-analysis.ts:31-97).
- Butir 4: checkpoint file hanya dibuat sekali per turn sebelum tool mutasi pertama (agent.ts:853-860); perubahan file berikutnya tidak punya titik rollback.
- Butir 5: tidak ada pilihan pengguna retry, skip, replan, atau abort saat error bisa dipulihkan; agent langsung retry atau menghentikan turn (agent.ts:1092-1186).
- AC: setelah tool timeout, state disimpan tetapi turn tidak bisa dilanjutkan otomatis dari langkah terakhir; /resume hanya meneruskan percakapan, bukan state tool (main.ts:2287-2312).

## RC-FR-035 Prioritas task [partial]
Bukti: packages/storage/src/schema-v3.ts:136 kolom priority bertipe INTEGER pada tabel tasks.; packages/storage/src/work-repos.ts:315-317 listTasks mengurutkan task dengan `ORDER BY priority DESC, created_at`.; packages/storage/src/job-repos.ts:113 dan 128 antrean job memakai priority dan next_run_at untuk memilih job.; packages/runtime/src/plan-runtime.ts:182-184 eksekusi plan memilih task berdasarkan created_at, bukan priority.
Gap:
- Butir 1: prioritas tersimpan dan diurutkan di listTasks, tetapi eksekusi plan mengabaikannya dan memakai urutan created_at (plan-runtime.ts:182-215).
- Butir 2: tidak ada API atau perintah untuk mengubah prioritas task yang sedang berjalan atau antre.
- Butir 3: tidak ada antrean terpisah untuk task high dengan concurrency lebih besar; plan task selalu dijalankan berurutan (agent.ts:846).
- Butir 4: task yang menunggu approval plan memblokir seluruh turn, termasuk task lain yang tidak butuh approval (agent.ts:483-512).
- Butir 5: perubahan prioritas tidak dicatat karena tidak ada operasi perubahan prioritas.

## RC-FR-036 Goal tracking dan state [partial]
Bukti: packages/storage/src/goal-repos.ts:90-121 setGoal menyimpan goal, kriteria, asumsi, versi, dan pembuat goal.; packages/storage/src/goal-repos.ts:131-158 updateGoalProgress menandai kriteria selesai hanya dengan bukti dan menaikkan langkah.; packages/storage/src/goal-repos.ts:92 menolak goal yang dibuat oleh agent; packages/storage/src/goal-repos.test.ts:46-70 menguji penolakan tersebut.; packages/runtime/src/agent.ts:880-890 progres goal diperbarui setiap tool selesai atau gagal.; packages/cli/src/main.ts:1892-1911 `/status` menampilkan goal, kriteria, dan daftar kriteria yang belum terpenuhi.; packages/storage/src/goal-repos.test.ts:72-90 menguji goal tetap ada setelah koneksi database dibuka ulang.
Gap:
- AC: runTurn tidak memanggil finishGoal, jadi turn bisa berstatus done meski kriteria goal belum terpenuhi (agent.ts:832); finishGoal hanya dipanggil dari /goal finish (main.ts:1511).
- Butir 2: progres bertambah pada setiap tool, termasuk tool yang gagal (agent.ts:880-890), sehingga angka langkah tidak mencerminkan kemajuan task.
- Butir 4: kriteria hanya punya status done boolean dan bukti; tidak ada status gagal atau alasan kegagalan per kriteria (goal-repos.ts:4-10).
- Butir 1: goal disimpan di tabel goals per sesi, bukan di state task; task hanya menyimpan plan_id dan metadata (schema-v3.ts:127-142).

## RC-FR-037 Dukungan task panjang [partial]
Bukti: packages/runtime/src/rpc.ts:1433-1437 startTurnRuntime dipanggil dan heartbeat ditulis setiap config.agent.heartbeat_ms.; packages/shared/src/config.ts:53-57 heartbeat_ms default 5.000 ms dan max_runtime_ms default 7.200.000 ms.; packages/storage/src/turn-runtime-repos.ts:60-95 findStalledTurns dan markStalledTurns memakai ambang 60.000 ms dan max runtime.; packages/runtime/src/rpc.ts:321-347 watchdog 15 detik memanggil markStalledTurns dan menyiarkan event heartbeat state stalled.; packages/runtime/src/dashboard-data.ts:177-184 halaman logs membaca events untuk dashboard; packages/cli/src/main.ts:1892-1911 menyediakan /status.
Gap:
- Butir 2: turn yang stalled hanya ditandai dan diberi event; tidak ada pemulihan otomatis, dan turn yang terputus saat restart justru ditandai failed (repos.ts:259-283).
- Butir 3: checkpoint tidak berkala; checkpoint file hanya dibuat sekali sebelum tool mutasi pertama (agent.ts:853-860), bukan setiap N langkah atau setelah test lulus.
- Butir 4: progress dan log tersedia di CLI dan dashboard, tetapi messaging hanya mengirim hasil akhir turn.end (messaging.ts:392-428), bukan progres berkala.
- AC: setelah 10 menit heartbeat memang tetap di bawah 10 detik, tetapi tidak ada bukti pemulihan task yang stalled karena /resume hanya aktif setelah pembatalan manual (main.ts:2287-2291).

## RC-FR-038 Checkpoint dan kelanjutan task [partial]
Bukti: packages/runtime/src/agent.ts:853-875 checkpoint file dibuat sebelum tool mutasi pertama dan checkpoint DB dibuat sebelum setiap tool call.; packages/runtime/src/checkpoint-files.ts:10-26 manifest menyimpan path, sha256, ukuran, dan lokasi backup tiap file.; packages/runtime/src/checkpoint-files.ts:51-90 createFileCheckpoint menyalin setiap file, menghitung sha256, dan menulis manifest.json berisi path, hash, ukuran, dan backup.; packages/runtime/src/checkpoint-files.test.ts:20-33 menguji snapshot dan restore seluruh berkas; packages/runtime/src/checkpoint-files.test.ts:35-41 menguji penolakan rollback bila file berubah tanpa force.; packages/runtime/src/agent-wiring.test.ts:176-210 menguji checkpoint otomatis sebelum tool mengubah workspace dan restore dengan force.; packages/cli/src/main.ts:2389-2393 `/checkpoint` hanya menampilkan daftar checkpoint.
Gap:
- Butir 1: checkpoint file hanya dibuat sekali per turn sebelum tool mutasi pertama; tidak ada checkpoint setelah test lulus atau setiap N langkah (agent.ts:853-860).
- Butir 2: manifest tidak menyimpan Git ref, dan checkpoint DB tidak menyimpan status task lengkap, hanya step, plan_id, tool, args, dan file_checkpoint_id (agent.ts:863-875).
- Butir 3: setelah crash, recoverInterruptedTurns menandai turn failed dan menambah pesan pemulihan, bukan melanjutkan dari checkpoint (repos.ts:259-283).
- Butir 4: checkpoint.restore hanya mengembalikan file, tidak mengembalikan state task (rpc.ts:821-835); /undo memakai force true sehingga melewati pemeriksaan file yang berubah (main.ts:2547).
- Butir 5: `/checkpoint` tidak punya aksi hapus; hanya daftar (main.ts:2389-2393), dan tidak ada RPC checkpoint.delete.

## RC-FR-039 Analisis kegagalan dan verifikasi [partial]
Bukti: packages/runtime/src/planner.ts:10 mendefinisikan CriterionType test, build, runtime, file, diff, dan manual.; packages/runtime/src/agent.ts:791 memanggil verifyPlanLive sebelum turn difinalisasi.; packages/runtime/src/agent.ts:793 membatasi penolakan premature hanya dua kali, lalu packages/runtime/src/agent.ts:832 tetap finalize("done") meski gap verifikasi ada.; packages/runtime/src/plan-runtime.ts:530-558 memeriksa file, diff di file_changes, dan menjalankan perintah verifikasi.; packages/runtime/src/failure-analysis.ts:17-22 hanya memuat category, retryable, cause, dan action.; packages/storage/src/db.ts:81 status turn hanya queued, running, done, failed, cancelled.
Gap:
- Verifikasi hanya berjalan jika ada plan aktif; turn tanpa plan bisa selesai tanpa menjalankan kriteria apa pun.
- Setelah dua percobaan premature, turn tetap berstatus done meski gap verifikasi masih ada; tidak ada status verifying.
- Laporan kegagalan tidak memuat langkah yang sudah dicoba dan hipotesis, hanya cause dan action.
- Laporan sukses tidak merangkum file yang berubah, perintah verifikasi, dan hasil perintahnya.
- Tidak ada status unverified; gap verifikasi hanya ditempel sebagai teks 'Belum diverifikasi'.

## RC-FR-040 Eksplorasi repository [partial]
Bukti: packages/runtime/src/project-map.ts:266-306 buildProjectMap memindai berkas dan menghasilkan direktori, bahasa, package manager, framework, entry point, serta perintah.; packages/runtime/src/project-map.ts:4-23 mengecualikan node_modules, .git, dist, build, dan direktori artefak lain.; packages/runtime/src/project-map.ts:182-188 mendeteksi package manager dari lockfile.; packages/runtime/src/project-map.test.ts:31 tes 'mendeteksi bahasa, package manager, perintah, dan entry point'.; packages/runtime/src/project-map.test.ts:45 tes 'menyimpan dan memuat peta, lalu membangun ulang saat refresh'.; packages/cli/src/main.ts:3807-3818 initCommand menulis peta ke .rann/project-map.json.
Gap:
- README tidak dibaca atau diringkas; .md hanya dihitung sebagai bahasa Markdown di packages/runtime/src/project-map.ts:56.
- Tidak ada pembaruan incremental; packages/runtime/src/project-map.ts:332-337 memakai cache atau membangun ulang seluruh peta.
- Saat deteksi ambigu, packages/runtime/src/project-map.ts:285-288 hanya mencatat asumsi tanpa meminta konfirmasi ke pengguna.
- Tidak ada uji atau bukti waktu pemindaian 5.000 berkas dalam 30 detik.

## RC-FR-041 Pencarian kode semantik [partial]
Bukti: packages/runtime/src/code-tools.ts:99-191 searchCode memindai teks dan mengembalikan path, line, column, text, serta reason.; packages/runtime/src/code-tools.ts:116 memperlakukan query sebagai literal kecuali regex=true.; packages/runtime/src/code-tools.ts:137 hanya memakai IGNORED hardcoded, bukan .gitignore.; packages/runtime/src/code-tools.ts:180-182 memberi note saat hasil kosong.; packages/runtime/src/code-tools.test.ts:19 tes 'mencari teks, menghormati ignore, dan membatasi hasil'.; packages/cli/src/repl-commands.ts:148 perintah /index masih berstatus NOT_YET.
Gap:
- Tidak ada indeks simbol tree-sitter atau vektor knowledge chunk; pencarian hanya grep/substring, jadi AC pencarian semantik tidak terpenuhi.
- Pencarian tidak menghormati .gitignore; hanya daftar direktori hardcoded di packages/runtime/src/code-tools.ts:7-26.
- Hasil tidak diberi skor relevansi; urutan hanya urutan berkas dan baris.
- /index rebuild belum tersedia sehingga indeks tidak bisa dibangun ulang.

## RC-FR-042 Operasi file dasar [partial]
Bukti: packages/runtime/src/tools/index.ts:1793-1799 mendaftarkan read_file, write_file, edit_file, delete_file, list_dir, dan stat_file sebagai alias tool fs_*.; packages/runtime/src/policy.ts:127-134 resolveInsideWorkspace menolak path keluar workspace setelah realpath.; packages/runtime/src/tools/index.ts:470-509 fs_read mengembalikan sha256 isi berkas.; packages/runtime/src/tools/index.ts:754-780 fs_delete memindahkan target ke .rann/trash.; packages/runtime/src/tools/index.ts:166-187 recordChanges menulis hash dan diff ke file_changes.; packages/runtime/src/tools.test.ts:74 tes 'menolak path keluar workspace' dan packages/runtime/src/tools.test.ts:237 tes 'memindahkan berkas ke trash dan menemukan berkas lewat glob'.
Gap:
- write_file/fs_write tidak menerbitkan expected_sha256 di skema publik, sehingga penolakan menimpa berkas yang berubah tidak otomatis terikat pada hasil baca.
- Tidak ada mode hard untuk delete_file; fs_delete selalu memindahkan ke trash.
- Audit file_changes hanya mencakup fs_write, fs_edit, dan apply_patch; fs_delete, fs_read, fs_list, dan fs_stat tidak mencatat hash sebelum dan sesudah.

## RC-FR-043 Patch editing yang aman [partial]
Bukti: packages/runtime/src/tools/index.ts:617-686 fs_edit menerima old dan new, menghitung kemunculan, lalu menulis lewat transaksi.; packages/runtime/src/tools/index.ts:643-649 menggagalkan edit jika old tidak ada atau muncul lebih dari sekali tanpa all=true.; packages/runtime/src/code-tools.ts:327-333 membaca ulang setiap berkas yang ditulis dan membandingkan hash.; packages/runtime/src/code-tools.ts:310 menghasilkan unified diff; packages/runtime/src/tools/index.ts:657-666 menyimpannya lewat recordChanges.; packages/runtime/src/tools.test.ts:46 tes 'mencatat edit ke transaksi dan menolak lease milik sesi lain'.; packages/runtime/src/code-tools.test.ts:75 tes 'menghasilkan diff minimal dan menyertakan teks bila diminta'.
Gap:
- Opsi all=true meloloskan old yang muncul lebih dari sekali, padahal requirement mewajibkan edit gagal pada kemunculan ganda.
- Skema publik edit_file memakai old dan new, bukan old_string dan new_string seperti yang diminta requirement.

## RC-FR-044 Modifikasi multi-file dan transaksi [partial]
Bukti: packages/runtime/src/tools/index.ts:1056-1120 apply_patch mengubah banyak berkas dalam satu transaksi.; packages/runtime/src/code-tools.ts:265-318 mencatat hash semua target sebelum penulisan dan menolak expected_sha256 yang tidak cocok.; packages/runtime/src/code-tools.ts:320-345 menulis lewat berkas sementara dan mengembalikan semua berkas yang sudah ditulis jika ada kegagalan.; packages/runtime/src/code-tools.test.ts:43 tes 'menulis beberapa berkas dan melaporkan status'.; packages/runtime/src/code-tools.test.ts:56 tes 'menolak transaksi bila hash berubah sebelum eksekusi'.; packages/runtime/src/code-tools.test.ts:67 tes 'dry run tidak menyentuh berkas'.
Gap:
- Penolakan berkas yang berubah di luar transaksi hanya aktif jika caller mengirim expected_sha256; tanpa itu berkas tetap ditimpa.
- Hasil transaksi hanya memuat lines_before dan lines_after, tidak menghitung jumlah baris yang berubah.

## RC-FR-045 Code generation dan refactoring [partial]
Bukti: packages/runtime/src/tools/index.ts:554-612 fs_write dan packages/runtime/src/tools/index.ts:617-686 fs_edit menyediakan penulisan serta penggantian kode.; packages/runtime/src/subagent-profiles.ts:50-58 profil coder memicu kata refactor dan meminta perubahan kecil.; packages/runtime/src/plan-runtime.ts:518-566 bisa menjalankan perintah tes sebagai kriteria verifikasi.; package.json:18 menyediakan skrip prettier --check, tetapi bukan tool agent.
Gap:
- Tidak ada operasi rename simbol yang memperbarui semua referensi lintas berkas.
- Tidak ada indeks simbol atau pemeriksaan simbol publik yang hilang.
- Tidak ada bukti grep wajib sebelum kode dianggap tidak terpakai lalu dihapus.
- Gaya kode tidak dijalankan otomatis lewat tool; Prettier, ESLint, gofmt, dan rustfmt tidak terintegrasi ke alur edit.
- Tidak ada pemecahan otomatis perubahan besar menjadi patch yang bisa direview.

## RC-FR-046 Debugging dan diagnosis error [partial]
Bukti: packages/cli/src/main.ts:2651-2666 /debug hanya membentuk prompt debugging dan mengirimkannya ke model.; packages/runtime/src/skills.ts:50-62 skill debug-sistematis meminta reproduksi, hipotesis, dan verifikasi.; packages/runtime/src/failure-analysis.ts:17-22 menyediakan kategori kegagalan dan saran, bukan state hipotesis.
Gap:
- Tidak ada pengumpulan otomatis error, stack trace, log, dan langkah reproduksi ke artefak.
- Hipotesis tidak dicatat sebagai state sebelum perubahan dan tidak diuji satu per satu oleh runtime.
- Tidak ada kewajiban tes regresi yang gagal sebelum perbaikan dan lulus sesudahnya.
- Tidak ada laporan terstruktur tentang area yang belum diperiksa saat penyebab tidak ditemukan.
- Tidak ada guard terhadap try/catch kosong atau any; larangan hanya ada di teks prompt.

## RC-FR-047 Generasi dan eksekusi tes [partial]
Bukti: packages/cli/src/main.ts:2641-2651 /test menjalankan package manager test dan melaporkan lulus atau gagal.; packages/runtime/src/tools/index.ts:1140-1165 project_check menjalankan test, lint, build, atau typecheck dari peta proyek.; packages/runtime/src/project-map.ts:224-260 mendeteksi perintah test dari package.json, pytest, go, atau Cargo.; packages/runtime/src/plan-runtime.ts:561-566 memakai parseTestFailures untuk mengambil nama tes yang gagal.
Gap:
- Tidak ada deteksi framework atau generasi tes; /test hanya menjalankan perintah test yang sudah ada.
- Tidak ada ringkasan terstruktur jumlah lulus, gagal, dan skip; yang tersedia hanya output mentah.
- Tidak ada penandaan flaky atau eksekusi ulang maksimal dua kali.
- Tidak ada guard agar tes lama tidak dihapus atau dilemahkan untuk membuat hasil lulus.

## RC-FR-048 Code review [partial]
Bukti: packages/cli/src/main.ts:1203-1211 /review mengubah perintah menjadi prompt review diff dengan path dan baris.; packages/runtime/src/skills.ts:65-77 skill review-kode meminta bug, keamanan, kompatibilitas, dan temuan berpath serta baris.
Gap:
- Temuan tidak divalidasi terhadap skema path, baris, severity blocker/major/minor/nit, penjelasan, dan saran.
- Tidak ada filter yang membuang temuan tanpa lokasi atau tanpa alasan.
- Cakupan performa tidak diminta secara eksplisit oleh prompt /review maupun skill review-kode.
- Ringkasan tidak memisahkan temuan pasti dan dugaan secara terstruktur.
- Tidak ada parameter file; /review selalu menganalisis diff yang belum di-commit.

## RC-FR-049 Analisis arsitektur dan dependensi [partial]
Bukti: package.json:19 menyediakan skrip depcruise dan package.json:37 memasang dependency-cruiser 16.x.; .dependency-cruiser.cjs:3-28 memuat empat aturan layer untuk packages, tetapi tidak memuat aturan no-circular.; packages/runtime/src/tools/index.ts:1027 mendaftarkan search_code; tidak ada tool khusus arsitektur atau dependensi.
Gap:
- Siklus dependensi tidak diperiksa karena .dependency-cruiser.cjs:2-30 tidak memuat aturan no-circular.
- Package yang tidak terpakai tidak dideteksi.
- Lisensi dan ukuran dependency baru tidak dilaporkan.
- Parser untuk bahasa selain JavaScript dan TypeScript tidak tersedia.

## RC-FR-050 Build, lint, typecheck, dan dependency [partial]
Bukti: packages/runtime/src/project-map.ts:182-188 mendeteksi package manager dari lockfile.; packages/runtime/src/project-map.ts:224-260 mendeteksi perintah test, lint, build, dan typecheck dari package.json serta beberapa konfigurasi bahasa.; packages/runtime/src/tools/index.ts:1140-1165 project_check menjalankan perintah yang terdeteksi.; packages/runtime/src/tools/index.ts:1672-1690 package_run menjalankan install, add, remove, test, run, dan audit.; packages/runtime/src/system-tools.ts:135-137 menolak flag global dan registry.; packages/runtime/src/project-map.test.ts:31 tes 'mendeteksi bahasa, package manager, perintah, dan entry point'.
Gap:
- Makefile tidak dibaca sebagai sumber perintah.
- Jika perintah tidak terdeteksi, project_check melempar E_TOOL_FAILED; tidak bertanya dan tidak memakai perintah standar berlabel asumsi.
- Instalasi dependency tidak mencatat lockfile yang berubah.

## RC-FR-051 Integrasi Git [partial]
Bukti: packages/runtime/src/tools/index.ts:787-826 git_read menyediakan status, diff, log, show, blame, branch, dan remote.; packages/runtime/src/tools/index.ts:829-934 git_write menyediakan stage, commit, branch, worktree, merge, pull, dan push.; packages/runtime/src/git.ts:63-67 menambahkan trailer Rann-Code-Session saat sessionId tersedia.; packages/runtime/src/tools.test.ts:256 tes 'membaca status git dan commit dengan trailer sesi'.; packages/runtime/src/tools.test.ts:280 tes 'menolak commit saat masih ada konflik'.
Gap:
- Working tree kotor tidak dicatat sebagai baseline saat task dimulai; tidak ada snapshot diff awal.

## RC-FR-052 Dokumentasi dan inisialisasi project [partial]
Bukti: packages/cli/src/main.ts:3807-3818 initCommand membuat .rann, config, RANN.md, dan project map.; packages/cli/src/main.ts:3810 menulis .rann/config.toml, bukan .rann/config.json.; packages/cli/src/main.ts:3813-3815 menulis RANN.md berisi placeholder 'Tulis aturan yang harus diikuti agent di repo ini'.; packages/runtime/src/project-map.ts:266-306 menyediakan fakta repo yang bisa dipakai untuk dokumentasi.
Gap:
- RANN.md hanya placeholder dan tidak memuat perintah, konvensi, atau batasan project.
- File config dibuat sebagai .rann/config.toml, tidak sesuai acceptance .rann/config.json.
- Tidak ada mekanisme memperbarui dokumentasi setelah perubahan besar.
- Tidak ada pilihan bahasa dokumentasi.

## RC-FR-053 Spawn subagent dan profil [partial]
Bukti: packages/runtime/src/subagent-profiles.ts:4-15 profil memuat model, systemPrompt, tools, permission, maxSteps, dan triggers.; packages/runtime/src/subagent-profiles.ts:160-174 memuat profil dari ~/.rann/agents dan .rann/agents.; packages/runtime/src/rpc.ts:1744-1745 memakai permission profil dan maxSteps sebagai batas langkah.; packages/runtime/src/rpc.ts:1762-1775 mencatat session, turn, parentTurnId, profile, goal, depth, path, dan model.; packages/runtime/src/rpc.ts:1898-1909 mengembalikan status, text, steps, usage, cost_usd, dan files_changed.; packages/runtime/src/subagent-run.test.ts:49 tes 'menjalankan subagent nyata dengan mock provider dan menyimpan hasil'.
Gap:
- Konteks dari parent tidak disimpan di record spawn; hanya dikirim ke system prompt.
- Izin anak tidak diiris dengan permissionMode parent; packages/runtime/src/rpc.ts:1744-1746 hanya memakai flag read-only global.
- Profil bawaan reviewer tidak menetapkan model, sehingga model jatuh ke config atau model parent; AC profil reviewer belum terpenuhi.

## RC-FR-054 Specialisasi agent [partial]
Bukti: packages/runtime/src/subagent-profiles.ts:29-120 mendefinisikan profil explore, planner, coder, debugger, reviewer, tester, researcher, writer, dan security.; packages/runtime/src/subagent-profiles.ts:4-15 setiap profil memuat description, when, systemPrompt, tools, permission, maxSteps, dan triggers.; packages/runtime/src/subagent-profiles.ts:160-174 memuat profil kustom dari ~/.rann/agents dan .rann/agents.; packages/runtime/src/subagent-profiles.ts:178-191 memilih profil dari trigger saat profile tidak disebut, dan menolak nama asing.; packages/runtime/src/subagent-profiles.test.ts:33 tes 'memilih profil eksplisit dan menolak nama asing'.
Gap:
- Profil architect, frontend, dan backend tidak ada.
- Tidak ada field output yang diharapkan pada SubagentProfile; hanya description/when/systemPrompt.
- Hasil dua agen specialisasi tidak digabung; task mengembalikan hasil per anak tanpa agregasi.
- Jika nama profil disebut, pickProfile memakai nama itu tanpa mempertimbangkan task; pemilihan berbasis task hanya saat profile kosong.

## RC-FR-055 Eksekusi paralel [partial]
Bukti: packages/runtime/src/rpc.ts:1664-1695 acquireSubagentSlot membatasi concurrency per kunci provider/model.; packages/runtime/src/rpc.ts:1858 memakai kunci provider/model dan config.subagents.max_concurrent.; packages/runtime/src/rpc.ts:1509-1513 membatasi jumlah spawn per turn.; packages/runtime/src/rpc.ts:1514-1549 menjalankan subagent background secara paralel dan mengembalikan agent_id.; packages/runtime/src/agent.ts:555-575 delegate meneruskan task ke runtime.
Gap:
- Concurrency tidak dibatasi per sesi; hanya ada max_per_turn dan max_children.
- Tidak ada pemeriksaan dependensi atau konflik lease sebelum task paralel dijadwalkan.
- Budget parent tidak mencakup anak; tiap anak memakai budget turn global di packages/runtime/src/rpc.ts:1876-1880.
- Tidak ada agregasi hasil paralel dengan status dan bukti masing-masing.
- Tidak ada uji 8 tugas independen yang membuktikan waktu paralel di bawah 60 persen waktu serial.

## RC-FR-056 Delegasi dan agregasi hasil [partial]
Bukti: packages/runtime/src/agent.ts:77-83 DelegateInput hanya memuat goal, context, label, profile, background, dan maxSteps.; packages/runtime/src/tools/index.ts:1751-1774 tool task meneruskan goal, context, label, profile, background, dan max_steps.; packages/runtime/src/rpc.ts:1898-1909 hasil subagent memuat status, text, steps, usage, cost_usd, dan files_changed.; packages/runtime/src/subagent-run.test.ts:49 tes 'menjalankan subagent nyata dengan mock provider dan menyimpan hasil'.
Gap:
- Delegasi tidak menyertakan kriteria selesai, daftar file target, dan batas waktu.
- Hasil subagent tidak memuat evidence terstruktur; hanya text bebas.
- Klaim tanpa bukti tidak ditandai unverified dan tetap dianggap selesai.
- Konflik antar hasil tidak dideteksi atau dilaporkan.
- Tidak ada agregasi yang disimpan di task parent; hasil hanya tersimpan per agent.

## RC-FR-057 Komunikasi antar agen [partial]
Bukti: packages/runtime/src/rpc.ts:772-785 agent.message menerima type, subject, body, refs, dan priority.; packages/storage/src/agent-repos.ts:236-253 recordSubagentMessage menyimpan pesan ke tabel subagent_messages.; packages/storage/src/agent-repos.ts:258-262 listSubagentMessages membaca inbox dan outbox agent.; packages/storage/src/schema-v10.ts:17-27 skema tabel subagent_messages.; packages/storage/src/agent-repos.test.ts:109 tes 'mencatat pesan dan melepas lease saat agent selesai'.
Gap:
- Tidak ada tool agent untuk mengirim atau menerima pesan; agent.message hanya RPC yang dipanggil CLI di packages/cli/src/main.ts:516.
- Tidak ada pemeriksaan parent, anak, atau peer tim; field from di packages/runtime/src/rpc.ts:777 adalah string bebas.
- Tidak ada mekanisme balasan atau pengiriman pesan ke konteks subagent yang sedang berjalan.
- Tidak ada eskalasi ke pengguna setelah konflik tiga pertukaran.
- Tabel bernama subagent_messages, bukan agent_messages seperti yang diminta requirement.

## RC-FR-058 Konteks bersama dan terisolasi [partial]
Bukti: packages/runtime/src/rpc.ts:1739-1745 sesi anak dibuat baru tanpa riwayat pesan induk; packages/runtime/src/rpc.ts:1829-1836 systemExtra hanya berisi goal dan options.input.context; packages/runtime/src/tools/index.ts:1757 parameter context eksplisit pada tool task; packages/runtime/src/rpc.ts:766-778 agent.message hanya mencatat pesan, tanpa jalur persetujuan induk; packages/runtime/src/memory.ts:68-72 filter agent hanya aktif bila agentProfile diisi; rpc.ts:1811-1817 tidak mengisinya; packages/runtime/src/subagent-run.test.ts menjalankan subagent nyata dengan mock provider dan menyimpan hasil
Gap:
- Butir 1: mode shared tidak ada; keputusan dan artefak induk tidak dibagikan otomatis, hanya goal dan context manual (rpc.ts:1829-1836)
- Butir 4: anak tidak bisa meminta konteks tambahan; agent.message hanya dipanggil dari RPC/REPL dan tidak meminta persetujuan induk (rpc.ts:766-778)
- Butir 5: kebocoran memory antar agen tidak ditolak karena agentProfile tidak pernah diisi dan filter profil tidak dipakai (memory.ts:68-72, rpc.ts:1811-1817)
- AC: keputusan dan artefak tidak ikut dibagikan, jadi hanya sebagian AC yang terpenuhi

## RC-FR-059 Hierarki agen [partial]
Bukti: packages/runtime/src/rpc.ts:1715-1719 depth dihitung dari parent dan ditolak saat depth >= max_depth; packages/shared/src/errors.ts:25 daftar kode error tidak memuat E_AGENT_DEPTH; packages/shared/src/config.ts:78-79 max_depth default 2 dan max_children default 8; packages/runtime/src/rpc.ts:1761 path hierarki dibentuk dari path induk; packages/storage/src/agent-repos.ts:38-77 createSubagent menyimpan id, parent_id, depth, dan path; packages/storage/src/agent-repos.test.ts membuat pohon, menghitung anak aktif, dan menyusun forest
Gap:
- Butir 1: max_depth dapat diset 3 sehingga mengizinkan empat tingkat termasuk root (config.ts:78, rpc.ts:1717)
- Butir 4: tidak ada cek agen menjadi parent bagi dirinya sendiri (agent-repos.ts:38-77 langsung insert parent_id)
- Butir 5: tidak ada deteksi siklus parent-child saat spawn (tidak ada penelusuran parent_id di rpc.ts:1699-1765)
- AC: spawn tingkat keempat melempar E_PERMISSION, bukan E_AGENT_DEPTH (rpc.ts:1717-1719)

## RC-FR-060 Pencegahan konflik file [partial]
Bukti: packages/runtime/src/tools/index.ts:126-149 acquireLeases sebelum tulis dan melempar E_LEASE_CONFLICT; packages/storage/src/work-repos.ts:437-461 TTL default 60 detik dan penolakan lease aktif; packages/storage/src/work-repos.ts:463-472 releasePathLease per path/sesi/agen; packages/runtime/src/tools/index.ts:109 TTL lease 300000 ms; packages/runtime/src/code-tools.ts:290-292 pemeriksaan expected_sha256 bila dikirim pemanggil; packages/runtime/src/code-tools.ts:330-335 verifikasi hash setelah penulisan; packages/runtime/src/tools.test.ts mencatat edit ke transaksi dan menolak lease milik sesi lain; packages/storage/src/work-repos.test.ts mencatat approval dan lease path
Gap:
- Butir 1: lease tidak punya heartbeat berkala; heartbeat_at hanya diisi saat acquire (work-repos.ts:454-458)
- Butir 3: perubahan di luar agen hanya terdeteksi bila pemanggil mengirim expected_sha256, tidak ada hash acuan otomatis (code-tools.ts:290-292)
- Butir 4: tidak ada merge queue untuk perubahan bentrok; konflik langsung ditolak E_LEASE_CONFLICT (tools/index.ts:135-145)

## RC-FR-061 Lifecycle dan monitoring agen [partial]
Bukti: packages/storage/src/schema-v3.ts:117 status agen memakai idle/running/blocked/waiting/done/failed/cancelled; packages/storage/src/agent-repos.ts:108-113 heartbeatSubagent menulis heartbeat_at; packages/runtime/src/rpc.ts:1798-1805 interval heartbeat memakai config.subagents.heartbeat_ms; packages/storage/src/agent-repos.ts:217-233 agen tanpa heartbeat 60 detik ditandai failed dengan error orphaned; packages/cli/src/main.ts:444-450 printAgentTree menampilkan id, profil, status, langkah, biaya, goal; packages/runtime/src/dashboard.ts:210 kolom dashboard agents hanya nama, peran, status, model; packages/runtime/src/dashboard-data.ts:100-102 dashboard mengambil seluruh baris agents; packages/storage/src/agent-repos.ts:115-129 finishSubagent menyimpan result_json; packages/storage/src/agent-repos.test.ts memperbarui status, heartbeat, dan hasil akhir
Gap:
- Butir 1: status starting tidak ada dan status orphaned tidak pernah dipakai; orphan ditulis sebagai failed (schema-v3.ts:117, agent-repos.ts:226-231)
- Butir 2: /agents tidak menampilkan heartbeat (main.ts:444-448)
- Butir 4: transcript ringkas tidak disimpan; result_json hanya berisi ringkasan teks hasil (agent-repos.ts:115-129, rpc.ts:1890-1902)
- Butir 5: dashboard agents hanya nama, peran, status, model; langkah, biaya, dan heartbeat tidak tampil (dashboard.ts:210, dashboard-data.ts:100-102)

## RC-FR-062 Pembatalan dan pemulihan agen [partial]
Bukti: packages/runtime/src/rpc.ts:759-764 agent.cancel memanggil cancelSubagentTree dan abort controller tiap agen; packages/runtime/src/rpc.ts:1768-1771 abort induk diteruskan ke controller anak; packages/runtime/src/rpc.ts:1914-1919 finally melepas lease agen dan slot; packages/runtime/src/tools/index.ts:1332-1349 killTree membunuh proses shell saat abort; packages/storage/src/agent-repos.ts:197-215 cancelSubagentTree menandai seluruh turunan cancelled; packages/storage/src/agent-repos.test.ts membatalkan seluruh pohon dan menandai heartbeat basi sebagai orphan
Gap:
- Butir 1: releaseAgentLeases menghapus berdasarkan owner_agent_id, sedangkan lease tool hanya menyimpan session_id sehingga lease tidak dilepas lewat jalur ini (tools/index.ts:130-134, agent-repos.ts:265-267)
- Butir 2: session.cancel hanya abort controller induk dan tidak memanggil cancelSubagentTree, jadi status anak baru berubah saat turn anak gagal (rpc.ts:448-453)
- Butir 4: recovery orphan hanya berjalan saat agent.list, bukan saat start, dan menandai failed tanpa catatan keputusan (rpc.ts:738, agent-repos.ts:217-233)
- AC: tidak ada tes yang membuktikan semua anak berhenti <= 3 detik dan tidak ada proses yatim

## RC-FR-063 User memory [partial]
Bukti: packages/runtime/src/memory.ts:151-172 ekstraktor mengenali preference, rule, project, decision; packages/runtime/src/memory.ts:166 preferensi disimpan dengan scope global; packages/runtime/src/memory.ts:102-113 add menyimpan source dan expires_at; repos.ts:504-519 menyimpan created_at; packages/runtime/src/memory.ts:225-241 supersede menandai entri lama dan membuat pengganti; packages/storage/src/repos.ts:456-467 memoryFilter tidak memakai profile_id; packages/cli/src/main.ts:1352-1360 /memory menampilkan daftar/cari; main.ts:1378-1389 /forget menghapus; packages/runtime/src/memory-skills.test.ts mengekstrak preferensi eksplisit, melewati duplikat, dan menandai konflik
Gap:
- Butir 2: memory tidak terisolasi per profil; dua profil berbeda saling melihat entri karena memoryFilter tidak memakai profile_id (repos.ts:456-467)
- Butir 3: sumber pesan tidak disimpan sebagai id pesan; rememberFromTurn menulis string 'auto-extract' (memory.ts:175,203, agent.ts:437)
- Butir 4: preferensi bertentangan hanya mengembalikan daftar id konflik tanpa menandai entri lama superseded (memory.ts:184-190)

## RC-FR-064 Project memory [partial]
Bukti: packages/runtime/src/memory.ts:159-167 ekstraktor menyimpan kind project/decision/constraint; packages/storage/src/repos.ts:456-467 memory project difilter dengan project_path; packages/runtime/src/memory.ts:225-241 supersede menyimpan alasan pada tag entri lama; packages/runtime/src/memory.ts:94 batas 4.000 karakter; memory.ts:38,325 chunk knowledge maksimal 2.000 karakter; packages/runtime/src/memory.ts:243-258 export hanya mengeluarkan JSON; packages/runtime/src/memory-skills.test.ts mengambil memori global dan proyek yang relevan lalu membatasi ukuran prompt
Gap:
- Butir 3: keputusan yang diubah tidak membuat versi baru; updateMemory menimpa baris dan version tetap 1 (repos.ts:573-584)
- Butir 4: tidak ada ekspor memory project ke RANN.md; CLI hanya mengekspor JSON (memory.ts:243-258, cli/main.ts:3140-3146)
- Butir 3: alasan perubahan hanya tag reason pada entri lama, bukan catatan versi terstruktur (memory.ts:229-233)

## RC-FR-065 Session memory [partial]
Bukti: packages/runtime/src/memory.ts:338-353 summarizeSession menyimpan potongan pesan menjadi kind session_summary; packages/runtime/src/agent.ts:617-623 summarizeSession dipanggil saat compaction; packages/storage/src/repos.ts:456-467 scope session difilter dengan session_id; packages/runtime/src/rpc.ts:424-454 RPC sesi hanya create/list/get/send/cancel
Gap:
- Butir 1: ringkasan berisi potongan transkrip 300 karakter dari 40 pesan, bukan ringkasan keputusan/error/hasil (memory.ts:338-353)
- Butir 2: tidak ada pemisahan transkrip dan ringkasan; potongan pesan mentah 300 karakter disimpan sebagai memory session_summary (memory.ts:338-353)
- Butir 3: tidak ada penghapusan sesi atau promosi memory; RPC sesi tidak punya session.delete (rpc.ts:424-454)
- AC: ringkasan hanya dibuat saat compaction di tengah turn, tidak dijamin tersimpan saat sesi berakhir (agent.ts:617-623)

## RC-FR-066 Agent memory [missing]
Bukti: packages/runtime/src/memory.ts:10 opsi agentProfile ada; packages/runtime/src/memory.ts:64-72 belongsToAgent memfilter tag agent bila profil diisi; packages/runtime/src/rpc.ts:1811-1817 MemoryService untuk subagent dibuat tanpa agentProfile; packages/shared/src/config.ts:60-66 config memory hanya enabled, prompt_chars, retrieve; tidak ada tes isolasi memory antar agen
Gap:
- Butir 1: memory agen tidak terikat profil; agentProfile tidak pernah diisi sehingga semua memory project/global terbaca agen lain (rpc.ts:1811-1817)
- Butir 2: tidak ada penyaringan pengalaman berdasarkan peran agen saat menyimpan (memory.ts:151-172 hanya regex teks user)
- Butir 3: tidak ada izin baca antar agen; batas hanya tag agent yang tidak dipakai (memory.ts:68-72)
- Butir 4: tidak ada pelacakan efektivitas memory untuk menghapus yang tidak berguna
- Butir 5: tidak ada saklar memory per profil agen; hanya config.memory.enabled global (config.ts:60-66)

## RC-FR-067 Knowledge memory [partial]
Bukti: packages/runtime/src/memory.ts:289-335 indexKnowledge memindai berkas dan menyimpan chunk kind knowledge; packages/runtime/src/memory.ts:294 direktori berawalan titik dilewati; packages/runtime/src/memory.ts:322-330 chunk disimpan dengan tag path dan lines serta source file#L; packages/runtime/src/memory.ts:378-413 chunkKnowledge menyimpan heading, startLine, endLine; packages/runtime/src/memory.ts:41-44 renderEntry tidak menampilkan source/path; packages/cli/src/main.ts:3164-3175 perintah manual memory index; packages/shared/src/config.ts:60-66 config memory tidak punya daftar pengecualian knowledge
Gap:
- Butir 1: `.rann/knowledge` tidak terindeks saat root project karena direktori berawalan titik dilewati (memory.ts:294)
- Butir 3: path dan baris ada di source/tags tetapi tidak ditampilkan di prompt atau `/memory`, jadi sitasi tidak bisa dibuka dari hasil (memory.ts:41-44, cli/main.ts:1359)
- Butir 4: tidak ada reindex saat berkas berubah; hanya perintah manual `rann memory index` (cli/main.ts:3164-3175)
- Butir 5: tidak ada config pengecualian dokumen rahasia (config.ts:60-66)

## RC-FR-068 Procedural memory [missing]
Bukti: packages/runtime/src/memory.ts:151-172 ekstraktor hanya menghasilkan preference/rule/project/decision; packages/storage/src/schema-v3.ts:16-38 tabel memory tidak punya kolom trigger, prasyarat, langkah, verifikasi; packages/runtime/src/skills.ts:290-298 recordUse hanya mencatat uses/successes/failures skill; tidak ada tes procedural memory
Gap:
- Butir 1: tidak ada penyimpanan prosedur dengan nama, trigger, prasyarat, langkah, dan verifikasi
- Butir 2: tidak ada aturan promosi setelah berhasil >= 3 kali atau persetujuan pengguna
- Butir 3: tidak ada jalur mengubah prosedur menjadi skill; skill hanya dibuat manual lewat tool skill (tools/index.ts:1438-1462)
- Butir 4: tidak ada penandaan stale untuk prosedur yang gagal berulang
- Butir 5: tidak ada mekanisme prosedur sehingga prioritas terhadap instruksi eksplisit tidak diuji

## RC-FR-069 Ekstraksi otomatis dan review kandidat [partial]
Bukti: packages/runtime/src/agent.ts:435-450 rememberFromTurn dipanggil sebelum panggilan model; packages/runtime/src/memory.ts:151-172 kandidat berisi text, kind, scope, tags, confidence; packages/runtime/src/memory.ts:175-206 semua kandidat disimpan tanpa ambang keyakinan; packages/storage/src/schema-v3.ts:31 status pending ada tetapi tidak pernah dipakai; packages/runtime/src/rpc.ts:970-982 hanya ada update/remove entri final; packages/shared/src/config.ts:60-66 hanya ada saklar memory global; packages/runtime/src/memory-skills.test.ts mengekstrak preferensi eksplisit, melewati duplikat, dan menandai konflik
Gap:
- Butir 1: ekstraksi berjalan sebelum panggilan model, bukan setelah turn selesai (agent.ts:435-450)
- Butir 2: semua kandidat langsung disimpan; tidak ada ambang keyakinan atau antrean review (memory.ts:180-204)
- Butir 3: tidak ada penyaringan secret, data pribadi sensitif, atau instruksi sementara di ekstraktor (memory.ts:151-172)
- Butir 4: tidak ada aksi menyetujui/menolak/mengedit kandidat; yang ada hanya update/remove entri final (rpc.ts:970-982)
- Butir 5: ekstraksi tidak bisa dimatikan per profil atau per project; hanya config.memory.enabled global (config.ts:60-66)

## RC-FR-070 Retrieval dan pencarian semantik [partial]
Bukti: packages/runtime/src/memory.ts:126-148 penggabungan skor lexical, tag, dan recent dengan bobot 1/(60+rank); packages/storage/src/repos.ts:552-569 pencarian FTS5 dengan fallback LIKE; packages/storage/src/repos.ts:456-467 filter scope/project/session tanpa profile_id; packages/runtime/src/memory.ts:355-375 prompt dibatasi promptChars; packages/cli/src/main.ts:2249-2258 /recall tanpa opsi --explain; packages/runtime/src/memory-skills.test.ts mengambil memori global dan proyek yang relevan lalu membatasi ukuran prompt
Gap:
- Butir 1: tidak ada vektor/embedding; penggabungan hanya FTS, tag, dan recent (memory.ts:126-148, repos.ts:552-569)
- Butir 2: filter profil tidak diterapkan (repos.ts:456-467)
- Butir 3: skor tidak dikembalikan ke pemanggil dan tidak ditampilkan (memory.ts:143-147)
- Butir 4: tidak ada ambang relevansi; recent selalu digabung sehingga memory tidak relevan tetap diinjeksi (memory.ts:358-363)
- Butir 5: tidak ada `/recall --explain` (cli/main.ts:2249-2258)
- AC: tidak ada benchmark 10.000 memory dengan target < 80 ms p95

## RC-FR-071 Indeks dan prioritas memory [partial]
Bukti: packages/storage/src/schema-v3.ts:30,33 kolom importance dan last_used_at ada; packages/storage/src/repos.ts:518 importance default 0.5 saat insert; packages/runtime/src/memory.ts:133-147 peringkat hanya memakai urutan lexical/tag/recent; packages/storage/src/schema-v3.ts:16-38 tidak ada kolom embedding atau status embedding; packages/cli/src/main.ts:3193 subcommand memory hanya list/export/import/index/supersede
Gap:
- Butir 1: last_used_at tidak pernah ditulis (repos.ts:484-524)
- Butir 2: importance tidak dipengaruhi sumber, jenis, atau umpan balik; hanya nilai default 0.5 (repos.ts:518)
- Butir 3: memory yang sering dipakai tidak naik peringkat karena ranking mengabaikan importance dan last_used_at (memory.ts:133-147)
- Butir 4: tidak ada embedding asinkron maupun status pending/retry (schema-v3.ts:16-38)
- Butir 5: tidak ada `/memory reindex` atau reindex penuh (cli/main.ts:3193)

## RC-FR-072 Konsolidasi dan deduplikasi [partial]
Bukti: packages/storage/src/repos.ts:489-501 addMemory menggabungkan entri dengan teks persis sama; packages/runtime/src/memory.ts:192-201 dedup kemiripan token Jaccard >= 0.8; packages/runtime/src/memory.ts:184-190 kontradiksi dikembalikan sebagai daftar id; packages/storage/src/schema-v3.ts:34 kolom hash ada tetapi tidak pernah diisi; packages/runtime/src/memory.ts:243-258 dan cli/main.ts:3193 tidak ada stats konsolidasi; packages/runtime/src/memory-skills.test.ts mengekstrak preferensi eksplisit, melewati duplikat, dan menandai konflik
Gap:
- Butir 1: dedup memakai kesamaan teks persis dan Jaccard token, bukan hash isi + kemiripan vektor (repos.ts:489-501, memory.ts:192-201)
- Butir 2: entri yang digabung tidak menyimpan versi lama; baris lama diperbarui di tempat (repos.ts:492-500)
- Butir 3: tidak ada kolom atau penulisan contradicted_by; kontradiksi hanya dikembalikan ke pemanggil (memory.ts:184-190, schema-v3.ts:16-38)
- Butir 4: tidak ada konsolidasi berkala atau pemicu manual (tidak ada job konsolidasi)
- Butir 5: tidak ada laporan konsolidasi di `/memory stats` (cli/main.ts:3193)

## RC-FR-073 Expiry dan staleness [partial]
Bukti: packages/runtime/src/memory.ts:36 TTL default hanya transient 24 jam dan session 72 jam; packages/runtime/src/memory.ts:60-62 isExpired memfilter expires_at dan status expired; packages/runtime/src/memory.ts:116-120 visible hanya memakai status active dan tidak kedaluwarsa; packages/storage/src/schema-v3.ts:31 status yang diizinkan active/pending/expired/deleted; packages/storage/src/repos.ts:573-584 update tidak menyentuh last_used_at; packages/storage/src/gc.ts:15 gc menghapus dari tabel memories; packages/shared/src/config.ts:60-66 tidak ada konfigurasi TTL
Gap:
- Butir 1: TTL hanya hardcoded untuk transient/session dan tidak bisa diubah lewat config (memory.ts:36,100-101)
- Butir 2: entri kedaluwarsa tetap berstatus active dan tidak pernah menjadi stale (memory.ts:60-62, schema-v3.ts:31)
- Butir 3: last_used_at tidak diperbarui saat dirujuk dan TTL tidak diperpanjang (repos.ts:552-569)
- Butir 5: job pembersihan harian menghapus dari tabel `memories` yang sudah di-drop sejak migrasi v3 (gc.ts:15, schema-v3.ts:51-55)

## RC-FR-074 Koreksi, update, dan hapus [partial]
Bukti: packages/storage/src/repos.ts:573-584 updateMemory menimpa text/tags/kind; packages/storage/src/repos.ts:586-589 removeMemory menjalankan DELETE; packages/storage/src/schema-v3.ts:86-95 tabel memory_events tersedia; packages/storage/src/schema-v3.ts:70-73 trigger FTS memperbarui indeks saat update; packages/cli/src/main.ts:1378-1389 /forget memanggil memory.remove; probe: version tetap 1 setelah update dan memory_events tetap 0 baris
Gap:
- Butir 1: update tidak membuat versi baru dan tidak menyimpan alasan (repos.ts:573-584)
- Butir 2: hapus selalu hard delete tanpa soft delete atau konfirmasi (repos.ts:586-589, cli/main.ts:1378-1389)
- Butir 3: tidak ada vektor yang diperbarui; hanya trigger FTS dalam statement yang sama (schema-v3.ts:70-73)
- Butir 4: memory_events tidak pernah ditulis sehingga aktor, waktu, dan perubahan tidak tercatat (schema-v3.ts:86-95)

## RC-FR-075 Import, export, dan inspeksi [partial]
Bukti: packages/runtime/src/memory.ts:243-258 exportAll menghasilkan objek JSON version 1; packages/runtime/src/memory.ts:260-286 importAll hanya punya opsi replace; packages/cli/src/main.ts:3140-3146 export ditulis sebagai JSON pretty-print; packages/cli/src/main.ts:3149-3161 import membaca JSON dan mengirim flag replace; packages/cli/src/main.ts:1352-1360 /memory hanya list/search; packages/cli/src/repl-commands.ts:119 help /memory menjanjikan show/edit/rm/pin
Gap:
- Butir 1: export berupa satu objek JSON, bukan JSONL (memory.ts:243-258, cli/main.ts:3140-3146)
- Butir 2: import tidak mendeteksi konflik dan tidak menawarkan strategi lewati/timpa/gabung; hanya ada replace (memory.ts:260-286)
- Butir 3: `/memory` hanya daftar/cari, tanpa filter dan detail; show/edit/rm/pin tidak diimplementasikan (cli/main.ts:1352-1360)
- Butir 5: tidak ada penyaringan secret saat export (memory.ts:247-256)

## RC-FR-076 Instruction system [partial]
Bukti: packages/runtime/src/instructions.ts:36-57 memuat SOUL.md, USER.md, MEMORY.md, RANN.md global/project, AGENTS.md, CLAUDE.md, .rann/instructions.md, .rann/rules/*.md; packages/runtime/src/instructions.ts:96 label prioritas ditulis di header; packages/runtime/src/instructions.ts:69-99 berkas digabung sesuai urutan sources; packages/runtime/src/instructions.ts:87-93 konflik hanya mendeteksi pola 'jangan' vs 'selalu'; packages/runtime/src/agent.ts:451,547 loadInstructions dipakai dan hanya instructions.text yang masuk prompt; packages/cli/src/repl-commands.ts:136 /context berstatus NOT_YET
Gap:
- Butir 2: prioritas hanya label; isi digabung sesuai urutan push, aturan `.rann/rules` prioritas 50 justru paling akhir (instructions.ts:36-57,96)
- Butir 3: tidak ada instruksi spesifik per path yang mengalahkan file umum (instructions.ts tidak membaca aturan per direktori)
- Butir 4: konflik tidak menyebut pemenang dan hasil conflicts tidak dipakai saat membangun prompt (instructions.ts:87-93, agent.ts:451,547)
- Butir 4: `/context` belum tersedia sehingga pemenang tidak bisa dilihat (repl-commands.ts:136)

## RC-FR-077 Discovery dan metadata skill [partial]
Bukti: packages/runtime/src/skills.ts:9-21 (SkillInfo: name, description, triggers, version, dependencies, path, active); packages/runtime/src/skills.ts:92-115 (parser frontmatter trigger/dependencies); packages/runtime/src/skills.ts:184-192 (all() memindai builtin, global, project); packages/runtime/src/skills.ts:207-225 (list tanpa body, katalog metadata); packages/cli/src/main.ts:1439-1448 (handler /skills)
Gap:
- Bentrok nama antar scope tidak pernah dilaporkan ke pengguna: conflicts() ada di skills.ts:195-205 tetapi tidak dipanggil /skills maupun saat load.
- /skills hanya mencetak nama, scope, dan deskripsi (main.ts:1439-1448); trigger, versi, dan status aktif tidak tampil, sehingga AC juga tidak terpenuhi.

## RC-FR-078 Progressive loading [partial]
Bukti: packages/runtime/src/skills.ts:207-212 (list membuang body); packages/runtime/src/skills.ts:214-225 (katalog metadata untuk prompt); packages/runtime/src/skills.ts:278-288 (body penuh dimuat saat skill dipilih); packages/runtime/src/tools/index.ts:1442-1446 (body dibaca lewat action=view)
Gap:
- Tahap 3 tidak ada: tidak ada pembacaan folder references/ atau scripts/ di skills.ts.
- Tidak ada pencatatan jumlah token per tahap, baik di katalog, loadForTask, maupun log.
- Tidak ada budget referensi atau mekanisme melewati referensi opsional dengan catatan.
- Tidak ada penanda bagian wajib; parser hanya membaca name/description/version/source/trigger/dependencies (skills.ts:104-113).

## RC-FR-079 Aktivasi dan pemilihan skill [partial]
Bukti: packages/runtime/src/skills.ts:236-276 (skor trigger, kecocokan deskripsi, riwayat keberhasilan, default max 3); packages/runtime/src/skills.ts:271-274 (alasan pemilihan per skill); packages/runtime/src/skills.ts:283-286 (alasan ikut di blok prompt); packages/runtime/src/skills.ts:290-300 (recordUse mencatat sukses/gagal); packages/runtime/src/agent.ts:451-460 (pemilihan di awal turn)
Gap:
- Pengguna tidak bisa memaksa atau melarang skill lewat /skill: perintah itu hanya mencetak body (main.ts:1452-1462), sementara include/exclude hanya tersedia di RPC skill.select tanpa jalur CLI.

## RC-FR-080 Eksekusi skill [missing]
Bukti: packages/runtime/src/skills.ts:278-288 (skill disuntik sebagai teks prompt); packages/runtime/src/tools/index.ts:1416-1479 (aksi skill: list, view, create, remove, select, edit, history, rollback, validate); packages/runtime/src/agent.ts:451-465 (tidak ada eksekusi skrip skill)
Gap:
- Tidak ada eksekusi skrip skill: tidak ada folder scripts/ maupun runner per skill.
- Tidak ada cwd project, env terbatas, timeout, atau sandbox khusus skill; skill hanya teks yang masuk prompt.
- Tidak ada broker tool untuk skill dan tidak ada pencatatan output/error skill di trace.
- Tidak ada error terstruktur untuk kegagalan skill karena tidak ada eksekusi.

## RC-FR-081 Pembuatan dan validasi skill [partial]
Bukti: packages/cli/src/main.ts:2397-2416 (handler /create-skill); packages/runtime/src/skills.ts:343-363 (validator nama, deskripsi, body, dependensi, referensi); packages/runtime/src/skills.ts:393-405 (create dryRun mengembalikan pratinjau); packages/runtime/src/rpc.ts:1014-1022 (skill.create dryRun hanya memanggil validate); packages/runtime/src/skills.ts:406-432 (create langsung menulis SKILL.md)
Gap:
- /create-skill hanya meminta nama dan deskripsi; trigger, langkah, dependensi, dan contoh tidak ditanyakan (main.ts:2397-2406).
- Dry-run tidak dipanggil dari CLI, dan RPC dryRun hanya menjalankan validate, bukan menampilkan isi yang akan ditulis (rpc.ts:1008-1017).
- Skill baru langsung aktif setelah create; tidak ada status draft atau syarat disetujui/diuji (skills.ts:393-405, 432).
- Pembuatan skill oleh agent tidak punya persetujuan khusus, hanya mengikuti permission mode lewat assertAllowed (tools/index.ts:1462-1467).

## RC-FR-082 Edit dan versioning skill [partial]
Bukti: packages/runtime/src/skills.ts:392 (semverBump saat overwrite); packages/runtime/src/skills.ts:407-417 (versi lama disalin ke versions/ dan changelog aktor/alasan); packages/runtime/src/skills.ts:454-466 (history versi); packages/runtime/src/skills.ts:483-502 (rollback ke versi lama); packages/cli/src/main.ts:1452-1462 (handler /skill)
Gap:
- `/skill info` tidak ada; /skill <nama> hanya mencetak body tanpa versi, riwayat, atau changelog (main.ts:1452-1462).

## RC-FR-083 Dependensi skill [partial]
Bukti: packages/runtime/src/skills.ts:105-112 (dependencies dari frontmatter); packages/runtime/src/skills.ts:320-341 (dependensi dimuat lebih dulu, siklus ditolak, dependensi hilang melempar error); packages/runtime/src/skills.ts:278-288 (hasil withDependencies masuk prompt); packages/runtime/src/agent.ts:455-464 (pemanggilan loadForTask dibungkus try/catch)
Gap:
- Batas versi dependensi dibuang tanpa dicek: dependency.replace(/[@^~].*$/, "") di skills.ts:330.
- Dependensi hilang tidak menggagalkan aktivasi secara terlihat: error loadForTask ditelan agent.ts:462-464 dan turn lanjut tanpa pesan dependensi.

## RC-FR-084 Registry dan instalasi skill [partial]
Bukti: packages/runtime/src/skills.ts:516-549 (install folder lokal dan Git HTTPS dengan approve); packages/runtime/src/skills.ts:524-525 (tarball HTTPS ditolak); packages/runtime/src/skills.ts:551-589 (update memakai source); packages/runtime/src/rpc.ts:1061-1071 (RPC skill.install dan skill.update); packages/runtime/src/skills.ts:133-135,159 (checksum sha256 hanya untuk informasi)
Gap:
- Sumber HTTPS tarball tidak didukung; install() melempar E_TOOL_INVALID_ARGS untuk URL non-Git (skills.ts:524-525).
- Tidak ada verifikasi checksum atau signature untuk paket skill; checksum di SkillInfo hanya hash isi untuk informasi (skills.ts:133-135).
- Tidak ada pratinjau manifest, permission, atau skrip sebelum instalasi (skills.ts:516-549).
- Persetujuan eksplisit hanya untuk Git; folder lokal dan URL lain tidak dinilai sebagai sumber tidak tepercaya (skills.ts:521-523).
- Sumber instalasi tidak dicatat: install() tidak menulis source, sehingga update() gagal bila frontmatter tidak memuat source (skills.ts:546-548, 554-555).

## RC-FR-085 Hapus dan update skill [partial]
Bukti: packages/runtime/src/skills.ts:591-601 (remove menghapus folder); packages/runtime/src/skills.ts:551-589 (update); packages/runtime/src/skills.ts:568-588 (perbandingan versi dan penulisan ulang); packages/runtime/src/skills.ts:483-502 (rollback); packages/cli/src/repl-commands.ts:126-127 (install-skill/update-skill NOT_YET)
Gap:
- Hapus tidak menyimpan audit: remove hanya rmSync lalu mengembalikan boolean (skills.ts:591-601).
- Update tidak menolak versi lokal yang lebih baru; ia hanya berhenti bila versi sama, selain itu menimpa (skills.ts:568-588).
- Update tidak menampilkan changelog atau konflik sebelum menimpa (skills.ts:577-588).
- Tidak ada penundaan untuk skill yang sedang dipakai; tidak ada lock atau status in-use (skills.ts:551-589).
- CLI /install-skill dan /update-skill berstatus NOT_YET sehingga alur update tidak bisa dijalankan dari sesi (repl-commands.ts:126-127).

## RC-FR-086 Registry tool bawaan [partial]
Bukti: packages/runtime/src/tools/index.ts:465-520 (definisi tool dan registry ToolDefinition); packages/runtime/src/tools/index.ts:1301-1344 (shell_run), 1416-1479 (skill), 1595-1780 (database sampai messaging); packages/runtime/src/providers/types.ts:24-28 (ToolSpec: name, description, parameters); packages/runtime/src/policy.ts:5 (ToolRisk read/write/exec/net/admin); packages/runtime/src/tools/index.ts:1301 (timeout default shell_run 120000); packages/cli/src/main.ts:1887-1890 (/tools string statis)
Gap:
- ToolSpec tidak punya skema output, permission, dan timeout default; hanya name, description, parameters (providers/types.ts:24-28).
- Tidak ada penanda tool tidak tersedia per platform; semua tool selalu didaftarkan (tools/index.ts:1801-1803).
- /tools mencetak string statis tanpa kategori, status, izin, atau skema (main.ts:1887-1890).
- Tidak ada konfigurasi project untuk mematikan tool bawaan; allowlist hanya AgentConfig.tools dari profil subagent (agent.ts:585-591, rpc.ts:788).

## RC-FR-087 Tool kustom dan eksternal [missing]
Bukti: packages/runtime/src/tools/index.ts:465-1780 (hanya definisi tool bawaan); packages/runtime/src/tools/index.ts:1801-1827 (toolSpecs/findTool/executeTool dari array statis); packages/cli/src/main.ts:2588-2612 (/tool list dan info); packages/cli/src/repl-commands.ts:129 (perintah /tool terdaftar)
Gap:
- Tidak ada pemuatan modul TypeScript dari .rann/tools/; grep seluruh packages tidak menemukan referensi .rann/tools.
- Tidak ada tool eksternal berbasis perintah dengan skema JSON; registry hanya array statis di tools/index.ts:465.
- Tidak ada deklarasi permission dan timeout untuk tool kustom karena tidak ada mekanisme registrasi.
- Tidak ada validasi skema saat registrasi tool.
- `/tool test` tidak ada, dan `/tool list` memanggil RPC tool.list yang tidak terdaftar di rpc.ts (main.ts:2592).

## RC-FR-088 Validasi skema dan chaining [partial]
Bukti: packages/runtime/src/tools/index.ts:457-463 (parse Zod, pesan menyertakan path dan issue); packages/runtime/src/tools.test.ts:117-121 (tes "memvalidasi argumen dan tool tak dikenal"); packages/runtime/src/tools/index.ts:1809-1827 (executeTool satu panggilan); packages/runtime/src/providers/types.ts:24-28 (tidak ada skema output)
Gap:
- Output tool tidak divalidasi Zod dan ToolSpec tidak punya skema output (providers/types.ts:24-28).
- Tidak ada chaining tool; executeTool hanya menjalankan satu tool (tools/index.ts:1809-1827).
- Permission per langkah chaining tidak dinilai karena chaining tidak ada.
- Output antara tidak disimpan sebagai artefak; addArtifact di work-repos.ts:543 tidak pernah dipanggil dari runtime.

## RC-FR-089 Permission, timeout, retry, dan log tool [partial]
Bukti: packages/runtime/src/tools/index.ts:1301-1344 (timeout shell, detached, kill process group); packages/runtime/src/agent.ts:1095-1109 (retry whitelist read-only); packages/runtime/src/agent.ts:862 (addToolCall dengan args ter-redaksi); packages/runtime/src/agent.ts:892-897 (status, output, exit code, durasi); packages/storage/src/db.ts:124-136 (tabel tool_calls tanpa trace id); packages/runtime/src/tools/index.ts:91-92 (MAX_OUTPUT_CHARS 100000)
Gap:
- Timeout default per tool tidak ada; hanya shell_run yang punya default 120000 ms (tools/index.ts:1301).
- Timeout mengembalikan {error:"timeout"} dengan exit 124, bukan error E_TOOL_TIMEOUT seperti AC (tools/index.ts:1341-1344).
- Retry hanya daftar tool read-only di agent, bukan matriks retry per tool (agent.ts:1095-1109).
- Log tool_calls tidak punya trace id; kolomnya id, session_id, turn_id, tool_name, args_json, status, exit_code, duration_ms (db.ts:124-136).
- Output besar dipotong tetapi tidak disimpan sebagai artefak; addArtifact tidak dipanggil (tools/index.ts:1316-1319, work-repos.ts:543).

## RC-FR-090 Cakupan kategori tool [partial]
Bukti: packages/runtime/src/tools/index.ts:1595 (database_query); packages/runtime/src/tools/index.ts:1615 (document_extract); packages/runtime/src/tools/index.ts:1631,1647 (image_info, image_transform); packages/runtime/src/tools/index.ts:1671 (package_run), 1694 (system_info), 1705 (schedule_task), 1728 (messaging_send); packages/runtime/src/system-tools.ts:10-29 (query read-only dan penolakan write); packages/runtime/src/system-tools.ts:51-90 (PDF via pdftotext, DOCX/XLSX via unzip); packages/runtime/src/system-tools.ts:92-126 (OCR tesseract, resize/crop ImageMagick); packages/runtime/src/system-tools.test.ts:10-31 (tes database dan dokumen .md)
Gap:
- Tidak semua kategori punya tes end-to-end: image, messaging, package, scheduling, browser, web_search, dan http_request tidak diuji lewat tool.run.
- Ekstraksi PDF, DOCX, dan XLSX tidak diuji; tes dokumen hanya memakai berkas .md (system-tools.test.ts:23-31).
- OCR, resize, dan crop tidak diuji dan bergantung pada binary tesseract/ImageMagick (system-tools.ts:92-126).
- Tidak ada tes messaging_send yang membuktikan pemakaian adapter gateway (messaging.test.ts tidak menyentuh tool).

## RC-FR-091 Konfigurasi dan transport MCP [partial]
Bukti: packages/shared/src/config.ts:124-146 (skema mcp.servers); packages/runtime/src/mcp.ts:136-186 (transport stdio); packages/runtime/src/mcp.ts:188-202 (transport HTTP); packages/shared/src/config.ts:355-359 (config project di-merge); packages/runtime/src/agent.ts:574-581 (kegagalan MCP tidak menjatuhkan turn); packages/cli/src/main.ts:2418-2476 (handler /mcp add/remove/list/reload); packages/cli/src/repl-commands.ts:130 (/mcp available=false)
Gap:
- Konfigurasi per server tidak punya field permission (config.ts:129-143).
- SSE bukan transport terpisah: nilai sse diperlakukan sebagai HTTP POST dengan header Accept, bukan aliran event (mcp.ts:139-140, 204-214).
- /mcp didaftarkan available=false sehingga handler add/remove/list/reload tidak bisa dipanggil dari sesi (repl-commands.ts:130, main.ts:1345-1350).
- /mcp add hanya menulis command/args atau url, tanpa env, header, timeout, atau permission; /mcp remove hanya set enabled=false (main.ts:2440-2471).
- Tidak ada validasi skema sebelum menyimpan; setConfigValue menulis TOML langsung dan skema baru dicek saat config dibaca (config-store.ts:49-66, config.ts:385-390).

## RC-FR-092 Discovery tool, resource, dan prompt [partial]
Bukti: packages/runtime/src/mcp.ts:96-134 (loadTools memanggil tools/list); packages/runtime/src/mcp.ts:101 (prefix mcp__<server>__); packages/runtime/src/mcp.ts:110-119 (nama, deskripsi, inputSchema); packages/runtime/src/mcp.ts:356-378 (callTool); packages/runtime/src/mcp.test.ts:58-70 (tes discovery dan call tool stdio)
Gap:
- Tidak ada pemanggilan resources/list atau prompts/list; hanya tools/list (mcp.ts:104).
- Resource dan prompt tidak disimpan dengan metadata dan tidak bisa dibaca saat dibutuhkan.
- Namespace memakai mcp__server__tool, bukan format server.tool (mcp.ts:101).
- Tidak ada penanganan notifikasi perubahan daftar; hasil discovery di-cache dan hanya direset saat reload (mcp.ts:87-94, 132).
- Skema tool tidak divalidasi; inputSchema yang bukan objek diganti {type:"object",properties:{}} dan tool tetap didaftarkan (mcp.ts:115-118).

## RC-FR-093 Autentikasi dan lifecycle MCP [partial]
Bukti: packages/shared/src/config.ts:136-138 (headers dan timeout_ms default 20000); packages/runtime/src/mcp.ts:204-214 (header auth dari config atau env:); packages/runtime/src/mcp.ts:235-256 (timeout request HTTP); packages/runtime/src/mcp.ts:332-343 (timeout request stdio); packages/runtime/src/mcp.ts:178-182 (proses exit menghapus state)
Gap:
- OAuth 2.1 tidak ada; tidak ada alur browser/device flow maupun penyimpanan token di secret store.
- Tidak ada restart otomatis dengan backoff; proses yang exit hanya menghapus state dan tidak dicoba ulang (mcp.ts:178-182).
- Tidak ada status connecting/ready/degraded/failed/disabled; mcp.list hanya melaporkan enabled dari config (rpc.ts:695-702).
- Default timeout 20 detik, bukan 30 detik seperti requirement (config.ts:138).

## RC-FR-094 Permission dan isolasi MCP [partial]
Bukti: packages/runtime/src/tools/index.ts:1810-1822 (tool MCP selalu risk exec); packages/runtime/src/mcp.ts:142-151 (env whitelist PATH/HOME/TEMP/LANG); packages/runtime/src/mcp.ts:153-158 (server stdio proses terpisah); packages/runtime/src/mcp.ts:368-377 (output dikembalikan apa adanya); packages/runtime/src/mcp.ts:380-388 (close seluruh server)
Gap:
- Permission tool MCP tidak ditentukan konfigurasi server; executeTool selalu memakai risk exec (tools/index.ts:1812-1819).
- Tidak ada pembatasan filesystem untuk server MCP; cwd diset tetapi server tetap bisa membaca path absolut (mcp.ts:153-155).
- Output MCP tidak ditandai sebagai konten tidak tepercaya; teks dikembalikan apa adanya ke model (mcp.ts:368-377).
- Tidak ada cara mematikan satu server tanpa menghentikan sesi; mcp.reload menutup seluruh manager (mcp.ts:380-388, rpc.ts:710-712).

## RC-FR-095 Instalasi dan registrasi plugin [partial]
Bukti: packages/runtime/src/plugins.ts:9-20 (manifest name, version, apiVersion, entry, permissions); packages/runtime/src/plugins.ts:108-139 (validateManifest); packages/runtime/src/plugins.ts:267-291 (instalasi folder); packages/runtime/src/plugins.ts:293-325 (tarball HTTPS dengan checksum); packages/runtime/src/plugins.ts:259-265 (penolakan nama bentrok); packages/cli/src/main.ts:1391-1398 (/plugins menampilkan status, versi, permission); packages/runtime/src/plugins.test.ts:52-64 (tes "memasang plugin nonaktif lalu bisa diaktifkan")
Gap:
- Plugin berstatus installed masih bisa dipanggil karena invoke menerima installed atau enabled (plugins.ts:410), jadi tidak benar-benar nonaktif sampai diaktifkan.

## RC-FR-096 Lifecycle dan dependensi plugin [partial]
Bukti: packages/runtime/src/plugins.ts:6 status plugin installed/enabled/disabled/error; packages/runtime/src/plugins.ts:342-353 enable memeriksa apiVersion dan keberadaan dependensi; packages/runtime/src/plugins.ts:362-364 markError menulis status error; packages/runtime/src/plugins.ts:407-448 invoke memakai proses anak, timeout, dan menandai error saat keluar bukan nol; packages/runtime/src/plugins.ts:376-390 update menyimpan salinan .previous dan menimpa folder; packages/runtime/src/plugins.ts:401-415 rollback memulihkan folder .previous; packages/runtime/src/plugins.ts:220-245 list menandai stale bila manifest lebih tua dari STALE_MS; packages/runtime/src/plugins.test.ts:52 "memasang plugin nonaktif lalu bisa diaktifkan"; packages/runtime/src/plugins.test.ts:78 "menandai plugin rusak sebagai error tanpa menjatuhkan manager"; packages/runtime/src/plugins.test.ts:92 "rollback memulihkan versi sebelumnya"
Gap:
- Dependensi hanya diperiksa keberadaannya, tidak dimuat berurutan: plugins.ts:349-353 tidak memanggil enable atau load dependensi lebih dulu.
- Plugin yang crash sebagai hook tidak ditandai error: hooks.ts:246-258 hanya mencatat outcome, tidak memanggil PluginManager.markError.

## RC-FR-097 API dan permission plugin [partial]
Bukti: packages/runtime/src/plugins.ts:11-23 manifest memuat permissions, hooks, tools, commands; packages/runtime/src/plugins.ts:122-132 permissions dibaca dan diteruskan ke PluginInfo; packages/runtime/src/plugins.ts:220-233 list mengembalikan permissions untuk ditampilkan; packages/runtime/src/tools/index.ts:1485-1511 plugin_call list/call menjalankan method di proses anak; packages/runtime/src/plugins.ts:407-459 invoke mengembalikan ChildResult terstruktur ok/error/output; packages/runtime/src/plugins.test.ts:106 "remove menghapus folder dan state"
Gap:
- Tidak ada API registrasi tool, command, provider, atau handler hook: manifest.tools dan manifest.commands di plugins.ts:18-19 hanya disimpan, tidak pernah dipasang ke ToolRegistry, CLI, atau registry provider.
- Permission tidak ditegakkan: plugins.ts:122-132 hanya menyimpan daftar permissions dan invoke di plugins.ts:407-459 tidak memeriksa permission sebelum menjalankan method.
- Batas akses penyimpanan tidak ada: proses anak di plugins.ts:423-436 mewarisi filesystem dan cwd penuh, jadi plugin bisa membaca path di luar direktorinya.

## RC-FR-098 Kompatibilitas dan update plugin [partial]
Bukti: packages/runtime/src/plugins.ts:45-67 satisfiesApiRange mendukung caret, tilde, perbandingan, dan OR; packages/runtime/src/plugins.ts:114-118 manifest dengan API tidak kompatibel ditolak dengan pesan versi tersedia; packages/runtime/src/plugins.ts:376-390 update menyimpan versi sebelumnya lalu menimpa; packages/runtime/src/plugins.ts:401-415 rollback memulihkan versi sebelumnya; packages/runtime/src/plugins.ts:220-245 stale dihitung dari mtime manifest; packages/runtime/src/plugins.test.ts:32 "mendukung caret, tilde, perbandingan, dan OR"; packages/runtime/src/plugins.test.ts:92 "rollback memulihkan versi sebelumnya"
Gap:
- Update tidak menampilkan changelog dan tidak meminta konfirmasi saat permissions berubah: plugins.ts:376-390 langsung menimpa, dan InstallOptions.approve di plugins.ts:39 tidak pernah dibaca.
- Pesan penolakan menyebut rentang yang diminta dan versi yang tersedia (plugins.ts:116-118), tetapi tidak menyebut versi minimum yang harus dipakai.

## RC-FR-099 Event hooks [partial]
Bukti: packages/runtime/src/hooks.ts:6-23 mendaftar 16 event termasuk SessionStart, PreToolUse, PostToolUse, Stop, PreCompact; packages/runtime/src/hooks.ts:34-52 payload berisi session_id, turn_id, cwd, dan field per event; packages/runtime/src/hooks.ts:180-181 urutan hook berdasarkan prioritas menurun; packages/runtime/src/hooks.ts:199-253 run berurutan, deny menghentikan rantai, modify diteruskan; packages/runtime/src/agent.ts:402 UserPromptSubmit, 968 PreToolUse, 1139 PostToolUse, 1144 ToolError; packages/runtime/src/hooks.test.ts:26 "menjalankan command berurutan sesuai prioritas dan mengirim payload JSON"; packages/runtime/src/hooks.test.ts:57 "on_error warn tidak memblokir, block memblokir"
Gap:
- Runtime hanya memancarkan 4 dari 16 event: agent.ts:402, 968, 1139, 1144; SessionStart, SessionEnd, PreTask, PostTask, AgentSpawn, AgentComplete, MemoryWrite, SkillLoad, ContextCompact, Stop, PreCompact, dan Notification tidak pernah dipanggil.
- Payload tiap event tidak divalidasi skema: HookPayload di hooks.ts:34-52 adalah objek longgar, jadi field wajib per event tidak dapat dipastikan.

## RC-FR-100 Konfigurasi, validasi, timeout, dan error hook [partial]
Bukti: packages/runtime/src/hooks.ts:26-33 HookConfig memuat event, command/path/url/plugin, timeout_ms, on_error; packages/runtime/src/hooks.ts:183-197 validate memeriksa event, kind, target, dan rentang timeout; packages/runtime/src/hooks.ts:60 DEFAULT_TIMEOUT 10.000 ms; packages/runtime/src/hooks.ts:213-247 empat kind: command, http, script, plugin; packages/runtime/src/hooks.ts:254-262 on_error warn melanjutkan, block menolak; packages/runtime/src/hooks.test.ts:67 "membunuh hook yang melewati timeout"; packages/runtime/src/hooks.test.ts:57 "on_error warn tidak memblokir, block memblokir"
Gap:
- Dry-run tidak menampilkan payload dan hasil: hooks.ts:206-208 hanya menandai skipped, tanpa mengembalikan body yang dikirim atau output yang akan dihasilkan.

## RC-FR-101 Arsitektur adapter provider [partial]
Bukti: packages/runtime/src/providers/types.ts:6-24 ChatMessage dan attachment; packages/runtime/src/providers/types.ts:30-37 ChatRequest; packages/runtime/src/providers/types.ts:45-49 antarmuka Provider hanya chat; packages/runtime/src/providers/index.ts:20-79 factory memilih adapter berdasarkan kind; packages/runtime/src/providers/sse.ts:14-49 parser SSE dipakai bersama; packages/runtime/src/providers/types.ts:51-53 estimateTokens heuristik karakter dibagi empat
Gap:
- Kontrak Provider belum lengkap: providers/types.ts:45-49 hanya punya chat; tidak ada method embed, listModels, health, countTokens, dan stream terpisah.

## RC-FR-102 Dukungan provider [partial]
Bukti: packages/runtime/src/providers/index.ts:20-35 memilih anthropic, gemini, openai-responses, openai, dan mock; packages/runtime/src/providers/openai.ts:1-60 adapter openai-compatible memakai base URL kustom; packages/runtime/src/providers/provider-contract.test.ts:51 "anthropic menormalkan teks, tool use, usage, dan stop"; packages/runtime/src/providers/provider-contract.test.ts:88 "gemini menormalkan parts dan usageMetadata"; packages/runtime/src/providers/provider-contract.test.ts:116 "openai responses menormalkan output_text dan function_call"; packages/runtime/src/providers/openai.test.ts:38 "membaca stream teks, tool call, dan usage"; packages/runtime/src/models.ts:5-17 capability per model dipakai router
Gap:
- OpenRouter tidak punya adapter atau kind sendiri: providers/index.ts:20-35 tidak mengenal openrouter, sehingga hanya bisa dipakai sebagai openai-compatible dengan base URL manual.
- Tidak ada contoh konfigurasi per adapter di repo; docs/tutorial-v1.0.0.md hanya memuat contoh OpenRouter, bukan anthropic, gemini, atau openai-responses.

## RC-FR-103 Manajemen kredensial [partial]
Bukti: packages/storage/src/secrets.ts:146-153 get mengambil kunci dari safeStorage; packages/storage/src/secrets.ts:164-198 set/delete menyimpan dan menghapus kunci per provider; packages/runtime/src/rpc.ts:1985-2014 provider.list mengembalikan key_hint empat karakter terakhir; packages/cli/src/main.ts:3086-3159 perintah rann provider login/add/test/remove mengelola kunci; packages/runtime/src/providers/index.ts:42-79 adapter menerima secrets dan process.env
Gap:
- Kunci dari environment tidak dipindahkan ke secret store saat first-run: tidak ada kode api_key_env atau first-run di packages/cli/src dan packages/runtime/src, jadi env tetap dibaca langsung.
- Perintah /provider add, /provider test, dan /provider remove tidak ada di REPL: main.ts:1951 hanya memilih provider yang sudah ada; add/test/remove hanya tersedia sebagai subcommand rann provider.

## RC-FR-104 Discovery dan registrasi model [partial]
Bukti: packages/runtime/src/models.ts:138-161 builtinDescriptor membangun descriptor dari katalog; packages/runtime/src/models.ts:187-213 resolveDescriptor menggabungkan config, tabel models, dan alias; packages/runtime/src/models.ts:285-310 registrySnapshot mengumpulkan model dari config dan DB; packages/runtime/src/models.ts:196-208 alias diselesaikan ke model dan provider; packages/runtime/src/rpc.ts:1969-1983 model.list mengirim descriptors; packages/cli/src/main.ts:1966-1975 /models menampilkan id, context window, dan capability; packages/cli/src/main.ts:2857 perintah rann models menampilkan harga
Gap:
- Discovery listModels tidak ada: registry hanya dibangun dari config.providers[].models dan tabel models (models.ts:285-310), tanpa memanggil endpoint /models provider.
- Model yang tidak tersedia tidak bisa ditandai: ModelDescriptor hanya punya deprecated (models.ts:45), tidak ada flag unavailable atau alasan tidak tersedia.
- /models di REPL tidak menampilkan harga: main.ts:1958-1966 hanya id, context window, dan capability; harga baru muncul di perintah CLI rann models (main.ts:2857).

## RC-FR-105 Capability registry [partial]
Bukti: packages/runtime/src/models.ts:5-17 mendaftar 12 capability; packages/runtime/src/models.ts:138-160 default capability per model dari katalog; packages/runtime/src/models.ts:163-174 mergeCapabilities menggabungkan override boolean; packages/runtime/src/router.ts:107-118 requiredCapability untuk coding, vision, dan embedding; packages/runtime/src/agent.ts:551-553 dan 583-590 tool tidak dipasang bila toolCalling false; packages/runtime/src/router.test.ts:26 "membuang model tanpa tool calling untuk coding"; packages/runtime/src/models.test.ts:98 "menganggap model tanpa tool calling tidak bisa memakai tool"
Gap:
- Kapabilitas yang tidak diketahui dianggap mendukung fitur utama: models.ts:140-144 memberi toolCalling, parallelToolCalls, dan structuredOutput true untuk model openai-compatible yang tidak ada di katalog, tanpa status unknown.
- Capability tidak bisa berasal dari provider atau dokumentasi: builtinDescriptor memakai katalog hardcoded (models.ts:64-135) dan override manual/DB (models.ts:207-232), tanpa jalur discovery atau pencatatan sumber.
- Hanya toolCalling, vision, dan embeddings yang dipakai untuk menyaring (router.ts:107-118, rpc.ts:1407-1409); capability parallelToolCalls, structuredOutput, reasoning, audio, pdf, dan promptCaching hanya metadata tanpa penegakan.
- Sumber kapabilitas tidak dicatat: tabel models hanya menyimpan capabilities_json boolean (packages/storage/src/model-repos.ts:31), tanpa kolom sumber atau waktu verifikasi, dan perubahan kapabilitas tidak masuk audit log.

## RC-FR-106 Context window dan tokenizer [partial]
Bukti: packages/runtime/src/providers/types.ts:51-53 estimateTokens heuristik karakter dibagi empat; packages/runtime/src/agent.ts:276-290 digestRows memotong tiap pesan lama; packages/runtime/src/agent.ts:306-336 buildChatContext dan ringkasan digest; packages/runtime/src/agent.ts:348 default maxTokens 24.000, keepRecent 20, summaryChars 6.000; packages/runtime/src/agent.ts:656-663 pengecekan contextWindow model ditambah reserve output; packages/runtime/src/memory.ts:46-52 dan 364 batas promptChars untuk memori; packages/cli/src/main.ts:2578-2585 /context menampilkan jumlah pesan dan estimasi token
Gap:
- Ambang 75% dan 90% tidak memakai context window model: status bar menghitung persentase dari config.context.max_tokens 24.000 (main.ts:970, 999-1003, 1026), dan kompaksi di agent.ts:306/348 juga memakai 24.000 tetap, bukan descriptor.contextWindow.
- Estimasi token hanya heuristik karakter dibagi empat (providers/types.ts:51-53); tidak ada tokenizer model dan tidak ada uji bahwa error estimasi ≤ 15 persen.
- Pemulihan overflow dari error provider tidak ada: E_CONTEXT_OVERFLOW langsung dilempar di agent.ts:656-663 tanpa kompaksi ulang atau retry dengan konteks lebih kecil.
- Ringkasan bertahap tidak ada: digestRows (agent.ts:276-290) memotong tiap pesan dan membuang sisanya, tanpa tahap yang menjaga goal, keputusan, error, path, dan hasil verifikasi secara eksplisit.
- Prompt caching tidak dikirim ke provider: capability promptCaching ada di models.ts:15, tetapi tidak ada cache_control atau penanda cache di providers/*.ts; cacheRead hanya dibaca dari respons.
- Anggaran retrieval file hanya per pembacaan: MAX_READ_CHARS 200.000 di packages/runtime/src/tools/index.ts:92, tanpa batas kumulatif per turn.
- /context tidak menampilkan komposisi context atau alasan pemotongan: main.ts:2578-2585 hanya jumlah pesan dan estimasi token.

## RC-FR-107 Streaming dan tool calling [partial]
Bukti: packages/runtime/src/providers/types.ts:39-43 ProviderChunk text, tool_call, usage, error, done; packages/runtime/src/providers/openai.ts:232-250 tool call dirakit dari delta lalu dikirim setelah selesai; packages/runtime/src/providers/anthropic.ts:160-179 tool call dikirim setelah input_json_delta lengkap; packages/runtime/src/agent.ts:851-1160 tool dijalankan berurutan; packages/runtime/src/providers/retry.ts:136-142 retry berhenti setelah ada chunk terkirim; packages/runtime/src/providers/openai.test.ts:38 "membaca stream teks, tool call, dan usage"; packages/runtime/src/providers/retry.test.ts:19 "tidak mengulang setelah teks terkirim"
Gap:
- Delta reasoning tidak ada: ProviderChunk (types.ts:39-43) hanya text, tool_call, usage, error, dan done; tidak ada reasoning atau thinking delta meski capability reasoning ada di models.ts:12.
- Tool call parsial tidak diekspos: argumen baru dikirim setelah JSON lengkap (anthropic.ts:179 dan openai.ts:245-250), sehingga UI tidak bisa menampilkan progres argumen.
- Tool call tidak dijalankan paralel: agent.ts:851-1160 memproses calls berurutan dan capability parallelToolCalls tidak dipakai.
- Resume stream tidak ada: retry.ts:136-142 melempar error bila sudah ada teks terkirim, dan agent.ts:735-739 menyimpan teks parsial lalu berhenti, bukan melanjutkan dari offset.

## RC-FR-108 Structured output dan multimodal [partial]
Bukti: packages/runtime/src/providers/types.ts:30-37 ChatRequest tidak punya responseFormat atau schema; packages/runtime/src/attachments.ts:7 hanya kind image, pdf, text; packages/runtime/src/attachments.ts:23-25 batas 20 MB per lampiran dan 50 MB total; packages/runtime/src/attachments.ts:95-107 validasi ukuran dan tipe dengan magic bytes; packages/runtime/src/attachments.ts:120-137 PDF diekstrak menjadi teks, bukan dikirim sebagai dokumen; packages/runtime/src/agent.ts:220-234 gambar dikirim sebagai attachment, teks/PDF digabung ke content; packages/runtime/src/rpc.ts:1404-1406 gambar ditolak bila model tanpa capability vision; packages/runtime/src/providers/openai.test.ts:101 "mengirim gambar sebagai data URL, bukan base64 di content teks"
Gap:
- Structured output belum ada: tidak ada responseFormat, json_schema, atau validasi output terhadap schema di providers/*.ts dan agent.ts.
- Audio tidak didukung: AttachmentKind di attachments.ts:7 hanya image, pdf, text, dan tidak ada jalur audio ke provider.
- PDF selalu diekstrak menjadi teks (attachments.ts:130-137), bahkan untuk model dengan capability pdf, sehingga PDF tidak dikirim sebagai dokumen multimodal.
- Output model tidak divalidasi ulang terhadap schema dan tidak ada perbaikan otomatis saat JSON tidak valid.

## RC-FR-109 Usage dan biaya [partial]
Bukti: packages/runtime/src/models.ts:327-341 costFor menghitung input, output, cache read, dan cache write; packages/runtime/src/agent.ts:817-828 recordUsage membawa token dan costUsd; packages/storage/src/repos.ts:370-386 usage_events menyimpan token, biaya, cache, provider_request_id, cost_source; packages/storage/src/schema-v4.ts:7 kolom provider_request_id ditambahkan; packages/shared/src/config.ts:117-123 budget per turn dan per hari; packages/runtime/src/models.test.ts:49 "memberi harga nol dan $? saat harga tidak diketahui"; packages/cli/src/main.ts:1910-1933 /usage, /cost, dan /budget menampilkan ringkasan sesi dan harian; packages/runtime/src/rpc.ts:843-855 budget.status memisahkan knownUsd dan unknownCost
Gap:
- provider_request_id tidak pernah diisi: ProviderChunk (providers/types.ts:39-43) tidak membawa id respons dan recordUsage dipanggil tanpa providerRequestId di agent.ts:817-828.
- Biaya tidak diketahui disimpan sebagai 0, bukan NULL: repos.ts:381 memakai input.costUsd ?? 0 sementara cost_source unknown di repos.ts:385; /budget menghitung unknown lewat rpc.ts:843-855, tetapi /cost di main.ts:1916-1924 tetap menjumlahkan nol tanpa peringatan.
- Registry harga builtin kosong: tidak ada entri pricing di CATALOG models.ts:64-135, jadi costFor selalu null untuk model bawaan; harga manual yang hanya sebagian diisi dilengkapi 0 di models.ts:238-240.
- Tidak ada budget per task: BudgetOptions di agent.ts:349 hanya maxTokensPerTurn, maxTokensPerDay, dan maxUsdPerDay; config tidak punya batas biaya per task.
- /cost dan /usage hanya ringkasan sesi: main.ts:1910-1924 tidak mengelompokkan per task, dan tidak ada perintah biaya per task.

## RC-FR-110 Kesehatan provider dan rate limit [partial]
Bukti: packages/runtime/src/providers/retry.ts:3 enam status health; packages/runtime/src/providers/retry.ts:60-88 recordFailure memetakan 429 ke rate_limited dan 401 ke auth_error; packages/runtime/src/providers/retry.ts:15-17 dan 84-88 circuit open 30 detik setelah 5 kegagalan dalam 60 detik; packages/runtime/src/rpc.ts:254-289 probe berkala 60 detik memanggil recordProbe; packages/runtime/src/providers/retry.ts:35-43 retryAfter dihitung dari Retry-After; packages/runtime/src/providers/retry.ts:101-104 backoff memakai Retry-After bila ada; packages/cli/src/main.ts:1978-1985 /providers menampilkan status dan latency; packages/cli/src/main.ts:993 status bar menampilkan kesehatan provider; packages/runtime/src/providers/retry.test.ts:42 "membuka circuit setelah lima kegagalan"
Gap:
- Health check on-demand tidak mencatat status, latensi, atau error: provider.test di rpc.ts:2015-2052 hanya memanggil chat dan mengembalikan hasil, tanpa providerHealth.recordSuccess atau recordFailure.

## RC-FR-111 Retry dan fallback [partial]
Bukti: packages/runtime/src/providers/retry.ts:97-108 backoff 1 detik lalu 2 detik, menghormati Retry-After; packages/runtime/src/providers/retry.ts:128-155 retryStream mengulang sebelum chunk pertama; packages/runtime/src/agent.ts:685-700 attempts 2 untuk provider utama dan 1 untuk fallback; packages/runtime/src/agent.ts:719-739 fallback dicoba bila belum ada teks, lalu teks parsial disimpan; packages/runtime/src/rpc.ts:1418-1438 daftar fallback dibangun dari config.model.fallback; packages/runtime/src/providers/sse.ts:51-65 pemetaan 429, 401, dan 5xx ke kode error; packages/runtime/src/providers/retry.test.ts:6 "mengulang stream yang gagal sebelum chunk pertama"; packages/runtime/src/agent-wiring.test.ts:152 "menyimpan teks parsial saat stream terputus"
Gap:
- Retry tidak mengikuti matriks ARCHITECTURE 13.3: agent.ts:685-687 memakai 2 percobaan untuk chat (matriks 3) dengan backoff 1s dan 2s tanpa jitter 0-250 ms; stream juga memakai backoff 1s, bukan 500 ms, dan tidak mengirim request id idempoten.
- Fallback tidak memeriksa pin: rpc.ts:1414-1437 membangun fallback dari config.model.fallback tanpa melihat config.routing.pinned atau pin per sesi, dan tidak ada allowFallback.
- Fallback tidak memeriksa capability setara atau lebih tinggi: rpc.ts:1414-1437 hanya memilih provider dan model dari config.model.fallback, tanpa membandingkan capability dengan model utama.
- Output parsial tidak disambung oleh fallback: agent.ts:735-739 melempar error begitu ada teks terkirim, jadi fallback tidak dijalankan.
- Rantai fallback dan biayanya tidak dicatat: recordRoutingLog di rpc.ts:1439-1444 tidak mengirim fallbackChain, dan biaya fallback tidak masuk usage karena hanya usage terakhir yang dicatat (agent.ts:817-828).
- Error akhir tidak memuat rantai percobaan: agent.ts:741 melempar lastProviderError apa adanya, tanpa daftar provider dan kode error yang dicoba.

## RC-FR-112 Alias dan pemilihan model [partial]
Bukti: packages/shared/src/config.ts:37-49 models mendukung aliases per model; packages/runtime/src/models.ts:196-208 alias diselesaikan ke model dan provider; packages/runtime/src/rpc.ts:1438 setTurnModel mencatat model per turn; packages/runtime/src/router.ts:131-143 pin mengembalikan model yang dipin; packages/cli/src/main.ts:1954-1963 /model tanpa argumen menampilkan model aktif dan daftar model; packages/runtime/src/router.test.ts:63 "menghormati pin dan alias"; packages/runtime/src/models.test.ts:34 "mengisi registry dari config dan menghormati override"
Gap:
- Sumber model tidak ditampilkan: /model di main.ts:1954-1963 hanya mencetak model aktif dan daftar model, tanpa asal alias atau provider.
- Opsi --pin tidak ada di CLI: parser perintah di packages/cli/src/main.ts tidak mengenal --pin, dan pin hanya bisa diatur lewat config.routing.pinned (config.ts:110).
- /model <nama> tidak menyimpan model ke sesi: main.ts:1954-1963 hanya mengubah variabel lokal yang dikirim sebagai override per turn, sehingga model kembali ke default setelah sesi atau proses baru.
- Model eksplisit tetap bisa diganti fallback: rpc.ts:1418-1438 selalu membangun fallback dan agent.ts:719-739 memakainya tanpa memeriksa apakah model diminta eksplisit.
- Alias tidak stabil lintas provider: models.ts:203-205 melempar E_CONFIG_INVALID bila alias menunjuk provider lain, jadi alias tidak bisa dipakai setelah provider diganti.
- Status bar menampilkan alias, bukan model asli: main.ts:993 memakai variabel model yang diisi teks /model, sehingga nama model hasil resolve tidak terlihat.

## RC-FR-113 Smart router [partial]
Bukti: packages/runtime/src/router.ts:11-25 bobot berbeda per jenis tugas; packages/runtime/src/router.ts:32-53 klasifikasi coding, review, reasoning, inspect, extraction, writing, vision, embedding; packages/runtime/src/router.ts:136-171 filter deprecated, health, capability, context window, dan minQuality; packages/runtime/src/router.ts:186-200 skor memakai quality, context, tool, cost, latency, health, dan prefer; packages/runtime/src/router.test.ts:20 "mengklasifikasikan tugas coding dan review"; packages/runtime/src/router.test.ts:43 "memilih model reasoning lebih kuat meski lebih mahal"; packages/runtime/src/router.test.ts:71 "memberi peringatan saat semua kandidat melebihi batas biaya"; packages/storage/src/model-repos.ts:154-181 routing_logs menyimpan requested, selected, reason, fallback_chain, latency
Gap:
- Skor dan alasan kandidat tidak disimpan: RouteDecision punya candidates dan rejected (router.ts:57-65), tetapi recordRoutingLog hanya menulis requested/selected/reason (model-repos.ts:154-181), dan tidak ada perintah /route why.
- Router tidak menerima informasi lampiran: routeModel hanya diberi prompt teks (rpc.ts:1385-1396), sehingga gambar tanpa kata kunci vision bisa memilih model non-vision dan baru ditolak setelah routing (rpc.ts:1407-1409).
- Tidak ada error saat tidak ada kandidat: router.ts:170-172 mengembalikan chosen null, lalu rpc.ts:1403-1404 diam-diam memakai model sesi, bukan error E_ROUTE_NO_CANDIDATE.
- Tidak ada pembelajaran dari hasil: ROUTE_WEIGHTS konstan di router.ts:11-25 dan tidak ada pembaruan bobot atau statistik kualitas dari usage maupun verifikasi.
- Klasifikasi tugas hanya regex kata kunci (router.ts:32-53), tanpa metadata task atau estimasi kompleksitas.

## RC-FR-114 Kebijakan routing dan override [partial]
Bukti: packages/shared/src/config.ts:106-116 routing mendukung mode auto/manual, policy, pinned, prefer, min_quality, max_cost_per_task, strict_budget; packages/runtime/src/router.ts:124-143 pin dihormati sebelum skoring; packages/runtime/src/router.ts:206-230 strict budget dan pemilihan termurah; packages/runtime/src/rpc.ts:1381-1402 routing otomatis hanya aktif bila mode auto dan model tidak eksplisit; packages/runtime/src/rpc.ts:1438-1445 override model per turn dicatat lewat setTurnModel dan routing_logs; packages/shared/src/config.ts:73-84 subagents.model untuk override per agen; packages/cli/src/main.ts:2387-2395 /route explain menampilkan keputusan routing
Gap:
- Policy hanya auto dan manual: config.ts:108 tidak mengenal cost-first, quality-first, latency-first, atau mode hemat biaya; router.ts:11-25 selalu memakai bobot balanced per task class.
- Tidak ada aturan routing kustom per project atau per task: schema routing di config.ts:106-116 hanya berisi prefer, pinned, dan ambang global.
- Log routing tidak memuat kandidat, skor, atau alasan yang bisa diperiksa: recordRoutingLog di rpc.ts:1439-1444 hanya mengirim requested, selected, dan reason; fallbackChain tidak diisi.
- Tidak ada opsi allowFallback: fallback di rpc.ts:1418-1438 selalu dibangun, sehingga override eksplisit tetap bisa dialihkan ke model lain.

## RC-FR-115 Operasi Git dasar [partial]
Bukti: packages/runtime/src/tools/index.ts:786-826 (git_read: status, diff, log, show, blame, branch, remote); packages/runtime/src/tools/index.ts:828-861 (git_write: stage, unstage, commit, branch_create); packages/runtime/src/tools/index.ts:925-930 (commit ditolak selama masih ada konflik); packages/runtime/src/git.ts:63-66 (trailer Rann-Code-Session); packages/runtime/src/tools.test.ts:256 (membaca status git dan commit dengan trailer sesi); packages/runtime/src/tools.test.ts:280 (menolak commit saat masih ada konflik)
Gap:
- Pesan commit tidak dibuat dari diff dan tidak ada editor untuk mengubahnya; git_write.commit hanya memakai message yang dikirim pemanggil (tools/index.ts:929).

## RC-FR-116 Checkpoint dan rollback [partial]
Bukti: packages/runtime/src/agent.ts:854-875 (snapshot file sebelum tool mutasi pertama dan checkpoint state step/plan/tool); packages/runtime/src/checkpoint-files.ts:125-163 (restore menyalin balik berkas dari manifest); packages/runtime/src/rpc.ts:815-828 (checkpoint.restore dan appendAudit); packages/cli/src/main.ts:2525-2545 (perintah /undo dengan konfirmasi); packages/runtime/src/checkpoint-files.test.ts:20 (membuat snapshot dan mengembalikan seluruh berkas); packages/runtime/src/checkpoint-files.test.ts:35 (menolak rollback bila berkas berubah tanpa force)
Gap:
- Checkpoint setelah verifikasi sukses tidak dibuat; hanya ada checkpoint pre_tool sebelum tool mutasi pertama (agent.ts:854).
- Rollback tidak mengembalikan state task dan tidak menghapus berkas yang dibuat setelah checkpoint; restore hanya menimpa berkas yang ada di manifest (checkpoint-files.ts:136-161).
- Riwayat checkpoint tidak bisa dibersihkan karena pruneFileCheckpoints tidak dipanggil dari RPC maupun CLI (checkpoint-files.ts:165).

## RC-FR-117 Worktree dan konflik [partial]
Bukti: packages/runtime/src/tools/index.ts:869-882 (worktree_create dengan branch rann/<name>); packages/runtime/src/tools/index.ts:893-904 (merge --no-ff lalu deteksi file konflik lewat diff --diff-filter=U); packages/runtime/src/tools/index.ts:884-891 (worktree_remove menolak worktree kotor); packages/runtime/src/tools/index.ts:906-923 (pull --ff-only dan push tanpa force)
Gap:
- Tidak ada merge queue; worktree_merge langsung menjalankan git merge ke workspace utama tanpa serialisasi antrean (tools/index.ts:893).
- Worktree yang sudah selesai tidak dibersihkan otomatis; penghapusan hanya manual dan gagal bila worktree kotor (tools/index.ts:884).
- Worktree tidak terikat pada task atau agen; nama dan branch dibuat manual oleh pemanggil (tools/index.ts:869).

## RC-FR-118 Browser automation dasar [done]
Bukti: packages/runtime/src/browser.ts:170-253 (navigate, click, type, scroll, select, extract, screenshot, evaluate, wait, download, upload, close); packages/runtime/src/browser.ts:176 (timeout per aksi dibatasi 1 sampai 120 detik); packages/runtime/src/browser.ts:211-217 (screenshot disimpan ke artifacts_dir); packages/runtime/src/browser.ts:228-237 (download disimpan sebagai artefak); packages/runtime/src/tools/index.ts:1537-1546 (aksi mutasi browser memerlukan approval); packages/runtime/src/browser.ts:166 (domain blokir ditolak E_PERMISSION)

## RC-FR-119 Isolasi sesi dan alur autentikasi browser [partial]
Bukti: packages/runtime/src/browser.ts:114-136 (context per taskKey, cookie dan storage terpisah); packages/runtime/src/browser.ts:121-125 (profil persisten memuat storageState bila persistent=true); packages/runtime/src/browser.ts:138-151 (close menghapus context dari map); packages/runtime/src/browser.ts:247-252 (pesan 2FA diterjemahkan menjadi E_APPROVAL_REQUIRED); packages/runtime/src/browser.test.ts:39 (menolak domain sensitif dan skrip jaringan; gagal dijalankan karena Chromium belum terpasang)
Gap:
- Profil persisten tidak bisa diaktifkan lewat tool karena skema browser tidak punya opsi persistent, dan storageState tidak pernah disimpan kembali setelah sesi (browser.ts:124).
- Tidak ada jalur kredensial login yang aman; nilai aksi type masuk sebagai argumen tool dan transkrip (browser.ts:193).
- Context tidak dihapus saat task selesai; hanya lewat aksi close, GC idle, atau shutdown daemon (browser.ts:138, rpc.ts:2083).

## RC-FR-120 Perbedaan search, fetch, dan browser [partial]
Bukti: packages/runtime/src/web.ts:206-212 (webSearch mengembalikan title, url, snippet); packages/runtime/src/web.ts:102-141 (httpFetch GET/HEAD/POST, robots, batas 5 MB, timeout 30 detik); packages/runtime/src/tools/index.ts:1516-1546 (tool browser untuk halaman yang butuh JavaScript atau interaksi)
Gap:
- Alasan pemilihan search, fetch, atau browser tidak dicatat di event, audit, maupun output tool.
- Tidak ada fallback otomatis; kegagalan httpFetch atau webSearch tidak mencoba metode lain yang masuk akal (web.ts:102,206).

## RC-FR-121 Eksekusi dan antrean background [done]
Bukti: packages/storage/src/job-repos.ts:59-89 (antrean persisten dan idempotency key); packages/storage/src/job-repos.ts:118-138 (klaim transaksional dengan lease); packages/runtime/src/rpc.ts:188 (concurrency worker dari config); packages/cli/src/main.ts:1671 (perintah /queue) dan 1702 (perintah /background); packages/storage/src/job-repos.test.ts:40 (mengantre dengan idempotency key dan klaim transaksional); packages/storage/src/job-repos.test.ts:54 (menyelesaikan job dan tidak menjalankannya ulang setelah restart)

## RC-FR-122 Persistensi dan pemulihan background [partial]
Bukti: packages/storage/src/schema-v4.ts:5-31 (tabel jobs, lease, dan idempotency key); packages/storage/src/job-repos.ts:226-250 (recoverStaleJobs mengembalikan ke queued atau menandai dead); packages/storage/src/job-repos.ts:240-247 (setiap pemulihan menulis job_events recovered); packages/runtime/src/background.ts:75-80 (pemulihan dijalankan saat worker start); packages/storage/src/job-repos.test.ts:78 (mengembalikan job running yang lease-nya kedaluwarsa)
Gap:
- Pemulihan tidak dicatat di audit; hanya job_events yang ditulis, tanpa appendAudit (job-repos.ts:240,247).

## RC-FR-123 Monitoring, cancel, retry, dan notifikasi [partial]
Bukti: packages/cli/src/main.ts:1702-1790 (/background status, logs, cancel, retry); packages/storage/src/job-repos.ts:214-224 (retryJob mengembalikan job failed/dead/cancelled ke queued); packages/storage/src/job-repos.ts:180-200 (dead letter setelah percobaan habis); packages/runtime/src/background.ts:151-156 (event done dan failed dipancarkan ke onEvent); packages/runtime/src/rpc.ts:1231-1245 (event job.update disiarkan ke WebSocket); packages/runtime/src/background.test.ts:19 (menjalankan job shell dan menyimpan keluarannya)
Gap:
- Cancel hanya mengubah status job di database; RPC background.cancel tidak memanggil AbortController milik worker, sehingga proses yang sedang berjalan tetap lanjut sampai selesai (rpc.ts:592-598, background.ts:132-160).
- Retry tidak punya pagar idempotensi efek samping; job yang sudah sebagian berjalan diantrekan ulang apa adanya (job-repos.ts:223-233).

## RC-FR-124 Jenis jadwal [partial]
Bukti: packages/runtime/src/scheduler.ts:52-72 (once, every, dan cron dengan timezone); packages/runtime/src/scheduler.ts:144-177 (tick mengantre job dan menghormati skip/queue/replace); packages/runtime/src/rpc.ts:600-687 (scheduler add, update, remove, run, history); packages/cli/src/main.ts:1789-1863 (/scheduler add, list, run, enable, disable, remove); packages/runtime/src/scheduler.test.ts:52 (mengenali once, every, dan cron dengan atau tanpa prefix)
Gap:
- Kebijakan replace tidak menghentikan job yang sedang running; cancelQueuedJobsForRun hanya membatalkan job queued, sehingga eksekusi lama tetap berjalan setelah run ditandai cancelled (scheduler.ts:153-157, job-repos.ts:215-220).

## RC-FR-125 Trigger, timezone, dan DST [partial]
Bukti: packages/runtime/src/scheduler.ts:57-63 (assertTimezone memvalidasi zona waktu); packages/runtime/src/scheduler.ts:65-72 (nextRunFor memakai Cron dengan timezone lokal); packages/runtime/src/scheduler.ts:86-110 (catchUp menentukan jalan sekali atau dilewati); packages/runtime/src/scheduler.test.ts:74 (menghitung interval dan menghormati timezone cron); packages/runtime/src/scheduler.test.ts:113 (melewati jadwal terlewat bila catch_up mati)
Gap:
- Trigger kondisional dan event tidak ada; scheduler hanya menerima once, every, dan cron, tanpa ekspresi status, tanggal, hasil job sebelumnya, atau event (scheduler.ts:52-72).

## RC-FR-126 Persistensi, riwayat, dan retry jadwal [partial]
Bukti: packages/storage/src/job-repos.ts:391-419 (job_runs menyimpan status, durasi, output, error); packages/storage/src/job-repos.ts:180-190 (backoff eksponensial dan max_attempts); packages/storage/src/job-repos.ts:421-428 (listSchedulerRuns dengan limit); packages/runtime/src/rpc.ts:654-687 (audit scheduler.run dan scheduler.update/remove); packages/cli/src/main.ts:1849-1863 (/scheduler history dengan --json)
Gap:
- Riwayat tidak bisa difilter status atau rentang tanggal; hanya limit, dan ekspor hanya berupa cetak JSON ke stdout (job-repos.ts:421).
- Batas waktu eksekusi memakai background.max_runtime_ms global, bukan batas waktu per job atau per jadwal (config.ts:88-91).
- Job yang gagal berulang tidak menonaktifkan jadwal dan tidak mengirim notifikasi; tidak ada pemanggilan updateScheduler saat job masuk dead letter.
- job_runs.attempt selalu diisi 1, sehingga percobaan retry tidak tercatat per eksekusi (job-repos.ts:399).

## RC-FR-127 Gateway server dan transport [partial]
Bukti: packages/runtime/src/gateway.ts:257-285 (HTTP server dan WebSocket server); packages/runtime/src/gateway.ts:327-355 (/v1/events dengan replay since); packages/runtime/src/gateway.ts:418-421 (/v1/health); packages/runtime/src/gateway.ts:244-255 (validasi tls_cert dan tls_key saat start); packages/shared/src/config.ts:173-185 (validasi host, port, public_url, TLS); packages/runtime/src/gateway.test.ts:70 (melayani health publik dan dashboard tanpa token)
Gap:
- Gateway membuka database langsung untuk pairing, device, audit, dan autentikasi (gateway.ts:191,209,216,361), melanggar larangan akses langsung ke database.

## RC-FR-128 Autentikasi dan pairing [done]
Bukti: packages/cli/src/main.ts:1625-1631 (perintah /pair menampilkan kode, URL, dan masa berlaku); packages/storage/src/gateway-repos.ts:53-60 (kode acak 8 karakter); packages/storage/src/gateway-repos.ts:39 (masa berlaku 10 menit); packages/storage/src/gateway-repos.ts:76-118 (redeem sekali pakai, token opaque, hash token); packages/runtime/src/gateway.ts:223-232 (revoke menutup koneksi WebSocket aktif); packages/runtime/src/gateway.ts:632-650 (rate limit 5 percobaan per 15 menit per IP); packages/cli/src/main.ts:1600-1638 (/gateway pair, devices, revoke); packages/storage/src/gateway-repos.test.ts:47 (menukar kode pairing sekali saja)

## RC-FR-129 Otorisasi, scope, dan RBAC [partial]
Bukti: packages/storage/src/gateway-repos.ts:41-50 (scopesForRole dan hasScope); packages/storage/src/gateway-repos.ts:138-170 (authenticate mengikat token ke profil); packages/runtime/src/gateway.ts:100-106 (requireScope); packages/runtime/src/gateway.ts:542 (approve membutuhkan scope approve); packages/runtime/src/gateway.ts:595-612 (penolakan otorisasi dicatat dengan required_scope); packages/storage/src/gateway-repos.test.ts:38 (memetakan role ke scope dan admin mencakup semua)
Gap:
- Tidak ada pemeriksaan kepemilikan resource; token read mana pun bisa membaca sesi atau perangkat lain lewat endpoint /v1/sessions.

## RC-FR-130 Routing sesi, task, dan eksekusi remote [partial]
Bukti: packages/runtime/src/gateway.ts:681-699 (pemetaan sessionId per device, channel, dan channelKey); packages/runtime/src/rpc.ts:1331-1344 (session.create); packages/runtime/src/rpc.ts:1353-1360 (session.send dan penolakan E_CONFLICT bila turn aktif); packages/runtime/src/messaging.ts:224-272 (sesi Telegram per chat dan thread); packages/runtime/src/messaging.test.ts:134 (meneruskan hasil turn ke chat yang terikat)
Gap:
- Sesi baru memakai process.cwd() sebagai project, bukan config.projectPath (rpc.ts:1336).
- Tidak ada antrean per sesi; session.send menolak E_CONFLICT saat turn lain masih berjalan (rpc.ts:1358).
- Sesi tidak terikat pada node asal; tidak ada field node atau mekanisme perpindahan node (gateway.ts:681-699).

## RC-FR-131 Health, reconnect, dan multi-node [partial]
Bukti: packages/runtime/src/gateway.ts:418-421 (/v1/health memanggil RPC health); packages/runtime/src/rpc.ts:1311-1327 (health berisi daemon, database, provider, background, scheduler); packages/runtime/src/gateway.ts:310-320 (recent event disimpan maksimal 1000); packages/runtime/src/gateway.ts:318-355 (replay event dengan since); packages/runtime/src/gateway.ts:270-285 (heartbeat 20 detik dan terminate setelah 3 missed); packages/runtime/src/gateway.test.ts:70 (melayani health publik dan dashboard tanpa token)
Gap:
- Multi-node tidak ada; gateway hanya satu proses dengan satu database, tanpa routing berdasarkan project atau beban (gateway.ts:191).
- Node yang mati tidak dilaporkan karena tidak ada registry atau heartbeat antar-node.
- Reconnect dashboard memakai since=0 sehingga event lama dikirim ulang dan bisa menduplikasi pesan atau approval (dashboard.ts:312).

## RC-FR-132 Adapter Telegram [done]
Bukti: packages/runtime/src/messaging.ts:224-272 (sesi per chat dan message_thread_id); packages/runtime/src/messaging.ts:280-330 (/status, /cancel, /resume, /model, /cost, /approve, /deny); packages/runtime/src/messaging.ts:390-420 (approval inline dengan dampak dan alasan); packages/runtime/src/messaging.ts:458-487 (unduh foto dan dokumen masuk ke folder .rann/telegram); packages/runtime/src/messaging.ts:106-115 (pemotongan pesan dengan penanda terpotong); packages/runtime/src/messaging.test.ts:90 (memecah pesan panjang dengan penanda bagian); packages/runtime/src/messaging.test.ts:97 (membuat sesi dari chat yang diizinkan lalu mengirim prompt)

## RC-FR-133 Adapter Discord dan Slack [partial]
Bukti: packages/runtime/src/messaging-discord.ts:132-136 (allowlist channel dan role); packages/runtime/src/messaging-discord.ts:300-370 (pesan, thread, dan perintah teks); packages/runtime/src/messaging-discord.ts:469-490 (attachment disimpan ke artefak); packages/runtime/src/messaging-slack.ts:110-115 (allowlist user); packages/runtime/src/messaging-slack.ts:260-300 (pesan, thread, dan perintah teks); packages/runtime/src/messaging-slack.ts:399-480 (approval dikirim sebagai pesan Block Kit); packages/runtime/src/messaging-discord.test.ts:132 (poll memetakan satu pesan ke sesi dan membalas di thread); packages/runtime/src/messaging-slack.test.ts:124 (membalas di thread dan tidak memproses ulang cursor yang sama)
Gap:
- Discord dan Slack tidak mendaftarkan slash command atau endpoint interaction; perintah hanya diproses sebagai pesan teks (messaging-discord.ts:308, messaging-slack.ts:282).
- Slack hanya punya allowlist user, tidak ada access control per role (messaging-slack.ts:110).

## RC-FR-134 Web chat, lampiran, dan multi-user [partial]
Bukti: packages/runtime/src/gateway.ts:490-539 (rute /v1/sessions dan /v1/chat/ensure memakai RPC session.* yang sama dengan CLI); packages/runtime/src/dashboard.ts:256-306 (UI chat memanggil /v1/chat/ensure, /v1/sessions/:id, dan /v1/sessions/:id/messages); packages/runtime/src/gateway.ts:681-697 (ensureSession memetakan device, channel web, dan channelKey chat); packages/runtime/src/gateway.ts:71,659-673 (batas lampiran 20 MB dan penulisan ke artifactsDir); packages/runtime/src/dashboard.ts:57,274 (pesan dirender sebagai teks pre-wrap dengan esc); packages/runtime/src/gateway.ts:494-503 (session.get tidak memeriksa device pemilik)
Gap:
- Tombol Lampiran hanya membuka file picker; tidak ada handler change yang mengunggah berkas atau menyisipkan path ke prompt (dashboard.ts:256,266).
- Markdown dan blok kode tidak dirender; semua pesan di-escape dan ditampilkan pre-wrap (dashboard.ts:57,274).
- Riwayat dimuat lewat session.get tanpa limit, offset, atau parameter pencarian (gateway.ts:494-503).
- Tidak ada pemeriksaan kepemilikan sesi: token perangkat mana pun yang mengetahui id sesi bisa membaca transkrip sesi lain (gateway.ts:490-503).

## RC-FR-135 Halaman dashboard [partial]
Bukti: packages/runtime/src/dashboard.ts:86-104 (18 halaman: overview sampai settings); packages/runtime/src/dashboard.ts:194-202 (state Memuat dan error dari API); packages/runtime/src/dashboard.ts:65 (media query responsif); packages/runtime/src/dashboard-data.ts:90-227 (data nyata per halaman dari database dan config); packages/runtime/src/gateway.ts:461-475 (rute /v1/overview dan /v1/pages/*)
Gap:
- Dashboard hanya punya aksi buat kode pairing; tidak ada aksi ubah state lain, sehingga tujuan mengelola ekosistem tanpa CLI belum tercapai (dashboard.ts:241-246).
- Tidak ada dialog konfirmasi dan alasan untuk aksi berisiko karena tidak ada aksi berisiko yang diimplementasikan (dashboard.ts:238-247).

## RC-FR-136 Konsistensi dashboard, analytics, dan log [partial]
Bukti: packages/runtime/src/dashboard-data.ts:90-192 (halaman memakai listSessions, listTasks, summarizeUsage, dan events yang sama dengan CLI); packages/storage/src/repos.ts:391-410 (summarizeUsage mengagregasi usage_events); packages/runtime/src/dashboard.ts:309-318 (WebSocket hanya memuat ulang chat saat turn.end); packages/runtime/src/dashboard-data.ts:177-191 (log dan usage tanpa parameter filter)
Gap:
- Event hanya memicu refresh chat pada turn.end; perubahan model/config dari CLI tidak mendorong event atau refresh halaman lain (dashboard.ts:317-318).
- Analytics tidak menampilkan task sukses/gagal maupun latensi per provider; summarizeUsage hanya token dan biaya (repos.ts:391-410).
- Log tidak bisa difilter berdasarkan level, sesi, task, atau waktu; query hanya LIMIT (dashboard-data.ts:177-184).
- Tidak ada ekspor CSV atau JSON untuk usage dan log (tidak ada rute export di gateway.ts:461-539).

## RC-FR-137 Mode izin dan policy engine [partial]
Bukti: packages/shared/src/config.ts:20-25 (lima mode izin, default ask); packages/runtime/src/policy.ts:71-89 (decide dievaluasi runtime sebelum eksekusi); packages/runtime/src/tools/index.ts:1290-1296 (shell_run memanggil assertAllowed sebelum spawn); packages/runtime/src/gateway.ts:318-324 (viewer hanya mendapat scope read); packages/runtime/src/policy.ts:60-69 (rule mencocokkan tool dan command)
Gap:
- Rule tidak mendukung path atau domain; matchesRule hanya mencocokkan nama tool dan pola command (policy.ts:60-69).
- Tidak ada jalur ubah mode tersimpan yang dicatat di audit; mode hanya berasal dari config atau flag per request (rpc.ts:1341,1455).

## RC-FR-138 Sandbox filesystem [partial]
Bukti: packages/runtime/src/policy.ts:109-134 (resolveInsideWorkspace dan realpath untuk traversal/symlink); packages/runtime/src/tools/index.ts:463-490 (fs_read menolak path keluar workspace); packages/runtime/src/tools.test.ts: 'menolak symlink yang menunjuk keluar workspace'; packages/runtime/src/tools.test.ts: 'menjaga path tetap di dalam workspace'; packages/runtime/src/gateway.ts:504-514 (workspace root berasal dari sesi yang dibuat klien)
Gap:
- Hardlink tidak dideteksi; realpath hanya menyelesaikan symlink dan path relatif (policy.ts:114-125).
- Tidak ada daftar blokir untuk ~/.ssh, .env, atau kredensial; grep runtime tidak menemukan pengecekan path sensitif (tools/index.ts:463-490).
- Akses luar workspace hanya dikendalikan sakelar global workspace_only, tanpa izin eksplisit per path atau per permintaan (policy.ts:127-133).

## RC-FR-139 Batasan terminal dan approval perintah [partial]
Bukti: packages/runtime/src/tools/index.ts:446-455 (env shell dibersihkan dari variabel sensitif); packages/runtime/src/tools.test.ts: 'tidak mewariskan env sensitif ke shell'; packages/runtime/src/policy.ts:8-24 (pola shell berbahaya); packages/runtime/src/tools/index.ts:1301-1306,1333-1345 (cwd workspace, detached, kill process group saat timeout); packages/runtime/src/tools.test.ts: 'menolak perintah shell berbahaya dan melaporkan exit code'
Gap:
- Tidak ada penolakan atau pemeriksaan khusus untuk sudo; shell_run hanya memakai env yang dibersihkan dan policy tidak mencocokkan sudo (tools/index.ts:1290-1310, policy.ts:8-24).

## RC-FR-140 Secret management dan enkripsi [partial]
Bukti: packages/storage/src/secrets.ts:5,148-157 (XChaCha20-Poly1305); packages/storage/src/secrets.ts:34-66,84-98 (OS keychain dengan fallback file master.key 0600); packages/storage/src/secrets.ts:224-235 (rotasi master key); packages/storage/src/secrets.ts:238-246 (ekspor vault terenkripsi); packages/storage/src/secrets.test.ts: 'tidak menulis nilai plaintext ke disk'; packages/storage/src/secrets.ts:93 (pesan pemulihan saat master key hilang)
Gap:
- Penyaringan secret tidak mencakup semua error dan trace: hook ToolError memakai err.message mentah (agent.ts:1144), dan tidak ada jalur log/trace yang menerapkan redactSecrets.

## RC-FR-141 Autentikasi pengguna dan RBAC [partial]
Bukti: packages/storage/src/gateway-repos.ts:5-36 (role owner, operator, approver, viewer dan scope-nya); packages/runtime/src/gateway.ts:407-414 (token perangkat wajib untuk semua rute non-publik); packages/runtime/src/gateway.ts:429-458 (pairing, daftar perangkat, dan ubah role hanya untuk scope admin); packages/runtime/src/gateway.ts:223-231 (pencabutan menutup WebSocket perangkat); packages/runtime/src/gateway.test.ts: 'membatasi pembuatan kode pairing ke owner dan mencatat percobaan gagal'
Gap:
- Tidak ada pengguna lokal dengan identitas dan role di luar perangkat gateway; tabel gateway_users tidak dipakai dan RPC lokal tidak punya autentikasi (gateway-repos.ts:8-18).
- Perubahan role dan pencabutan akses tidak dicatat di audit_log; setRole/revoke langsung menulis database (gateway.ts:223-236).

## RC-FR-142 Isolasi sesi dan agen [partial]
Bukti: packages/storage/src/repos.ts:120-135 (getSession hanya memfilter id); packages/storage/src/repos.ts:491-501 (searchMemories tanpa filter profile atau sesi); packages/runtime/src/browser.ts:113-134 (context browser dipisah per taskKey); packages/runtime/src/tools/index.ts:1546 (taskKey browser memakai sessionId); packages/runtime/src/agent.ts:862-877 (tool call dan event membawa session_id)
Gap:
- Query sesi, pesan, dan memori tidak selalu memfilter profile_id; getSession dan searchMemories hanya memakai id atau scope (repos.ts:120-135,491-501).
- Memory dapat dibaca lintas sesi karena searchMemories tidak menerima session_id maupun profile_id (repos.ts:491-501).
- session.get di gateway tidak memeriksa pemilik sesi, sehingga transkrip dapat dibaca lintas perangkat (gateway.ts:494-503).
- Context browser dipisahkan per sesi, bukan per task (tools/index.ts:1546).
- Tidak ada pencatatan insiden saat akses lintas sesi terdeteksi; tidak ada tabel atau kode incident (grep runtime/storage tidak menemukan).

## RC-FR-143 Isolasi plugin dan MCP [partial]
Bukti: packages/runtime/src/plugins.ts:407-420 (plugin dijalankan proses terpisah dengan env PATH, HOME, RANN_PLUGIN_API); packages/runtime/src/mcp.ts:142-158 (server stdio terpisah dan env whitelist); packages/runtime/src/agent.ts:149-155 (labelToolOutput untuk output tool); packages/runtime/src/plugins.ts:410 (plugin nonaktif menolak invoke); packages/runtime/src/tools/index.ts:1485-1499 (plugin_call memakai permission dan output tool)
Gap:
- Permission yang dideklarasikan plugin tidak ditegakkan; invoke tidak memeriksa manifest.permissions dan proses anak tetap bisa membaca filesystem serta jaringan (plugins.ts:407-420).
- Akses file dan jaringan MCP tidak dibatasi permission server; env dibatasi tetapi proses tetap bebas membaca path absolut dan membuka koneksi (mcp.ts:142-158).
- Percobaan akses yang ditolak tidak dicatat sebagai audit atau insiden (plugins.ts:407-420, mcp.ts:142-158).

## RC-FR-144 Audit log [partial]
Bukti: packages/storage/src/repos.ts:693-703 (appendAudit dengan prev_hash dan hash); packages/storage/src/repos.ts:705-720 (exportAuditJsonl); packages/storage/src/repos.ts:722-739 (verifyAuditChain); packages/runtime/src/agent.ts:899-910 (audit tool.call dan approval); packages/runtime/src/rpc.ts:861-888 (audit secret.set, export, rotate, remove); packages/runtime/src/gateway.ts:600 (audit aksi gateway)
Gap:
- Perubahan config dan perubahan izin tidak diaudit; config hanya ditulis lewat setConfigValue tanpa appendAudit (config-store.ts:49-100).
- Akses baca secret tidak diaudit; secret.list mengembalikan metadata tanpa entri audit (rpc.ts:857-858).
- Audit tidak dilindungi dari penghapusan oleh agent: tidak ada trigger atau izin khusus pada audit_log (db.ts:154-166).
- Tidak ada retensi atau pengarsipan audit; gcStorage tidak menyentuh audit_log (gc.ts:10-31).

## RC-FR-145 Pertahanan prompt injection [partial]
Bukti: packages/runtime/src/agent.ts:149-155 (labelToolOutput memberi trust tidak-tepercaya dan penutup data); packages/runtime/src/tools/index.ts:1810-1822 (semua output tool melewati label); packages/runtime/src/prompt-injection.test.ts: 'konten tidak tepercaya tidak bisa melonggarkan izin'; packages/runtime/src/prompt-injection.test.ts: 'perintah destruktif tetap butuh approval eksplisit'; packages/runtime/src/tools/index.ts:1242-1272 (goal_update hanya progres, bukan ubah goal); package.json:20 (CI menjalankan pnpm test lewat pnpm check)
Gap:
- Tidak ada pelacakan asal konten yang memaksa approval untuk aksi yang dipicu konten tidak tepercaya; mode trusted tetap mengizinkan eksekusi tanpa approval (policy.ts:85).

## RC-FR-146 Perlindungan operasi destruktif [partial]
Bukti: packages/runtime/src/policy.ts:8-20 (pola rm -rf, reset hard, clean, push force, branch -D, drop, migrasi turun); packages/runtime/src/policy.ts:26-43 (alasan dampak per pola); packages/runtime/src/policy.ts:71-76 (destruktif butuh approval, read-only deny); packages/runtime/src/agent.ts:854-876 (checkpoint file sebelum tool mutasi); packages/runtime/src/agent.ts:899-910 (audit tool.call dan keputusan)
Gap:
- Overwrite berkas besar tidak dideteksi dan tidak meminta konfirmasi; tidak ada batas ukuran pada fs_write (tools/index.ts:486-490 hanya batas baca).

## RC-FR-147 Skema storage dan integritas [partial]
Bukti: packages/storage/src/db.ts:42-181 (tabel inti dengan foreign key); packages/storage/src/db.ts:107-121,210-225 (FTS messages dan memories lewat trigger); packages/storage/src/db.ts:284-306,317-361 (migrasi versioned, checksum, backup sebelum migrasi); packages/storage/src/db.ts:368-375 (integrity_check dan foreign_key_check); packages/cli/src/main.ts:653-664 (doctor menjalankan inspectDatabase); packages/storage/src/db.test.ts: 'menyediakan seluruh tabel skema V1'
Gap:
- Tidak ada indeks vektor atau embedding; grep vector/embedding di storage dan runtime tidak menemukan implementasi (db.ts:42-225).
- Garbage collection tidak menghapus blob tanpa referensi dan tidak menyentuh audit_log; gcStorage hanya memori, artefak, dan events (gc.ts:10-31).
- AC database 1 GB tidak diuji; db.test.ts hanya memakai database kecil dan tidak ada benchmark 1 GB.

## RC-FR-148 Backup, restore, dan migrasi [done]
Bukti: packages/storage/src/db.ts:330-358 (backup sebelum migrasi dan restore otomatis saat migrasi gagal); packages/runtime/src/rpc.ts:239-253 (backup harian jika storage.daily_backup aktif, dengan gc); packages/storage/src/backup.ts:28-49 (VACUUM INTO, integrity_check, foreign_key_check, retensi); packages/storage/src/backup.ts:76-91 (restore memverifikasi backup, membuat safety copy, dan memverifikasi hasil); packages/storage/src/db.test.ts: 'memulihkan backup kalau migrasi gagal'; packages/cli/src/main.ts:600-622 (rann backup create/list/verify/restore dan penolakan saat daemon hidup)

## RC-FR-149 Hierarki dan struktur konfigurasi [partial]
Bukti: packages/shared/src/config.ts:328-394 (default, global, profil, project, env, flag); packages/shared/src/config.ts:396-406 (explainKey mengembalikan nilai dan sumber); packages/shared/src/config.test.ts: 'melaporkan sumber nilai lewat explainKey'; packages/runtime/src/paths.ts:21-68 (direktori 0700 dan file privat 0600); packages/cli/src/main.ts:625-724 (config get/explain dan doctor)
Gap:
- Lapisan sesi tidak ada; loadConfig berhenti pada flag dan tidak menerima override per sesi (config.ts:328-383).
- Field invalid tidak memakai default dan tidak ditandai; seluruh config ditolak dengan E_CONFIG_INVALID (config.ts:385-391).
- Struktur direktori belum mengikuti ARCHITECTURE 9.2: tidak ada providers, models, memory, skills, agents, plugins, tools, sessions, tasks, scheduler, gateway, cache, dan permissions.toml (paths.ts:36-68).
- Tidak ada migrasi config yang membuat backup atau menjaga field lama; setConfigValue menulis langsung ke config.toml (config-store.ts:49-100).

## RC-FR-150 Operability, performa, dan distribusi [partial]
Bukti: packages/cli/src/main.ts:625-694 (doctor memeriksa node, permission home, socket/daemon, database, config, provider); packages/runtime/src/rpc.ts:2062-2086 (close menghentikan timer, abort turn, tutup server dan database); deploy/rann@.service:14-30 (systemd dengan Restart=on-failure); deploy/com.rann.daemon.plist:44-53 (launchd KeepAlive); Dockerfile:13-45 (image Docker dengan user non-root); install.sh:107-118 (unduh tgz rilis lalu npm install -g)
Gap:
- rann doctor tidak memeriksa versi aplikasi, sandbox, atau gateway; yang diperiksa hanya versi Node, permission home, socket, database, config, dan provider key (main.ts:630-686).
- Graceful shutdown tidak menyelesaikan turn atau menyimpan checkpoint; close langsung abort semua turn dan menutup database tanpa batas 5 detik (rpc.ts:2072-2086).
- Windows Service tidak ada dan installer tidak memasang unit systemd/launchd; berkas deploy hanya template manual (install.ps1 tidak memuat New-Service/sc.exe).
- Metrics dan trace tidak tersedia di CLI maupun dashboard; tidak ada endpoint atau perintah metrics/trace (gateway.ts tidak punya rute /metrics).
- Distribusi belum lengkap: tidak ada binary per platform, formula Homebrew masih template, dan installer tidak memverifikasi checksum (install.sh:107-118).

## RC-FR-151 Self-improvement terkendali [partial]
Bukti: packages/runtime/src/failure-analysis.ts:99-115 (analisis error per kode dengan saran tindakan); packages/runtime/src/skills.ts:290-296 (recordUse mencatat sukses/gagal per skill); packages/runtime/src/skills.ts:483-502 (rollback versi skill); packages/runtime/src/tools/index.ts:1417-1477 (skill create/edit/rollback lewat permission write); packages/runtime/src/agent.ts:879-888 (progres goal per tool)
Gap:
- Tidak ada evaluasi per task yang menggabungkan sukses/gagal, biaya, durasi, dan jumlah intervensi pengguna; usage dan task tidak dihubungkan (repos.ts:391-410).
- Tidak ada analisis pola kegagalan berulang; failure-analysis hanya memetakan satu error ke satu saran (failure-analysis.ts:99-115).
- Efektivitas tool tidak dilacak dan skill yang buruk tidak ditandai untuk ditinjau; recordUse hanya menghitung uses/successes/failures (skills.ts:290-296).
- Perubahan skill tidak punya validasi dan persetujuan khusus di luar permission mode write; config dan memory juga tidak memakai alur persetujuan perubahan (tools/index.ts:1463-1477).
- Rollback skill tidak dicatat di audit dan tidak ada rollback untuk perubahan config/tool/memory (skills.ts:483-502).

