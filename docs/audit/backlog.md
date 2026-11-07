# Backlog audit 151 FR

Total terbaca: 132. done 7, partial 121, missing 4.

Setiap butir gap harus ditutup dengan kode dan tes nyata sebelum 1.0.0.

## RC-FR-001 REPL interaktif [partial]
- Butir 1: `rann` tanpa argumen dengan stdout bukan TTY mencetak help (main.ts:128-130), bukan menjalankan mode non-interaktif.
- Butir 4: fase status hanya mengirim, menunggu model, dan menjalankan tool (stream.ts:74-84, 262-267); tidak ada fase memverifikasi dan selesai.
- Butir 5: Ctrl+D saat turn berjalan hanya menawarkan tunggu, batalkan, atau keluar (main.ts:1110-1116); tidak ada pilihan membiarkan turn berjalan di background.
- AC: header baru dicetak setelah ensureDaemon dan session.create (main.ts:918-960), sehingga tampil dalam 1 detik tidak dijamin dan tidak diuji.

## RC-FR-002 Slash command registry [partial]
- Butir 2: mengetik `/` tidak membuka palette; palette hanya dibuka Ctrl+K (line-editor.ts:484-486), sedangkan `/` hanya disisipkan sebagai karakter biasa.
- Butir 3: palette menyaring command tidak tersedia (main.ts:1038) dan opsi `hideUnavailable` tidak ada; daftar lengkap dengan alasan hanya muncul di `/help` (main.ts:1236-1250).
- Butir 4: command project tidak bisa menimpa command bawaan karena loader menolak nama inti (custom-commands.ts:143-146), sehingga prioritas project di atas bawaan tidak berlaku.
- AC: palette tidak muncul saat `/` ditekan, jadi AC palette < 100 ms tidak terpenuhi meskipun pencarian fuzzy di palette berfungsi.

## RC-FR-003 Autocomplete dan fuzzy search [partial]
- Butir 2: autocomplete tidak mencakup task dan MCP server; cabang kontekstual hanya model, provider, permission, theme, resume/history, skill, attach/files/export (main.ts:1068-1098).
- Butir 5: saat Tab tidak menemukan kandidat, line editor hanya render ulang tanpa saran terdekat (line-editor.ts:829-833); saran terdekat hanya untuk command slash tak dikenal (main.ts:1339-1342).

## RC-FR-004 Keyboard shortcuts [partial]
- Butir 3: PgUp dan PgDn ditandai "pakai scrollback terminal" (main.ts:1229) tetapi tidak dideteksi sebagai tidak tersedia; tidak ada penanda terminal yang tidak mendukung.
- Butir 4: `disabledShortcuts` dibaca (main.ts:1015-1025) tetapi tidak pernah diperiksa di handleAction (line-editor.ts:412-515), sehingga menonaktifkan shortcut tidak berpengaruh.
- AC: setelah dua Ctrl+C membatalkan turn, hitungan siklus tidak dilanjutkan; Ctrl+C ketiga saat idle hanya menampilkan petunjuk, bukan exit 130 (line-editor.ts:630-675).

## RC-FR-005 Multiline input dan editor eksternal [partial]
- Butir 4: multiline hanya diberi prefix dua spasi (line-editor.ts:979); tidak ada indentasi terstruktur atau syntax highlight dasar untuk blok kode di editor.

## RC-FR-007 Streaming response [partial]
- Butir 2: koneksi putus hanya mencetak `[stream terputus]` dan saran `/resume` (stream.ts:166-178); tidak ada pilihan lanjut atau ulangi.
- Butir 3: reasoning ditampilkan sebagai blok `[reasoning]` (stream.ts:233-241) tanpa mekanisme lipat.
- Butir 5: tidak ada reconnect; onClose langsung menyelesaikan turn gagal (stream.ts:166-178), jadi perilaku saat reconnect tidak diimplementasikan.

## RC-FR-008 Live tool execution display [partial]
- Butir 2: output tool tidak ditampilkan dalam keadaan terlipat; yang tampil hanya ringkasan 160 karakter (stream.ts:278-284), output penuh baru diambil saat Ctrl+O dan artefak hanya dibuat jika > 20.000 karakter (main.ts:1128-1136).
- Butir 3: blok shell menampilkan args dan exit code (stream.ts:271-286), tetapi tidak menampilkan working directory.
- Butir 5: tool yang ditolak hanya mengirim status error dan error_code (agent.ts:964), tanpa alasan policy; blok tool.end tidak menampilkan pesan penolakan.

## RC-FR-009 Task dan agent progress [partial]
- Butir 3: tidak ada penanda `replan`; plan.update hanya menerima status yang dikirim plan runtime (stream.ts:290-298, plan-runtime.ts:81-100).
- Butir 4: counter task done mencapai x/y sebelum verifyPlanLive dijalankan (stream.ts:306-310, agent.ts:791), sehingga 100 persen bisa tampil sebelum verifikasi.
- Butir 5: task background tidak punya notifikasi; `/tasks` hanya membaca plan.list (main.ts:2499-2514).

## RC-FR-010 Status bar [partial]
- Butir 3: hanya tiga zona warna; 50-74 dan 75-89 sama-sama kuning (main.ts:1000), zona oranye tidak ada.
- Butir 4: status provider ditampilkan (main.ts:1164-1168), tetapi fallback yang sedang aktif tidak ditampilkan.
- Butir 5: tidak ada pembacaan config untuk mematikan status bar; yang ada hanya pemendekan saat width < 64 (main.ts:1006).

## RC-FR-011 Approval dialog [partial]
- Butir 1: args dipotong 2.000 karakter di dialog (main.ts:876), jadi args lengkap tidak selalu tampil.
- Butir 2: untuk jaringan, dialog hanya menampilkan target atau URL, bukan metode HTTP (main.ts:860-886).
- Butir 4: audit approval.decision mencatat args dan remember (agent.ts:1119-1125), tetapi tidak mencatat alasan keputusan.

## RC-FR-012 Interrupt, cancel, dan resume [partial]
- AC: setelah dua Ctrl+C membatalkan turn, hitungan siklus tidak dilanjutkan; Ctrl+C ketiga saat idle hanya menampilkan petunjuk, bukan exit 130 (line-editor.ts:630-675).

## RC-FR-013 Terminal resize dan fallback [partial]
- Butir 3: `NO_COLOR` hanya mematikan warna (ui.ts:39-41), tetapi LineEditor tetap menulis escape cursor seperti `\u001b[0J` dan `\u001b[C` (line-editor.ts:992-1006), termasuk saat `--no-color`.
- Butir 4: tidak ada jalur fallback saat renderer TUI gagal dimuat; LineEditor hanya memakai readline untuk non-TTY, TERM=dumb, atau screen reader (line-editor.ts:192, 294).

## RC-FR-014 Non-interactive mode [partial]
- Butir 5: exit code turn hanya 0 atau 1 (main.ts:850); tabel ARCHITECTURE 13.4 tidak dipakai, misalnya E_PERMISSION dipetakan 5 dan E_BUDGET_EXHAUSTED 4 di errors.ts:55,77, sedangkan tabel meminta 3 dan 5.

## RC-FR-015 Piped input dan output [partial]
- Butir 1: isi stdin dipotong 200.000 karakter tanpa peringatan (main.ts:770), sehingga konteks besar hilang diam-diam.
- Butir 4: deteksi biner hanya `buffer.includes(0)` (main.ts:764); berkas biner tanpa byte NUL lolos sebagai teks, sedangkan gambar tetap didukung lewat @path.

## RC-FR-017 Shell passthrough [partial]
- Butir 3: `!` tidak memakai policy izin tool shell; mode read-only tidak dicek dan yang diperiksa hanya regex perintah berbahaya (main.ts:1269-1277).
- Butir 5: deteksi perintah berbahaya hanya regex terbatas (main.ts:1269), sehingga perintah berisiko di luar pola itu tidak meminta konfirmasi.

## RC-FR-018 Project dan session switching [partial]
- Butir 2: config project tidak dimuat ulang saat pindah project; daemon memuat config sekali saat start (daemon.ts:51) dan session.create memakai config global (rpc.ts:1326-1336). Indeks project juga tidak dibangun ulang saat switch.
- Butir 3: `/sessions` hanya mencetak id dan title (main.ts:2494-2498), tanpa status dan waktu terakhir.
- Butir 5: draft input hilang karena command `/project` atau `/resume` dikirim sebagai satu baris dan buffer editor di-reset (line-editor.ts:597-610); tidak ada penyimpanan draft.

## RC-FR-019 Lampiran dan multimodal input [partial]
- Butir 1: `@path` yang tidak ada dilewati diam-diam di CLI (main.ts:909), sehingga path tidak divalidasi dan prompt tetap dikirim tanpa lampiran.
- AC: `@path` tidak menampilkan konfirmasi lampiran; hanya `/attach` yang mencetak status (main.ts:2133), sedangkan extractAttachments tidak mencetak apa pun (main.ts:901-914).
- Butir 5: batas total 50 MB belum diuji; tes berjudul total 50 MB hanya memeriksa berkas 20 MB lebih (attachments.test.ts:66-72).

## RC-FR-039 Analisis kegagalan dan verifikasi [partial]
- Verifikasi hanya berjalan jika ada plan aktif; turn tanpa plan bisa selesai tanpa menjalankan kriteria apa pun.
- Setelah dua percobaan premature, turn tetap berstatus done meski gap verifikasi masih ada; tidak ada status verifying.
- Laporan kegagalan tidak memuat langkah yang sudah dicoba dan hipotesis, hanya cause dan action.
- Laporan sukses tidak merangkum file yang berubah, perintah verifikasi, dan hasil perintahnya.
- Tidak ada status unverified; gap verifikasi hanya ditempel sebagai teks 'Belum diverifikasi'.

## RC-FR-040 Eksplorasi repository [partial]
- README tidak dibaca atau diringkas; .md hanya dihitung sebagai bahasa Markdown di packages/runtime/src/project-map.ts:56.
- Tidak ada pembaruan incremental; packages/runtime/src/project-map.ts:332-337 memakai cache atau membangun ulang seluruh peta.
- Saat deteksi ambigu, packages/runtime/src/project-map.ts:285-288 hanya mencatat asumsi tanpa meminta konfirmasi ke pengguna.
- Tidak ada uji atau bukti waktu pemindaian 5.000 berkas dalam 30 detik.

## RC-FR-041 Pencarian kode semantik [partial]
- Tidak ada indeks simbol tree-sitter atau vektor knowledge chunk; pencarian hanya grep/substring, jadi AC pencarian semantik tidak terpenuhi.
- Pencarian tidak menghormati .gitignore; hanya daftar direktori hardcoded di packages/runtime/src/code-tools.ts:7-26.
- Hasil tidak diberi skor relevansi; urutan hanya urutan berkas dan baris.
- /index rebuild belum tersedia sehingga indeks tidak bisa dibangun ulang.

## RC-FR-042 Operasi file dasar [partial]
- write_file/fs_write tidak menerbitkan expected_sha256 di skema publik, sehingga penolakan menimpa berkas yang berubah tidak otomatis terikat pada hasil baca.
- Tidak ada mode hard untuk delete_file; fs_delete selalu memindahkan ke trash.
- Audit file_changes hanya mencakup fs_write, fs_edit, dan apply_patch; fs_delete, fs_read, fs_list, dan fs_stat tidak mencatat hash sebelum dan sesudah.

## RC-FR-043 Patch editing yang aman [partial]
- Opsi all=true meloloskan old yang muncul lebih dari sekali, padahal requirement mewajibkan edit gagal pada kemunculan ganda.
- Skema publik edit_file memakai old dan new, bukan old_string dan new_string seperti yang diminta requirement.

## RC-FR-044 Modifikasi multi-file dan transaksi [partial]
- Penolakan berkas yang berubah di luar transaksi hanya aktif jika caller mengirim expected_sha256; tanpa itu berkas tetap ditimpa.
- Hasil transaksi hanya memuat lines_before dan lines_after, tidak menghitung jumlah baris yang berubah.

## RC-FR-045 Code generation dan refactoring [partial]
- Tidak ada operasi rename simbol yang memperbarui semua referensi lintas berkas.
- Tidak ada indeks simbol atau pemeriksaan simbol publik yang hilang.
- Tidak ada bukti grep wajib sebelum kode dianggap tidak terpakai lalu dihapus.
- Gaya kode tidak dijalankan otomatis lewat tool; Prettier, ESLint, gofmt, dan rustfmt tidak terintegrasi ke alur edit.
- Tidak ada pemecahan otomatis perubahan besar menjadi patch yang bisa direview.

## RC-FR-046 Debugging dan diagnosis error [partial]
- Tidak ada pengumpulan otomatis error, stack trace, log, dan langkah reproduksi ke artefak.
- Hipotesis tidak dicatat sebagai state sebelum perubahan dan tidak diuji satu per satu oleh runtime.
- Tidak ada kewajiban tes regresi yang gagal sebelum perbaikan dan lulus sesudahnya.
- Tidak ada laporan terstruktur tentang area yang belum diperiksa saat penyebab tidak ditemukan.
- Tidak ada guard terhadap try/catch kosong atau any; larangan hanya ada di teks prompt.

## RC-FR-047 Generasi dan eksekusi tes [partial]
- Tidak ada deteksi framework atau generasi tes; /test hanya menjalankan perintah test yang sudah ada.
- Tidak ada ringkasan terstruktur jumlah lulus, gagal, dan skip; yang tersedia hanya output mentah.
- Tidak ada penandaan flaky atau eksekusi ulang maksimal dua kali.
- Tidak ada guard agar tes lama tidak dihapus atau dilemahkan untuk membuat hasil lulus.

## RC-FR-048 Code review [partial]
- Temuan tidak divalidasi terhadap skema path, baris, severity blocker/major/minor/nit, penjelasan, dan saran.
- Tidak ada filter yang membuang temuan tanpa lokasi atau tanpa alasan.
- Cakupan performa tidak diminta secara eksplisit oleh prompt /review maupun skill review-kode.
- Ringkasan tidak memisahkan temuan pasti dan dugaan secara terstruktur.
- Tidak ada parameter file; /review selalu menganalisis diff yang belum di-commit.

## RC-FR-049 Analisis arsitektur dan dependensi [partial]
- Siklus dependensi tidak diperiksa karena .dependency-cruiser.cjs:2-30 tidak memuat aturan no-circular.
- Package yang tidak terpakai tidak dideteksi.
- Lisensi dan ukuran dependency baru tidak dilaporkan.
- Parser untuk bahasa selain JavaScript dan TypeScript tidak tersedia.

## RC-FR-050 Build, lint, typecheck, dan dependency [partial]
- Makefile tidak dibaca sebagai sumber perintah.
- Jika perintah tidak terdeteksi, project_check melempar E_TOOL_FAILED; tidak bertanya dan tidak memakai perintah standar berlabel asumsi.
- Instalasi dependency tidak mencatat lockfile yang berubah.

## RC-FR-051 Integrasi Git [partial]
- Working tree kotor tidak dicatat sebagai baseline saat task dimulai; tidak ada snapshot diff awal.

## RC-FR-052 Dokumentasi dan inisialisasi project [partial]
- RANN.md hanya placeholder dan tidak memuat perintah, konvensi, atau batasan project.
- File config dibuat sebagai .rann/config.toml, tidak sesuai acceptance .rann/config.json.
- Tidak ada mekanisme memperbarui dokumentasi setelah perubahan besar.
- Tidak ada pilihan bahasa dokumentasi.

## RC-FR-053 Spawn subagent dan profil [partial]
- Konteks dari parent tidak disimpan di record spawn; hanya dikirim ke system prompt.
- Izin anak tidak diiris dengan permissionMode parent; packages/runtime/src/rpc.ts:1744-1746 hanya memakai flag read-only global.
- Profil bawaan reviewer tidak menetapkan model, sehingga model jatuh ke config atau model parent; AC profil reviewer belum terpenuhi.

## RC-FR-054 Specialisasi agent [partial]
- Profil architect, frontend, dan backend tidak ada.
- Tidak ada field output yang diharapkan pada SubagentProfile; hanya description/when/systemPrompt.
- Hasil dua agen specialisasi tidak digabung; task mengembalikan hasil per anak tanpa agregasi.
- Jika nama profil disebut, pickProfile memakai nama itu tanpa mempertimbangkan task; pemilihan berbasis task hanya saat profile kosong.

## RC-FR-055 Eksekusi paralel [partial]
- Concurrency tidak dibatasi per sesi; hanya ada max_per_turn dan max_children.
- Tidak ada pemeriksaan dependensi atau konflik lease sebelum task paralel dijadwalkan.
- Budget parent tidak mencakup anak; tiap anak memakai budget turn global di packages/runtime/src/rpc.ts:1876-1880.
- Tidak ada agregasi hasil paralel dengan status dan bukti masing-masing.
- Tidak ada uji 8 tugas independen yang membuktikan waktu paralel di bawah 60 persen waktu serial.

## RC-FR-056 Delegasi dan agregasi hasil [partial]
- Delegasi tidak menyertakan kriteria selesai, daftar file target, dan batas waktu.
- Hasil subagent tidak memuat evidence terstruktur; hanya text bebas.
- Klaim tanpa bukti tidak ditandai unverified dan tetap dianggap selesai.
- Konflik antar hasil tidak dideteksi atau dilaporkan.
- Tidak ada agregasi yang disimpan di task parent; hasil hanya tersimpan per agent.

## RC-FR-057 Komunikasi antar agen [partial]
- Tidak ada tool agent untuk mengirim atau menerima pesan; agent.message hanya RPC yang dipanggil CLI di packages/cli/src/main.ts:516.
- Tidak ada pemeriksaan parent, anak, atau peer tim; field from di packages/runtime/src/rpc.ts:777 adalah string bebas.
- Tidak ada mekanisme balasan atau pengiriman pesan ke konteks subagent yang sedang berjalan.
- Tidak ada eskalasi ke pengguna setelah konflik tiga pertukaran.
- Tabel bernama subagent_messages, bukan agent_messages seperti yang diminta requirement.

## RC-FR-058 Konteks bersama dan terisolasi [partial]
- Butir 1: mode shared tidak ada; keputusan dan artefak induk tidak dibagikan otomatis, hanya goal dan context manual (rpc.ts:1829-1836)
- Butir 4: anak tidak bisa meminta konteks tambahan; agent.message hanya dipanggil dari RPC/REPL dan tidak meminta persetujuan induk (rpc.ts:766-778)
- Butir 5: kebocoran memory antar agen tidak ditolak karena agentProfile tidak pernah diisi dan filter profil tidak dipakai (memory.ts:68-72, rpc.ts:1811-1817)
- AC: keputusan dan artefak tidak ikut dibagikan, jadi hanya sebagian AC yang terpenuhi

## RC-FR-059 Hierarki agen [partial]
- Butir 1: max_depth dapat diset 3 sehingga mengizinkan empat tingkat termasuk root (config.ts:78, rpc.ts:1717)
- Butir 4: tidak ada cek agen menjadi parent bagi dirinya sendiri (agent-repos.ts:38-77 langsung insert parent_id)
- Butir 5: tidak ada deteksi siklus parent-child saat spawn (tidak ada penelusuran parent_id di rpc.ts:1699-1765)
- AC: spawn tingkat keempat melempar E_PERMISSION, bukan E_AGENT_DEPTH (rpc.ts:1717-1719)

## RC-FR-060 Pencegahan konflik file [partial]
- Butir 1: lease tidak punya heartbeat berkala; heartbeat_at hanya diisi saat acquire (work-repos.ts:454-458)
- Butir 3: perubahan di luar agen hanya terdeteksi bila pemanggil mengirim expected_sha256, tidak ada hash acuan otomatis (code-tools.ts:290-292)
- Butir 4: tidak ada merge queue untuk perubahan bentrok; konflik langsung ditolak E_LEASE_CONFLICT (tools/index.ts:135-145)

## RC-FR-061 Lifecycle dan monitoring agen [partial]
- Butir 1: status starting tidak ada dan status orphaned tidak pernah dipakai; orphan ditulis sebagai failed (schema-v3.ts:117, agent-repos.ts:226-231)
- Butir 2: /agents tidak menampilkan heartbeat (main.ts:444-448)
- Butir 4: transcript ringkas tidak disimpan; result_json hanya berisi ringkasan teks hasil (agent-repos.ts:115-129, rpc.ts:1890-1902)
- Butir 5: dashboard agents hanya nama, peran, status, model; langkah, biaya, dan heartbeat tidak tampil (dashboard.ts:210, dashboard-data.ts:100-102)

## RC-FR-062 Pembatalan dan pemulihan agen [partial]
- Butir 1: releaseAgentLeases menghapus berdasarkan owner_agent_id, sedangkan lease tool hanya menyimpan session_id sehingga lease tidak dilepas lewat jalur ini (tools/index.ts:130-134, agent-repos.ts:265-267)
- Butir 2: session.cancel hanya abort controller induk dan tidak memanggil cancelSubagentTree, jadi status anak baru berubah saat turn anak gagal (rpc.ts:448-453)
- Butir 4: recovery orphan hanya berjalan saat agent.list, bukan saat start, dan menandai failed tanpa catatan keputusan (rpc.ts:738, agent-repos.ts:217-233)
- AC: tidak ada tes yang membuktikan semua anak berhenti <= 3 detik dan tidak ada proses yatim

## RC-FR-063 User memory [partial]
- Butir 2: memory tidak terisolasi per profil; dua profil berbeda saling melihat entri karena memoryFilter tidak memakai profile_id (repos.ts:456-467)
- Butir 3: sumber pesan tidak disimpan sebagai id pesan; rememberFromTurn menulis string 'auto-extract' (memory.ts:175,203, agent.ts:437)
- Butir 4: preferensi bertentangan hanya mengembalikan daftar id konflik tanpa menandai entri lama superseded (memory.ts:184-190)

## RC-FR-064 Project memory [partial]
- Butir 3: keputusan yang diubah tidak membuat versi baru; updateMemory menimpa baris dan version tetap 1 (repos.ts:573-584)
- Butir 4: tidak ada ekspor memory project ke RANN.md; CLI hanya mengekspor JSON (memory.ts:243-258, cli/main.ts:3140-3146)
- Butir 3: alasan perubahan hanya tag reason pada entri lama, bukan catatan versi terstruktur (memory.ts:229-233)

## RC-FR-065 Session memory [partial]
- Butir 1: ringkasan berisi potongan transkrip 300 karakter dari 40 pesan, bukan ringkasan keputusan/error/hasil (memory.ts:338-353)
- Butir 2: tidak ada pemisahan transkrip dan ringkasan; potongan pesan mentah 300 karakter disimpan sebagai memory session_summary (memory.ts:338-353)
- Butir 3: tidak ada penghapusan sesi atau promosi memory; RPC sesi tidak punya session.delete (rpc.ts:424-454)
- AC: ringkasan hanya dibuat saat compaction di tengah turn, tidak dijamin tersimpan saat sesi berakhir (agent.ts:617-623)

## RC-FR-066 Agent memory [missing]
- Butir 1: memory agen tidak terikat profil; agentProfile tidak pernah diisi sehingga semua memory project/global terbaca agen lain (rpc.ts:1811-1817)
- Butir 2: tidak ada penyaringan pengalaman berdasarkan peran agen saat menyimpan (memory.ts:151-172 hanya regex teks user)
- Butir 3: tidak ada izin baca antar agen; batas hanya tag agent yang tidak dipakai (memory.ts:68-72)
- Butir 4: tidak ada pelacakan efektivitas memory untuk menghapus yang tidak berguna
- Butir 5: tidak ada saklar memory per profil agen; hanya config.memory.enabled global (config.ts:60-66)

## RC-FR-067 Knowledge memory [partial]
- Butir 1: `.rann/knowledge` tidak terindeks saat root project karena direktori berawalan titik dilewati (memory.ts:294)
- Butir 3: path dan baris ada di source/tags tetapi tidak ditampilkan di prompt atau `/memory`, jadi sitasi tidak bisa dibuka dari hasil (memory.ts:41-44, cli/main.ts:1359)
- Butir 4: tidak ada reindex saat berkas berubah; hanya perintah manual `rann memory index` (cli/main.ts:3164-3175)
- Butir 5: tidak ada config pengecualian dokumen rahasia (config.ts:60-66)

## RC-FR-068 Procedural memory [missing]
- Butir 1: tidak ada penyimpanan prosedur dengan nama, trigger, prasyarat, langkah, dan verifikasi
- Butir 2: tidak ada aturan promosi setelah berhasil >= 3 kali atau persetujuan pengguna
- Butir 3: tidak ada jalur mengubah prosedur menjadi skill; skill hanya dibuat manual lewat tool skill (tools/index.ts:1438-1462)
- Butir 4: tidak ada penandaan stale untuk prosedur yang gagal berulang
- Butir 5: tidak ada mekanisme prosedur sehingga prioritas terhadap instruksi eksplisit tidak diuji

## RC-FR-069 Ekstraksi otomatis dan review kandidat [partial]
- Butir 1: ekstraksi berjalan sebelum panggilan model, bukan setelah turn selesai (agent.ts:435-450)
- Butir 2: semua kandidat langsung disimpan; tidak ada ambang keyakinan atau antrean review (memory.ts:180-204)
- Butir 3: tidak ada penyaringan secret, data pribadi sensitif, atau instruksi sementara di ekstraktor (memory.ts:151-172)
- Butir 4: tidak ada aksi menyetujui/menolak/mengedit kandidat; yang ada hanya update/remove entri final (rpc.ts:970-982)
- Butir 5: ekstraksi tidak bisa dimatikan per profil atau per project; hanya config.memory.enabled global (config.ts:60-66)

## RC-FR-070 Retrieval dan pencarian semantik [partial]
- Butir 1: tidak ada vektor/embedding; penggabungan hanya FTS, tag, dan recent (memory.ts:126-148, repos.ts:552-569)
- Butir 2: filter profil tidak diterapkan (repos.ts:456-467)
- Butir 3: skor tidak dikembalikan ke pemanggil dan tidak ditampilkan (memory.ts:143-147)
- Butir 4: tidak ada ambang relevansi; recent selalu digabung sehingga memory tidak relevan tetap diinjeksi (memory.ts:358-363)
- Butir 5: tidak ada `/recall --explain` (cli/main.ts:2249-2258)
- AC: tidak ada benchmark 10.000 memory dengan target < 80 ms p95

## RC-FR-071 Indeks dan prioritas memory [partial]
- Butir 1: last_used_at tidak pernah ditulis (repos.ts:484-524)
- Butir 2: importance tidak dipengaruhi sumber, jenis, atau umpan balik; hanya nilai default 0.5 (repos.ts:518)
- Butir 3: memory yang sering dipakai tidak naik peringkat karena ranking mengabaikan importance dan last_used_at (memory.ts:133-147)
- Butir 4: tidak ada embedding asinkron maupun status pending/retry (schema-v3.ts:16-38)
- Butir 5: tidak ada `/memory reindex` atau reindex penuh (cli/main.ts:3193)

## RC-FR-072 Konsolidasi dan deduplikasi [partial]
- Butir 1: dedup memakai kesamaan teks persis dan Jaccard token, bukan hash isi + kemiripan vektor (repos.ts:489-501, memory.ts:192-201)
- Butir 2: entri yang digabung tidak menyimpan versi lama; baris lama diperbarui di tempat (repos.ts:492-500)
- Butir 3: tidak ada kolom atau penulisan contradicted_by; kontradiksi hanya dikembalikan ke pemanggil (memory.ts:184-190, schema-v3.ts:16-38)
- Butir 4: tidak ada konsolidasi berkala atau pemicu manual (tidak ada job konsolidasi)
- Butir 5: tidak ada laporan konsolidasi di `/memory stats` (cli/main.ts:3193)

## RC-FR-073 Expiry dan staleness [partial]
- Butir 1: TTL hanya hardcoded untuk transient/session dan tidak bisa diubah lewat config (memory.ts:36,100-101)
- Butir 2: entri kedaluwarsa tetap berstatus active dan tidak pernah menjadi stale (memory.ts:60-62, schema-v3.ts:31)
- Butir 3: last_used_at tidak diperbarui saat dirujuk dan TTL tidak diperpanjang (repos.ts:552-569)
- Butir 5: job pembersihan harian menghapus dari tabel `memories` yang sudah di-drop sejak migrasi v3 (gc.ts:15, schema-v3.ts:51-55)

## RC-FR-074 Koreksi, update, dan hapus [partial]
- Butir 1: update tidak membuat versi baru dan tidak menyimpan alasan (repos.ts:573-584)
- Butir 2: hapus selalu hard delete tanpa soft delete atau konfirmasi (repos.ts:586-589, cli/main.ts:1378-1389)
- Butir 3: tidak ada vektor yang diperbarui; hanya trigger FTS dalam statement yang sama (schema-v3.ts:70-73)
- Butir 4: memory_events tidak pernah ditulis sehingga aktor, waktu, dan perubahan tidak tercatat (schema-v3.ts:86-95)

## RC-FR-075 Import, export, dan inspeksi [partial]
- Butir 1: export berupa satu objek JSON, bukan JSONL (memory.ts:243-258, cli/main.ts:3140-3146)
- Butir 2: import tidak mendeteksi konflik dan tidak menawarkan strategi lewati/timpa/gabung; hanya ada replace (memory.ts:260-286)
- Butir 3: `/memory` hanya daftar/cari, tanpa filter dan detail; show/edit/rm/pin tidak diimplementasikan (cli/main.ts:1352-1360)
- Butir 5: tidak ada penyaringan secret saat export (memory.ts:247-256)

## RC-FR-076 Instruction system [partial]
- Butir 2: prioritas hanya label; isi digabung sesuai urutan push, aturan `.rann/rules` prioritas 50 justru paling akhir (instructions.ts:36-57,96)
- Butir 3: tidak ada instruksi spesifik per path yang mengalahkan file umum (instructions.ts tidak membaca aturan per direktori)
- Butir 4: konflik tidak menyebut pemenang dan hasil conflicts tidak dipakai saat membangun prompt (instructions.ts:87-93, agent.ts:451,547)
- Butir 4: `/context` belum tersedia sehingga pemenang tidak bisa dilihat (repl-commands.ts:136)

## RC-FR-077 Discovery dan metadata skill [partial]
- Bentrok nama antar scope tidak pernah dilaporkan ke pengguna: conflicts() ada di skills.ts:195-205 tetapi tidak dipanggil /skills maupun saat load.
- /skills hanya mencetak nama, scope, dan deskripsi (main.ts:1439-1448); trigger, versi, dan status aktif tidak tampil, sehingga AC juga tidak terpenuhi.

## RC-FR-078 Progressive loading [partial]
- Tahap 3 tidak ada: tidak ada pembacaan folder references/ atau scripts/ di skills.ts.
- Tidak ada pencatatan jumlah token per tahap, baik di katalog, loadForTask, maupun log.
- Tidak ada budget referensi atau mekanisme melewati referensi opsional dengan catatan.
- Tidak ada penanda bagian wajib; parser hanya membaca name/description/version/source/trigger/dependencies (skills.ts:104-113).

## RC-FR-079 Aktivasi dan pemilihan skill [partial]
- Pengguna tidak bisa memaksa atau melarang skill lewat /skill: perintah itu hanya mencetak body (main.ts:1452-1462), sementara include/exclude hanya tersedia di RPC skill.select tanpa jalur CLI.

## RC-FR-080 Eksekusi skill [missing]
- Tidak ada eksekusi skrip skill: tidak ada folder scripts/ maupun runner per skill.
- Tidak ada cwd project, env terbatas, timeout, atau sandbox khusus skill; skill hanya teks yang masuk prompt.
- Tidak ada broker tool untuk skill dan tidak ada pencatatan output/error skill di trace.
- Tidak ada error terstruktur untuk kegagalan skill karena tidak ada eksekusi.

## RC-FR-081 Pembuatan dan validasi skill [partial]
- /create-skill hanya meminta nama dan deskripsi; trigger, langkah, dependensi, dan contoh tidak ditanyakan (main.ts:2397-2406).
- Dry-run tidak dipanggil dari CLI, dan RPC dryRun hanya menjalankan validate, bukan menampilkan isi yang akan ditulis (rpc.ts:1008-1017).
- Skill baru langsung aktif setelah create; tidak ada status draft atau syarat disetujui/diuji (skills.ts:393-405, 432).
- Pembuatan skill oleh agent tidak punya persetujuan khusus, hanya mengikuti permission mode lewat assertAllowed (tools/index.ts:1462-1467).

## RC-FR-082 Edit dan versioning skill [partial]
- `/skill info` tidak ada; /skill <nama> hanya mencetak body tanpa versi, riwayat, atau changelog (main.ts:1452-1462).

## RC-FR-083 Dependensi skill [partial]
- Batas versi dependensi dibuang tanpa dicek: dependency.replace(/[@^~].*$/, "") di skills.ts:330.
- Dependensi hilang tidak menggagalkan aktivasi secara terlihat: error loadForTask ditelan agent.ts:462-464 dan turn lanjut tanpa pesan dependensi.

## RC-FR-084 Registry dan instalasi skill [partial]
- Sumber HTTPS tarball tidak didukung; install() melempar E_TOOL_INVALID_ARGS untuk URL non-Git (skills.ts:524-525).
- Tidak ada verifikasi checksum atau signature untuk paket skill; checksum di SkillInfo hanya hash isi untuk informasi (skills.ts:133-135).
- Tidak ada pratinjau manifest, permission, atau skrip sebelum instalasi (skills.ts:516-549).
- Persetujuan eksplisit hanya untuk Git; folder lokal dan URL lain tidak dinilai sebagai sumber tidak tepercaya (skills.ts:521-523).
- Sumber instalasi tidak dicatat: install() tidak menulis source, sehingga update() gagal bila frontmatter tidak memuat source (skills.ts:546-548, 554-555).

## RC-FR-085 Hapus dan update skill [partial]
- Hapus tidak menyimpan audit: remove hanya rmSync lalu mengembalikan boolean (skills.ts:591-601).
- Update tidak menolak versi lokal yang lebih baru; ia hanya berhenti bila versi sama, selain itu menimpa (skills.ts:568-588).
- Update tidak menampilkan changelog atau konflik sebelum menimpa (skills.ts:577-588).
- Tidak ada penundaan untuk skill yang sedang dipakai; tidak ada lock atau status in-use (skills.ts:551-589).
- CLI /install-skill dan /update-skill berstatus NOT_YET sehingga alur update tidak bisa dijalankan dari sesi (repl-commands.ts:126-127).

## RC-FR-086 Registry tool bawaan [partial]
- ToolSpec tidak punya skema output, permission, dan timeout default; hanya name, description, parameters (providers/types.ts:24-28).
- Tidak ada penanda tool tidak tersedia per platform; semua tool selalu didaftarkan (tools/index.ts:1801-1803).
- /tools mencetak string statis tanpa kategori, status, izin, atau skema (main.ts:1887-1890).
- Tidak ada konfigurasi project untuk mematikan tool bawaan; allowlist hanya AgentConfig.tools dari profil subagent (agent.ts:585-591, rpc.ts:788).

## RC-FR-087 Tool kustom dan eksternal [missing]
- Tidak ada pemuatan modul TypeScript dari .rann/tools/; grep seluruh packages tidak menemukan referensi .rann/tools.
- Tidak ada tool eksternal berbasis perintah dengan skema JSON; registry hanya array statis di tools/index.ts:465.
- Tidak ada deklarasi permission dan timeout untuk tool kustom karena tidak ada mekanisme registrasi.
- Tidak ada validasi skema saat registrasi tool.
- `/tool test` tidak ada, dan `/tool list` memanggil RPC tool.list yang tidak terdaftar di rpc.ts (main.ts:2592).

## RC-FR-088 Validasi skema dan chaining [partial]
- Output tool tidak divalidasi Zod dan ToolSpec tidak punya skema output (providers/types.ts:24-28).
- Tidak ada chaining tool; executeTool hanya menjalankan satu tool (tools/index.ts:1809-1827).
- Permission per langkah chaining tidak dinilai karena chaining tidak ada.
- Output antara tidak disimpan sebagai artefak; addArtifact di work-repos.ts:543 tidak pernah dipanggil dari runtime.

## RC-FR-089 Permission, timeout, retry, dan log tool [partial]
- Timeout default per tool tidak ada; hanya shell_run yang punya default 120000 ms (tools/index.ts:1301).
- Timeout mengembalikan {error:"timeout"} dengan exit 124, bukan error E_TOOL_TIMEOUT seperti AC (tools/index.ts:1341-1344).
- Retry hanya daftar tool read-only di agent, bukan matriks retry per tool (agent.ts:1095-1109).
- Log tool_calls tidak punya trace id; kolomnya id, session_id, turn_id, tool_name, args_json, status, exit_code, duration_ms (db.ts:124-136).
- Output besar dipotong tetapi tidak disimpan sebagai artefak; addArtifact tidak dipanggil (tools/index.ts:1316-1319, work-repos.ts:543).

## RC-FR-090 Cakupan kategori tool [partial]
- Tidak semua kategori punya tes end-to-end: image, messaging, package, scheduling, browser, web_search, dan http_request tidak diuji lewat tool.run.
- Ekstraksi PDF, DOCX, dan XLSX tidak diuji; tes dokumen hanya memakai berkas .md (system-tools.test.ts:23-31).
- OCR, resize, dan crop tidak diuji dan bergantung pada binary tesseract/ImageMagick (system-tools.ts:92-126).
- Tidak ada tes messaging_send yang membuktikan pemakaian adapter gateway (messaging.test.ts tidak menyentuh tool).

## RC-FR-091 Konfigurasi dan transport MCP [partial]
- Konfigurasi per server tidak punya field permission (config.ts:129-143).
- SSE bukan transport terpisah: nilai sse diperlakukan sebagai HTTP POST dengan header Accept, bukan aliran event (mcp.ts:139-140, 204-214).
- /mcp didaftarkan available=false sehingga handler add/remove/list/reload tidak bisa dipanggil dari sesi (repl-commands.ts:130, main.ts:1345-1350).
- /mcp add hanya menulis command/args atau url, tanpa env, header, timeout, atau permission; /mcp remove hanya set enabled=false (main.ts:2440-2471).
- Tidak ada validasi skema sebelum menyimpan; setConfigValue menulis TOML langsung dan skema baru dicek saat config dibaca (config-store.ts:49-66, config.ts:385-390).

## RC-FR-092 Discovery tool, resource, dan prompt [partial]
- Tidak ada pemanggilan resources/list atau prompts/list; hanya tools/list (mcp.ts:104).
- Resource dan prompt tidak disimpan dengan metadata dan tidak bisa dibaca saat dibutuhkan.
- Namespace memakai mcp__server__tool, bukan format server.tool (mcp.ts:101).
- Tidak ada penanganan notifikasi perubahan daftar; hasil discovery di-cache dan hanya direset saat reload (mcp.ts:87-94, 132).
- Skema tool tidak divalidasi; inputSchema yang bukan objek diganti {type:"object",properties:{}} dan tool tetap didaftarkan (mcp.ts:115-118).

## RC-FR-093 Autentikasi dan lifecycle MCP [partial]
- OAuth 2.1 tidak ada; tidak ada alur browser/device flow maupun penyimpanan token di secret store.
- Tidak ada restart otomatis dengan backoff; proses yang exit hanya menghapus state dan tidak dicoba ulang (mcp.ts:178-182).
- Tidak ada status connecting/ready/degraded/failed/disabled; mcp.list hanya melaporkan enabled dari config (rpc.ts:695-702).
- Default timeout 20 detik, bukan 30 detik seperti requirement (config.ts:138).

## RC-FR-094 Permission dan isolasi MCP [partial]
- Permission tool MCP tidak ditentukan konfigurasi server; executeTool selalu memakai risk exec (tools/index.ts:1812-1819).
- Tidak ada pembatasan filesystem untuk server MCP; cwd diset tetapi server tetap bisa membaca path absolut (mcp.ts:153-155).
- Output MCP tidak ditandai sebagai konten tidak tepercaya; teks dikembalikan apa adanya ke model (mcp.ts:368-377).
- Tidak ada cara mematikan satu server tanpa menghentikan sesi; mcp.reload menutup seluruh manager (mcp.ts:380-388, rpc.ts:710-712).

## RC-FR-095 Instalasi dan registrasi plugin [partial]
- Plugin berstatus installed masih bisa dipanggil karena invoke menerima installed atau enabled (plugins.ts:410), jadi tidak benar-benar nonaktif sampai diaktifkan.

## RC-FR-096 Lifecycle dan dependensi plugin [partial]
- Dependensi hanya diperiksa keberadaannya, tidak dimuat berurutan: plugins.ts:349-353 tidak memanggil enable atau load dependensi lebih dulu.
- Plugin yang crash sebagai hook tidak ditandai error: hooks.ts:246-258 hanya mencatat outcome, tidak memanggil PluginManager.markError.

## RC-FR-097 API dan permission plugin [partial]
- Tidak ada API registrasi tool, command, provider, atau handler hook: manifest.tools dan manifest.commands di plugins.ts:18-19 hanya disimpan, tidak pernah dipasang ke ToolRegistry, CLI, atau registry provider.
- Permission tidak ditegakkan: plugins.ts:122-132 hanya menyimpan daftar permissions dan invoke di plugins.ts:407-459 tidak memeriksa permission sebelum menjalankan method.
- Batas akses penyimpanan tidak ada: proses anak di plugins.ts:423-436 mewarisi filesystem dan cwd penuh, jadi plugin bisa membaca path di luar direktorinya.

## RC-FR-098 Kompatibilitas dan update plugin [partial]
- Update tidak menampilkan changelog dan tidak meminta konfirmasi saat permissions berubah: plugins.ts:376-390 langsung menimpa, dan InstallOptions.approve di plugins.ts:39 tidak pernah dibaca.
- Pesan penolakan menyebut rentang yang diminta dan versi yang tersedia (plugins.ts:116-118), tetapi tidak menyebut versi minimum yang harus dipakai.

## RC-FR-099 Event hooks [partial]
- Runtime hanya memancarkan 4 dari 16 event: agent.ts:402, 968, 1139, 1144; SessionStart, SessionEnd, PreTask, PostTask, AgentSpawn, AgentComplete, MemoryWrite, SkillLoad, ContextCompact, Stop, PreCompact, dan Notification tidak pernah dipanggil.
- Payload tiap event tidak divalidasi skema: HookPayload di hooks.ts:34-52 adalah objek longgar, jadi field wajib per event tidak dapat dipastikan.

## RC-FR-100 Konfigurasi, validasi, timeout, dan error hook [partial]
- Dry-run tidak menampilkan payload dan hasil: hooks.ts:206-208 hanya menandai skipped, tanpa mengembalikan body yang dikirim atau output yang akan dihasilkan.

## RC-FR-101 Arsitektur adapter provider [partial]
- Kontrak Provider belum lengkap: providers/types.ts:45-49 hanya punya chat; tidak ada method embed, listModels, health, countTokens, dan stream terpisah.

## RC-FR-102 Dukungan provider [partial]
- OpenRouter tidak punya adapter atau kind sendiri: providers/index.ts:20-35 tidak mengenal openrouter, sehingga hanya bisa dipakai sebagai openai-compatible dengan base URL manual.
- Tidak ada contoh konfigurasi per adapter di repo; docs/tutorial-v1.0.0.md hanya memuat contoh OpenRouter, bukan anthropic, gemini, atau openai-responses.

## RC-FR-103 Manajemen kredensial [partial]
- Kunci dari environment tidak dipindahkan ke secret store saat first-run: tidak ada kode api_key_env atau first-run di packages/cli/src dan packages/runtime/src, jadi env tetap dibaca langsung.
- Perintah /provider add, /provider test, dan /provider remove tidak ada di REPL: main.ts:1951 hanya memilih provider yang sudah ada; add/test/remove hanya tersedia sebagai subcommand rann provider.

## RC-FR-104 Discovery dan registrasi model [partial]
- Discovery listModels tidak ada: registry hanya dibangun dari config.providers[].models dan tabel models (models.ts:285-310), tanpa memanggil endpoint /models provider.
- Model yang tidak tersedia tidak bisa ditandai: ModelDescriptor hanya punya deprecated (models.ts:45), tidak ada flag unavailable atau alasan tidak tersedia.
- /models di REPL tidak menampilkan harga: main.ts:1958-1966 hanya id, context window, dan capability; harga baru muncul di perintah CLI rann models (main.ts:2857).

## RC-FR-105 Capability registry [partial]
- Kapabilitas yang tidak diketahui dianggap mendukung fitur utama: models.ts:140-144 memberi toolCalling, parallelToolCalls, dan structuredOutput true untuk model openai-compatible yang tidak ada di katalog, tanpa status unknown.
- Capability tidak bisa berasal dari provider atau dokumentasi: builtinDescriptor memakai katalog hardcoded (models.ts:64-135) dan override manual/DB (models.ts:207-232), tanpa jalur discovery atau pencatatan sumber.
- Hanya toolCalling, vision, dan embeddings yang dipakai untuk menyaring (router.ts:107-118, rpc.ts:1407-1409); capability parallelToolCalls, structuredOutput, reasoning, audio, pdf, dan promptCaching hanya metadata tanpa penegakan.
- Sumber kapabilitas tidak dicatat: tabel models hanya menyimpan capabilities_json boolean (packages/storage/src/model-repos.ts:31), tanpa kolom sumber atau waktu verifikasi, dan perubahan kapabilitas tidak masuk audit log.

## RC-FR-106 Context window dan tokenizer [partial]
- Ambang 75% dan 90% tidak memakai context window model: status bar menghitung persentase dari config.context.max_tokens 24.000 (main.ts:970, 999-1003, 1026), dan kompaksi di agent.ts:306/348 juga memakai 24.000 tetap, bukan descriptor.contextWindow.
- Estimasi token hanya heuristik karakter dibagi empat (providers/types.ts:51-53); tidak ada tokenizer model dan tidak ada uji bahwa error estimasi ≤ 15 persen.
- Pemulihan overflow dari error provider tidak ada: E_CONTEXT_OVERFLOW langsung dilempar di agent.ts:656-663 tanpa kompaksi ulang atau retry dengan konteks lebih kecil.
- Ringkasan bertahap tidak ada: digestRows (agent.ts:276-290) memotong tiap pesan dan membuang sisanya, tanpa tahap yang menjaga goal, keputusan, error, path, dan hasil verifikasi secara eksplisit.
- Prompt caching tidak dikirim ke provider: capability promptCaching ada di models.ts:15, tetapi tidak ada cache_control atau penanda cache di providers/*.ts; cacheRead hanya dibaca dari respons.
- Anggaran retrieval file hanya per pembacaan: MAX_READ_CHARS 200.000 di packages/runtime/src/tools/index.ts:92, tanpa batas kumulatif per turn.
- /context tidak menampilkan komposisi context atau alasan pemotongan: main.ts:2578-2585 hanya jumlah pesan dan estimasi token.

## RC-FR-107 Streaming dan tool calling [partial]
- Delta reasoning tidak ada: ProviderChunk (types.ts:39-43) hanya text, tool_call, usage, error, dan done; tidak ada reasoning atau thinking delta meski capability reasoning ada di models.ts:12.
- Tool call parsial tidak diekspos: argumen baru dikirim setelah JSON lengkap (anthropic.ts:179 dan openai.ts:245-250), sehingga UI tidak bisa menampilkan progres argumen.
- Tool call tidak dijalankan paralel: agent.ts:851-1160 memproses calls berurutan dan capability parallelToolCalls tidak dipakai.
- Resume stream tidak ada: retry.ts:136-142 melempar error bila sudah ada teks terkirim, dan agent.ts:735-739 menyimpan teks parsial lalu berhenti, bukan melanjutkan dari offset.

## RC-FR-108 Structured output dan multimodal [partial]
- Structured output belum ada: tidak ada responseFormat, json_schema, atau validasi output terhadap schema di providers/*.ts dan agent.ts.
- Audio tidak didukung: AttachmentKind di attachments.ts:7 hanya image, pdf, text, dan tidak ada jalur audio ke provider.
- PDF selalu diekstrak menjadi teks (attachments.ts:130-137), bahkan untuk model dengan capability pdf, sehingga PDF tidak dikirim sebagai dokumen multimodal.
- Output model tidak divalidasi ulang terhadap schema dan tidak ada perbaikan otomatis saat JSON tidak valid.

## RC-FR-109 Usage dan biaya [partial]
- provider_request_id tidak pernah diisi: ProviderChunk (providers/types.ts:39-43) tidak membawa id respons dan recordUsage dipanggil tanpa providerRequestId di agent.ts:817-828.
- Biaya tidak diketahui disimpan sebagai 0, bukan NULL: repos.ts:381 memakai input.costUsd ?? 0 sementara cost_source unknown di repos.ts:385; /budget menghitung unknown lewat rpc.ts:843-855, tetapi /cost di main.ts:1916-1924 tetap menjumlahkan nol tanpa peringatan.
- Registry harga builtin kosong: tidak ada entri pricing di CATALOG models.ts:64-135, jadi costFor selalu null untuk model bawaan; harga manual yang hanya sebagian diisi dilengkapi 0 di models.ts:238-240.
- Tidak ada budget per task: BudgetOptions di agent.ts:349 hanya maxTokensPerTurn, maxTokensPerDay, dan maxUsdPerDay; config tidak punya batas biaya per task.
- /cost dan /usage hanya ringkasan sesi: main.ts:1910-1924 tidak mengelompokkan per task, dan tidak ada perintah biaya per task.

## RC-FR-110 Kesehatan provider dan rate limit [partial]
- Health check on-demand tidak mencatat status, latensi, atau error: provider.test di rpc.ts:2015-2052 hanya memanggil chat dan mengembalikan hasil, tanpa providerHealth.recordSuccess atau recordFailure.

## RC-FR-111 Retry dan fallback [partial]
- Retry tidak mengikuti matriks ARCHITECTURE 13.3: agent.ts:685-687 memakai 2 percobaan untuk chat (matriks 3) dengan backoff 1s dan 2s tanpa jitter 0-250 ms; stream juga memakai backoff 1s, bukan 500 ms, dan tidak mengirim request id idempoten.
- Fallback tidak memeriksa pin: rpc.ts:1414-1437 membangun fallback dari config.model.fallback tanpa melihat config.routing.pinned atau pin per sesi, dan tidak ada allowFallback.
- Fallback tidak memeriksa capability setara atau lebih tinggi: rpc.ts:1414-1437 hanya memilih provider dan model dari config.model.fallback, tanpa membandingkan capability dengan model utama.
- Output parsial tidak disambung oleh fallback: agent.ts:735-739 melempar error begitu ada teks terkirim, jadi fallback tidak dijalankan.
- Rantai fallback dan biayanya tidak dicatat: recordRoutingLog di rpc.ts:1439-1444 tidak mengirim fallbackChain, dan biaya fallback tidak masuk usage karena hanya usage terakhir yang dicatat (agent.ts:817-828).
- Error akhir tidak memuat rantai percobaan: agent.ts:741 melempar lastProviderError apa adanya, tanpa daftar provider dan kode error yang dicoba.

## RC-FR-112 Alias dan pemilihan model [partial]
- Sumber model tidak ditampilkan: /model di main.ts:1954-1963 hanya mencetak model aktif dan daftar model, tanpa asal alias atau provider.
- Opsi --pin tidak ada di CLI: parser perintah di packages/cli/src/main.ts tidak mengenal --pin, dan pin hanya bisa diatur lewat config.routing.pinned (config.ts:110).
- /model <nama> tidak menyimpan model ke sesi: main.ts:1954-1963 hanya mengubah variabel lokal yang dikirim sebagai override per turn, sehingga model kembali ke default setelah sesi atau proses baru.
- Model eksplisit tetap bisa diganti fallback: rpc.ts:1418-1438 selalu membangun fallback dan agent.ts:719-739 memakainya tanpa memeriksa apakah model diminta eksplisit.
- Alias tidak stabil lintas provider: models.ts:203-205 melempar E_CONFIG_INVALID bila alias menunjuk provider lain, jadi alias tidak bisa dipakai setelah provider diganti.
- Status bar menampilkan alias, bukan model asli: main.ts:993 memakai variabel model yang diisi teks /model, sehingga nama model hasil resolve tidak terlihat.

## RC-FR-113 Smart router [partial]
- Skor dan alasan kandidat tidak disimpan: RouteDecision punya candidates dan rejected (router.ts:57-65), tetapi recordRoutingLog hanya menulis requested/selected/reason (model-repos.ts:154-181), dan tidak ada perintah /route why.
- Router tidak menerima informasi lampiran: routeModel hanya diberi prompt teks (rpc.ts:1385-1396), sehingga gambar tanpa kata kunci vision bisa memilih model non-vision dan baru ditolak setelah routing (rpc.ts:1407-1409).
- Tidak ada error saat tidak ada kandidat: router.ts:170-172 mengembalikan chosen null, lalu rpc.ts:1403-1404 diam-diam memakai model sesi, bukan error E_ROUTE_NO_CANDIDATE.
- Tidak ada pembelajaran dari hasil: ROUTE_WEIGHTS konstan di router.ts:11-25 dan tidak ada pembaruan bobot atau statistik kualitas dari usage maupun verifikasi.
- Klasifikasi tugas hanya regex kata kunci (router.ts:32-53), tanpa metadata task atau estimasi kompleksitas.

## RC-FR-114 Kebijakan routing dan override [partial]
- Policy hanya auto dan manual: config.ts:108 tidak mengenal cost-first, quality-first, latency-first, atau mode hemat biaya; router.ts:11-25 selalu memakai bobot balanced per task class.
- Tidak ada aturan routing kustom per project atau per task: schema routing di config.ts:106-116 hanya berisi prefer, pinned, dan ambang global.
- Log routing tidak memuat kandidat, skor, atau alasan yang bisa diperiksa: recordRoutingLog di rpc.ts:1439-1444 hanya mengirim requested, selected, dan reason; fallbackChain tidak diisi.
- Tidak ada opsi allowFallback: fallback di rpc.ts:1418-1438 selalu dibangun, sehingga override eksplisit tetap bisa dialihkan ke model lain.

## RC-FR-115 Operasi Git dasar [partial]
- Pesan commit tidak dibuat dari diff dan tidak ada editor untuk mengubahnya; git_write.commit hanya memakai message yang dikirim pemanggil (tools/index.ts:929).

## RC-FR-116 Checkpoint dan rollback [partial]
- Checkpoint setelah verifikasi sukses tidak dibuat; hanya ada checkpoint pre_tool sebelum tool mutasi pertama (agent.ts:854).
- Rollback tidak mengembalikan state task dan tidak menghapus berkas yang dibuat setelah checkpoint; restore hanya menimpa berkas yang ada di manifest (checkpoint-files.ts:136-161).
- Riwayat checkpoint tidak bisa dibersihkan karena pruneFileCheckpoints tidak dipanggil dari RPC maupun CLI (checkpoint-files.ts:165).

## RC-FR-117 Worktree dan konflik [partial]
- Tidak ada merge queue; worktree_merge langsung menjalankan git merge ke workspace utama tanpa serialisasi antrean (tools/index.ts:893).
- Worktree yang sudah selesai tidak dibersihkan otomatis; penghapusan hanya manual dan gagal bila worktree kotor (tools/index.ts:884).
- Worktree tidak terikat pada task atau agen; nama dan branch dibuat manual oleh pemanggil (tools/index.ts:869).

## RC-FR-119 Isolasi sesi dan alur autentikasi browser [partial]
- Profil persisten tidak bisa diaktifkan lewat tool karena skema browser tidak punya opsi persistent, dan storageState tidak pernah disimpan kembali setelah sesi (browser.ts:124).
- Tidak ada jalur kredensial login yang aman; nilai aksi type masuk sebagai argumen tool dan transkrip (browser.ts:193).
- Context tidak dihapus saat task selesai; hanya lewat aksi close, GC idle, atau shutdown daemon (browser.ts:138, rpc.ts:2083).

## RC-FR-120 Perbedaan search, fetch, dan browser [partial]
- Alasan pemilihan search, fetch, atau browser tidak dicatat di event, audit, maupun output tool.
- Tidak ada fallback otomatis; kegagalan httpFetch atau webSearch tidak mencoba metode lain yang masuk akal (web.ts:102,206).

## RC-FR-122 Persistensi dan pemulihan background [partial]
- Pemulihan tidak dicatat di audit; hanya job_events yang ditulis, tanpa appendAudit (job-repos.ts:240,247).

## RC-FR-123 Monitoring, cancel, retry, dan notifikasi [partial]
- Cancel hanya mengubah status job di database; RPC background.cancel tidak memanggil AbortController milik worker, sehingga proses yang sedang berjalan tetap lanjut sampai selesai (rpc.ts:592-598, background.ts:132-160).
- Retry tidak punya pagar idempotensi efek samping; job yang sudah sebagian berjalan diantrekan ulang apa adanya (job-repos.ts:223-233).

## RC-FR-124 Jenis jadwal [partial]
- Kebijakan replace tidak menghentikan job yang sedang running; cancelQueuedJobsForRun hanya membatalkan job queued, sehingga eksekusi lama tetap berjalan setelah run ditandai cancelled (scheduler.ts:153-157, job-repos.ts:215-220).

## RC-FR-125 Trigger, timezone, dan DST [partial]
- Trigger kondisional dan event tidak ada; scheduler hanya menerima once, every, dan cron, tanpa ekspresi status, tanggal, hasil job sebelumnya, atau event (scheduler.ts:52-72).

## RC-FR-126 Persistensi, riwayat, dan retry jadwal [partial]
- Riwayat tidak bisa difilter status atau rentang tanggal; hanya limit, dan ekspor hanya berupa cetak JSON ke stdout (job-repos.ts:421).
- Batas waktu eksekusi memakai background.max_runtime_ms global, bukan batas waktu per job atau per jadwal (config.ts:88-91).
- Job yang gagal berulang tidak menonaktifkan jadwal dan tidak mengirim notifikasi; tidak ada pemanggilan updateScheduler saat job masuk dead letter.
- job_runs.attempt selalu diisi 1, sehingga percobaan retry tidak tercatat per eksekusi (job-repos.ts:399).

## RC-FR-127 Gateway server dan transport [partial]
- Gateway membuka database langsung untuk pairing, device, audit, dan autentikasi (gateway.ts:191,209,216,361), melanggar larangan akses langsung ke database.

## RC-FR-129 Otorisasi, scope, dan RBAC [partial]
- Tidak ada pemeriksaan kepemilikan resource; token read mana pun bisa membaca sesi atau perangkat lain lewat endpoint /v1/sessions.

## RC-FR-130 Routing sesi, task, dan eksekusi remote [partial]
- Sesi baru memakai process.cwd() sebagai project, bukan config.projectPath (rpc.ts:1336).
- Tidak ada antrean per sesi; session.send menolak E_CONFLICT saat turn lain masih berjalan (rpc.ts:1358).
- Sesi tidak terikat pada node asal; tidak ada field node atau mekanisme perpindahan node (gateway.ts:681-699).

## RC-FR-131 Health, reconnect, dan multi-node [partial]
- Multi-node tidak ada; gateway hanya satu proses dengan satu database, tanpa routing berdasarkan project atau beban (gateway.ts:191).
- Node yang mati tidak dilaporkan karena tidak ada registry atau heartbeat antar-node.
- Reconnect dashboard memakai since=0 sehingga event lama dikirim ulang dan bisa menduplikasi pesan atau approval (dashboard.ts:312).

## RC-FR-133 Adapter Discord dan Slack [partial]
- Discord dan Slack tidak mendaftarkan slash command atau endpoint interaction; perintah hanya diproses sebagai pesan teks (messaging-discord.ts:308, messaging-slack.ts:282).
- Slack hanya punya allowlist user, tidak ada access control per role (messaging-slack.ts:110).

## RC-FR-134 Web chat, lampiran, dan multi-user [partial]
- Tombol Lampiran hanya membuka file picker; tidak ada handler change yang mengunggah berkas atau menyisipkan path ke prompt (dashboard.ts:256,266).
- Markdown dan blok kode tidak dirender; semua pesan di-escape dan ditampilkan pre-wrap (dashboard.ts:57,274).
- Riwayat dimuat lewat session.get tanpa limit, offset, atau parameter pencarian (gateway.ts:494-503).
- Tidak ada pemeriksaan kepemilikan sesi: token perangkat mana pun yang mengetahui id sesi bisa membaca transkrip sesi lain (gateway.ts:490-503).

## RC-FR-135 Halaman dashboard [partial]
- Dashboard hanya punya aksi buat kode pairing; tidak ada aksi ubah state lain, sehingga tujuan mengelola ekosistem tanpa CLI belum tercapai (dashboard.ts:241-246).
- Tidak ada dialog konfirmasi dan alasan untuk aksi berisiko karena tidak ada aksi berisiko yang diimplementasikan (dashboard.ts:238-247).

## RC-FR-136 Konsistensi dashboard, analytics, dan log [partial]
- Event hanya memicu refresh chat pada turn.end; perubahan model/config dari CLI tidak mendorong event atau refresh halaman lain (dashboard.ts:317-318).
- Analytics tidak menampilkan task sukses/gagal maupun latensi per provider; summarizeUsage hanya token dan biaya (repos.ts:391-410).
- Log tidak bisa difilter berdasarkan level, sesi, task, atau waktu; query hanya LIMIT (dashboard-data.ts:177-184).
- Tidak ada ekspor CSV atau JSON untuk usage dan log (tidak ada rute export di gateway.ts:461-539).

## RC-FR-137 Mode izin dan policy engine [partial]
- Rule tidak mendukung path atau domain; matchesRule hanya mencocokkan nama tool dan pola command (policy.ts:60-69).
- Tidak ada jalur ubah mode tersimpan yang dicatat di audit; mode hanya berasal dari config atau flag per request (rpc.ts:1341,1455).

## RC-FR-138 Sandbox filesystem [partial]
- Hardlink tidak dideteksi; realpath hanya menyelesaikan symlink dan path relatif (policy.ts:114-125).
- Tidak ada daftar blokir untuk ~/.ssh, .env, atau kredensial; grep runtime tidak menemukan pengecekan path sensitif (tools/index.ts:463-490).
- Akses luar workspace hanya dikendalikan sakelar global workspace_only, tanpa izin eksplisit per path atau per permintaan (policy.ts:127-133).

## RC-FR-139 Batasan terminal dan approval perintah [partial]
- Tidak ada penolakan atau pemeriksaan khusus untuk sudo; shell_run hanya memakai env yang dibersihkan dan policy tidak mencocokkan sudo (tools/index.ts:1290-1310, policy.ts:8-24).

## RC-FR-140 Secret management dan enkripsi [partial]
- Penyaringan secret tidak mencakup semua error dan trace: hook ToolError memakai err.message mentah (agent.ts:1144), dan tidak ada jalur log/trace yang menerapkan redactSecrets.

## RC-FR-141 Autentikasi pengguna dan RBAC [partial]
- Tidak ada pengguna lokal dengan identitas dan role di luar perangkat gateway; tabel gateway_users tidak dipakai dan RPC lokal tidak punya autentikasi (gateway-repos.ts:8-18).
- Perubahan role dan pencabutan akses tidak dicatat di audit_log; setRole/revoke langsung menulis database (gateway.ts:223-236).

## RC-FR-142 Isolasi sesi dan agen [partial]
- Query sesi, pesan, dan memori tidak selalu memfilter profile_id; getSession dan searchMemories hanya memakai id atau scope (repos.ts:120-135,491-501).
- Memory dapat dibaca lintas sesi karena searchMemories tidak menerima session_id maupun profile_id (repos.ts:491-501).
- session.get di gateway tidak memeriksa pemilik sesi, sehingga transkrip dapat dibaca lintas perangkat (gateway.ts:494-503).
- Context browser dipisahkan per sesi, bukan per task (tools/index.ts:1546).
- Tidak ada pencatatan insiden saat akses lintas sesi terdeteksi; tidak ada tabel atau kode incident (grep runtime/storage tidak menemukan).

## RC-FR-143 Isolasi plugin dan MCP [partial]
- Permission yang dideklarasikan plugin tidak ditegakkan; invoke tidak memeriksa manifest.permissions dan proses anak tetap bisa membaca filesystem serta jaringan (plugins.ts:407-420).
- Akses file dan jaringan MCP tidak dibatasi permission server; env dibatasi tetapi proses tetap bebas membaca path absolut dan membuka koneksi (mcp.ts:142-158).
- Percobaan akses yang ditolak tidak dicatat sebagai audit atau insiden (plugins.ts:407-420, mcp.ts:142-158).

## RC-FR-144 Audit log [partial]
- Perubahan config dan perubahan izin tidak diaudit; config hanya ditulis lewat setConfigValue tanpa appendAudit (config-store.ts:49-100).
- Akses baca secret tidak diaudit; secret.list mengembalikan metadata tanpa entri audit (rpc.ts:857-858).
- Audit tidak dilindungi dari penghapusan oleh agent: tidak ada trigger atau izin khusus pada audit_log (db.ts:154-166).
- Tidak ada retensi atau pengarsipan audit; gcStorage tidak menyentuh audit_log (gc.ts:10-31).

## RC-FR-145 Pertahanan prompt injection [partial]
- Tidak ada pelacakan asal konten yang memaksa approval untuk aksi yang dipicu konten tidak tepercaya; mode trusted tetap mengizinkan eksekusi tanpa approval (policy.ts:85).

## RC-FR-146 Perlindungan operasi destruktif [partial]
- Overwrite berkas besar tidak dideteksi dan tidak meminta konfirmasi; tidak ada batas ukuran pada fs_write (tools/index.ts:486-490 hanya batas baca).

## RC-FR-147 Skema storage dan integritas [partial]
- Tidak ada indeks vektor atau embedding; grep vector/embedding di storage dan runtime tidak menemukan implementasi (db.ts:42-225).
- Garbage collection tidak menghapus blob tanpa referensi dan tidak menyentuh audit_log; gcStorage hanya memori, artefak, dan events (gc.ts:10-31).
- AC database 1 GB tidak diuji; db.test.ts hanya memakai database kecil dan tidak ada benchmark 1 GB.

## RC-FR-149 Hierarki dan struktur konfigurasi [partial]
- Lapisan sesi tidak ada; loadConfig berhenti pada flag dan tidak menerima override per sesi (config.ts:328-383).
- Field invalid tidak memakai default dan tidak ditandai; seluruh config ditolak dengan E_CONFIG_INVALID (config.ts:385-391).
- Struktur direktori belum mengikuti ARCHITECTURE 9.2: tidak ada providers, models, memory, skills, agents, plugins, tools, sessions, tasks, scheduler, gateway, cache, dan permissions.toml (paths.ts:36-68).
- Tidak ada migrasi config yang membuat backup atau menjaga field lama; setConfigValue menulis langsung ke config.toml (config-store.ts:49-100).

## RC-FR-150 Operability, performa, dan distribusi [partial]
- rann doctor tidak memeriksa versi aplikasi, sandbox, atau gateway; yang diperiksa hanya versi Node, permission home, socket, database, config, dan provider key (main.ts:630-686).
- Graceful shutdown tidak menyelesaikan turn atau menyimpan checkpoint; close langsung abort semua turn dan menutup database tanpa batas 5 detik (rpc.ts:2072-2086).
- Windows Service tidak ada dan installer tidak memasang unit systemd/launchd; berkas deploy hanya template manual (install.ps1 tidak memuat New-Service/sc.exe).
- Metrics dan trace tidak tersedia di CLI maupun dashboard; tidak ada endpoint atau perintah metrics/trace (gateway.ts tidak punya rute /metrics).
- Distribusi belum lengkap: tidak ada binary per platform, formula Homebrew masih template, dan installer tidak memverifikasi checksum (install.sh:107-118).

## RC-FR-151 Self-improvement terkendali [partial]
- Tidak ada evaluasi per task yang menggabungkan sukses/gagal, biaya, durasi, dan jumlah intervensi pengguna; usage dan task tidak dihubungkan (repos.ts:391-410).
- Tidak ada analisis pola kegagalan berulang; failure-analysis hanya memetakan satu error ke satu saran (failure-analysis.ts:99-115).
- Efektivitas tool tidak dilacak dan skill yang buruk tidak ditandai untuk ditinjau; recordUse hanya menghitung uses/successes/failures (skills.ts:290-296).
- Perubahan skill tidak punya validasi dan persetujuan khusus di luar permission mode write; config dan memory juga tidak memakai alur persetujuan perubahan (tools/index.ts:1463-1477).
- Rollback skill tidak dicatat di audit dan tidak ada rollback untuk perubahan config/tool/memory (skills.ts:483-502).

