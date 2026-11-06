# REQUIREMENTS. Functional dan Non-Functional Rann Code V1

- Dokumen induk: MASTER.md
- Versi: 1.0
- Cakupan: bab 8 dan 9, RC-FR-001 sampai RC-FR-151, RC-NFR-001 sampai RC-NFR-024
- Aturan: setiap FR punya acceptance criteria dengan nomor sama di ACCEPTANCE-CRITERIA.md
- Prioritas: P0 wajib untuk V1 dan menjadi jalur kritis; P1 wajib untuk V1 tetapi bisa menyusul dalam urutan milestone

## 8. Functional requirements

### 8.1 Terminal interface (RC-FR-001 sampai RC-FR-020)

#### RC-FR-001. REPL interaktif
- Prioritas: P0
- Tujuan: memberi satu tempat untuk percakapan, eksekusi tool, dan kontrol sesi.
- User story: sebagai developer, aku ingin membuka terminal dan langsung bekerja dengan agent tanpa konfigurasi panjang, agar tidak kehilangan fokus.
- Requirement:
  1. `rann` tanpa argumen membuka REPL jika stdout adalah TTY, dan mode non-interaktif jika bukan TTY.
  2. REPL menampilkan header berisi nama project, branch Git, session id pendek, model aktif, dan mode izin.
  3. Prompt menerima teks, slash command, `@` untuk file, `!` untuk shell, dan lampiran gambar.
  4. Setiap turn menampilkan status yang berubah: mengirim, menunggu model, menjalankan tool, memverifikasi, selesai.
  5. `Ctrl+D` menutup REPL hanya jika input kosong; jika ada task berjalan, pengguna diminta memilih menunggu, membatalkan, atau membiarkan berjalan di background.
- Dependensi: RC-FR-002, RC-FR-007, RC-FR-010.

#### RC-FR-002. Slash command registry
- Prioritas: P0
- Tujuan: menyediakan antarmuka perintah yang konsisten dan bisa diperluas.
- User story: sebagai pengguna, aku ingin menemukan dan menjalankan perintah tanpa menghafal sintaks, agar pekerjaan cepat.
- Requirement:
  1. Registry menyimpan nama, alias, deskripsi, kategori, skema argumen, parameter opsional, permission, handler, format output, error handling, dan dokumentasi help untuk setiap command.
  2. Mengetik `/` membuka palette dengan semua command yang diizinkan untuk sesi aktif.
  3. Command yang tidak tersedia tetap terlihat dengan alasan (misalnya butuh gateway atau plugin nonaktif), kecuali mode `hideUnavailable` aktif.
  4. Konflik nama antara command bawaan, plugin, dan command project diselesaikan dengan prioritas: project, plugin, bawaan; konflik dilaporkan saat registrasi.
  5. Command bisa didefinisikan di `~/.rann/commands/` dan `.rann/commands/` dengan format yang sama.
- Dependensi: tidak ada.

#### RC-FR-003. Autocomplete dan fuzzy search
- Prioritas: P0
- Tujuan: mengurangi kesalahan ketik dan mempercepat input.
- User story: sebagai pengguna, aku ingin mengetik sebagian perintah atau nama file lalu memilih dengan keyboard.
- Requirement:
  1. Fuzzy search mencocokkan nama, alias, dan kata kunci deskripsi dengan toleransi salah ketik.
  2. Autocomplete kontekstual menampilkan model, provider, session, task, skill, MCP server, dan path file sesuai posisi argumen.
  3. Panah atas/bawah memindahkan pilihan, Tab melengkapi, Enter mengeksekusi, Esc menutup.
  4. Hasil dibatasi 50 item dan diurutkan berdasarkan relevansi, bukan abjad.
  5. Jika tidak ada hasil, tampilkan saran terdekat, bukan pesan kosong.
- Dependensi: RC-FR-002.

#### RC-FR-004. Keyboard shortcuts
- Prioritas: P0
- Tujuan: memberi kontrol penuh tanpa mouse.
- User story: sebagai pengguna terminal, aku ingin membatalkan, membuka editor, dan menggulir dengan keyboard.
- Requirement:
  1. Shortcut minimum: Enter kirim, Shift+Enter baris baru, Ctrl+C bersihkan atau batalkan, Ctrl+D keluar, Ctrl+L bersihkan layar, Ctrl+R cari riwayat, Ctrl+O perluas tool, Ctrl+E editor, Ctrl+K palette, PgUp/PgDn gulir.
  2. Shortcut bisa dilihat dengan `/help keys` dan tidak bentrok dengan shortcut terminal umum.
  3. Shortcut yang tidak didukung terminal ditampilkan sebagai tidak tersedia, bukan diam-diam gagal.
  4. Pengguna bisa menonaktifkan shortcut tertentu lewat config.
- Dependensi: RC-FR-001.

#### RC-FR-005. Multiline input dan editor eksternal
- Prioritas: P0
- Tujuan: memungkinkan prompt panjang, kode, dan diff tanpa terpotong.
- User story: sebagai pengguna, aku ingin menulis instruksi multi-baris dan membuka editor favorit.
- Requirement:
  1. Shift+Enter menambah baris baru; paste multi-baris tidak langsung mengirim.
  2. Input mendukung hingga 100.000 karakter; di atas itu pengguna diminta memakai lampiran file.
  3. Ctrl+E membuka `$EDITOR` atau `$VISUAL`, dan menyimpan hasilnya kembali ke prompt.
  4. Input multiline ditampilkan dengan indentasi dan syntax highlight dasar untuk blok kode.
  5. Batal di editor tidak mengubah prompt.
- Dependensi: RC-FR-001.

#### RC-FR-006. Input history
- Prioritas: P0
- Tujuan: mengulang dan mencari prompt sebelumnya.
- User story: sebagai pengguna, aku ingin memanggil kembali perintah atau prompt lama tanpa mengetik ulang.
- Requirement:
  1. Riwayat disimpan per project dan per profil, maksimal 1.000 entri.
  2. Panah atas/bawah menelusuri riwayat; Ctrl+R mencari dengan fuzzy.
  3. Riwayat tidak menyimpan isi file, secret, atau prompt yang ditandai `private`.
  4. `/history` menampilkan daftar, `/history clear` menghapus, dan pencarian bisa difilter berdasarkan tanggal.
  5. Riwayat bertahan setelah restart dan tidak bocor antar profil.
- Dependensi: RC-FR-001, RC-FR-149.

#### RC-FR-007. Streaming response
- Prioritas: P0
- Tujuan: memberi umpan balik cepat dan mengurangi rasa menunggu.
- User story: sebagai pengguna, aku ingin melihat jawaban muncul bertahap dan tahu jika stream terputus.
- Requirement:
  1. Delta ditampilkan dengan throttle maksimal 30 fps; teks tidak berkedip atau terduplikasi.
  2. Marker `[stream terputus]` muncul jika koneksi berakhir sebelum event selesai, dan pengguna bisa memilih lanjut atau ulangi.
  3. Reasoning delta, jika provider mengirim, ditampilkan terpisah dan bisa dilipat.
  4. Markdown dirender setelah blok selesai, bukan setiap karakter.
  5. Teks yang sudah tampil tidak dihapus saat reconnect; hanya delta baru yang ditambahkan.
- Dependensi: RC-FR-101, RC-FR-107.

#### RC-FR-008. Live tool execution display
- Prioritas: P0
- Tujuan: membuat pekerjaan agent bisa diamati.
- User story: sebagai pengguna, aku ingin tahu tool apa yang berjalan, dengan argumen apa, dan berapa lama.
- Requirement:
  1. Blok tool menampilkan nama, args ringkas, status, durasi, dan ringkasan hasil.
  2. Output panjang dilipat; Ctrl+O memperluas, dan output penuh disimpan sebagai artefak.
  3. Perintah shell ditampilkan dengan working directory dan exit code.
  4. Edit file menampilkan diff ringkas dan jumlah baris berubah.
  5. Tool yang ditolak menampilkan alasan policy, bukan error generik.
- Dependensi: RC-FR-031, RC-FR-089.

#### RC-FR-009. Task dan agent progress
- Prioritas: P0
- Tujuan: menunjukkan posisi pekerjaan dalam rencana.
- User story: sebagai pengguna, aku ingin tahu task mana yang sedang berjalan dan berapa langkah tersisa.
- Requirement:
  1. Indikator menampilkan `langkah x/y`, task aktif, dan waktu berjalan.
  2. Jika plan punya DAG, tampilkan task selesai, berjalan, dan menunggu.
  3. Jika agen menyimpang dari rencana, tampilkan penanda `replan`.
  4. Progress tidak pernah menampilkan 100 persen sebelum verifikasi selesai.
  5. Untuk task background, progress tersedia lewat `/tasks` dan notifikasi.
- Dependensi: RC-FR-024, RC-FR-036, RC-FR-121.

#### RC-FR-010. Status bar
- Prioritas: P0
- Tujuan: memberi ringkasan konteks dan biaya secara terus-menerus.
- User story: sebagai pengguna, aku ingin melihat model, token, context, dan biaya tanpa membuka command.
- Requirement:
  1. Status bar menampilkan model, provider, token masuk/keluar, persentase context, biaya turn, dan mode izin.
  2. Model tanpa harga diketahui menampilkan `$?`, bukan `$0.00`.
  3. Context menampilkan zona: hijau < 50 persen, kuning 50-74 persen, oranye 75-89 persen, merah ≥ 90 persen.
  4. Status provider bermasalah ditandai, dan fallback aktif ditampilkan.
  5. Status bar bisa dimatikan lewat config untuk terminal sempit.
- Dependensi: RC-FR-109, RC-FR-110, RC-FR-112.

#### RC-FR-011. Approval dialog
- Prioritas: P0
- Tujuan: memastikan pengguna mengendalikan aksi berisiko.
- User story: sebagai pengguna, aku ingin melihat apa yang akan terjadi sebelum menyetujui.
- Requirement:
  1. Dialog menampilkan jenis aksi, tool, args lengkap, path atau target, dampak, dan pilihan izinkan sekali, selalu izinkan pola, tolak.
  2. Untuk edit file, tampilkan diff; untuk shell, tampilkan perintah dan cwd; untuk jaringan, tampilkan domain dan metode.
  3. Esc atau `n` menolak, Enter pada pilihan aman tidak otomatis menyetujui aksi destruktif.
  4. Keputusan dan alasannya dicatat di audit.
  5. Approval yang sama untuk pola yang sama bisa diingat dalam sesi, tetapi tidak lintas project tanpa konfirmasi.
- Dependensi: RC-FR-137, RC-FR-139, RC-FR-144.

#### RC-FR-012. Interrupt, cancel, dan resume
- Prioritas: P0
- Tujuan: memberi kontrol tanpa kehilangan pekerjaan.
- User story: sebagai pengguna, aku ingin menghentikan agent dan melanjutkan dari titik terakhir.
- Requirement:
  1. Ctrl+C sekali mengosongkan input; dua kali dalam 2 detik membatalkan turn; tiga kali keluar.
  2. Pembatalan menghentikan model stream, membunuh process group tool, melepas lease, dan menyimpan checkpoint.
  3. `/resume` melanjutkan turn yang dibatalkan dari langkah terakhir.
  4. Task background bisa dibatalkan tanpa menghentikan daemon.
  5. Pembatalan tidak menghapus riwayat atau perubahan file yang sudah disetujui.
- Dependensi: RC-FR-034, RC-FR-038, RC-FR-062.

#### RC-FR-013. Terminal resize dan fallback
- Prioritas: P0
- Tujuan: memastikan UI tetap bisa dipakai di berbagai terminal.
- User story: sebagai pengguna, aku ingin layout tidak rusak saat jendela diubah ukurannya.
- Requirement:
  1. Layout merespons SIGWINCH dan menghitung ulang dalam ≤ 100 ms.
  2. Pada lebar < 60 kolom, elemen sekunder disembunyikan dan transcript tetap terbaca.
  3. Pada `TERM=dumb` atau `NO_COLOR`, renderer memakai teks sederhana tanpa escape sequence.
  4. Jika Ink gagal dimuat, CLI jatuh ke mode baris sederhana, bukan crash.
  5. UTF-8 dan karakter lebar (CJK, emoji) dihitung dengan lebar sel yang benar.
- Dependensi: RC-FR-004, RC-FR-016.

#### RC-FR-014. Non-interactive mode
- Prioritas: P0
- Tujuan: mendukung otomasi, CI, dan skrip.
- User story: sebagai operator, aku ingin menjalankan satu task dan mendapatkan hasil yang bisa diparse.
- Requirement:
  1. `rann -p "<prompt>"` menjalankan satu turn tanpa TUI.
  2. Format output: `text`, `json`, `stream-json`, dan `ndjson`.
  3. `json` menghasilkan satu objek dengan `text`, `usage`, `sessionId`, `taskId`, `status`, dan `error`.
  4. `stream-json` mengeluarkan objek per baris untuk setiap event penting.
  5. Exit code mengikuti tabel di ARCHITECTURE bagian 13.4.
- Dependensi: RC-FR-007, RC-FR-015.

#### RC-FR-015. Piped input dan output
- Prioritas: P0
- Tujuan: mengikuti konvensi Unix.
- User story: sebagai pengguna, aku ingin mengirim file atau output perintah ke Rann Code dan memakainya di pipeline.
- Requirement:
  1. Jika stdin bukan TTY, isinya dibaca sebagai konteks tambahan; prompt tetap dari argumen.
  2. stdout hanya berisi hasil, log dan status ke stderr.
  3. `rann -p ... --output-format text` bisa dipipe ke `jq`, `grep`, atau file.
  4. Input biner ditolak dengan pesan yang jelas; gambar didukung lewat `@file`.
  5. SIGPIPE ditangani tanpa stack trace.
- Dependensi: RC-FR-014.

#### RC-FR-016. Tema dan aksesibilitas
- Prioritas: P1
- Tujuan: membuat CLI nyaman dan bisa diakses.
- User story: sebagai pengguna, aku ingin memilih tema dan tetap membaca teks dengan jelas.
- Requirement:
  1. Tema `dark`, `light`, `auto`, dan `custom` dengan file token warna.
  2. Kontras teks utama ≥ 4.5:1 pada tema terang dan gelap.
  3. Status tidak hanya dibedakan dengan warna; selalu ada simbol atau teks.
  4. `NO_COLOR`, `FORCE_COLOR`, dan `--no-color` dihormati.
  5. Mode `screen-reader` menonaktifkan animasi dan spinner, serta menambah label status.
- Dependensi: RC-FR-013.

#### RC-FR-017. Shell passthrough
- Prioritas: P1
- Tujuan: memungkinkan perintah cepat tanpa melibatkan model.
- User story: sebagai pengguna, aku ingin menjalankan perintah shell di sesi yang sama.
- Requirement:
  1. `!<command>` menjalankan perintah shell dan menampilkan output, tanpa mengirim ke model.
  2. `!!<command>` menjalankan perintah dan mengirim output sebagai konteks ke model.
  3. Perintah berjalan di project cwd dan mengikuti policy izin yang sama dengan tool shell.
  4. Exit code ditampilkan; output besar dipotong dengan referensi artefak.
  5. Perintah berbahaya tetap meminta konfirmasi meskipun berasal dari input pengguna.
- Dependensi: RC-FR-089, RC-FR-139.

#### RC-FR-018. Project dan session switching
- Prioritas: P1
- Tujuan: mengelola banyak project tanpa membuka banyak terminal.
- User story: sebagai pengguna, aku ingin berpindah project dan sesi dalam satu CLI.
- Requirement:
  1. `/project` menampilkan daftar project terdaftar dan memungkinkan pindah.
  2. Pindah project memuat `RANN.md`, config, dan indeks project yang sesuai.
  3. `/sessions` menampilkan sesi per project dengan status dan waktu terakhir.
  4. `/resume <id>` membuka sesi lain tanpa menutup sesi saat ini; sesi lama tetap aktif di daemon.
  5. Perpindahan tidak menghapus draft input yang belum dikirim.
- Dependensi: RC-FR-149, RC-FR-135.

#### RC-FR-019. Lampiran dan multimodal input
- Prioritas: P0
- Tujuan: memungkinkan agent membaca gambar, PDF, dan file pendukung.
- User story: sebagai pengguna, aku ingin melampirkan screenshot atau dokumen ke prompt.
- Requirement:
  1. `@path` melampirkan file; path divalidasi dan harus berada di workspace atau diizinkan policy.
  2. Gambar (PNG, JPEG, WebP, GIF), PDF, dan teks didukung; tipe lain ditolak dengan pesan.
  3. Lampiran disimpan sebagai artefak dengan hash dan dirujuk di pesan, bukan base64 di database.
  4. Model non-multimodal menerima ekstraksi teks atau ditolak dengan saran model.
  5. Ukuran maksimum per lampiran 20 MB dan total 50 MB per turn; di atas itu pengguna diminta memisahkan.
- Dependensi: RC-FR-108, RC-FR-147.

#### RC-FR-020. Help dan error contract
- Prioritas: P0
- Tujuan: membuat CLI bisa dipelajari dan kesalahannya bisa ditindaklanjuti.
- User story: sebagai pengguna, aku ingin tahu cara memakai command dan apa arti error.
- Requirement:
  1. `/help`, `/help <command>`, dan `rann --help` menghasilkan dokumentasi dari registry yang sama.
  2. Setiap error punya kode stabil, pesan manusia, saran tindakan, dan `traceId`.
  3. `--debug` menampilkan detail teknis; tanpa flag, tidak ada stack trace atau path internal.
  4. Command yang gagal karena izin menampilkan cara mengubah izin, bukan hanya "ditolak".
  5. Semua pesan error berbahasa Indonesia dan bisa dikonfigurasi ke bahasa Inggris.
- Dependensi: RC-FR-002, RC-FR-144.

### 8.2 Agent dan planning (RC-FR-021 sampai RC-FR-039)

#### RC-FR-021. Agent reasoning loop
- Prioritas: P0
- Tujuan: memastikan agent bekerja sampai tujuan tercapai, bukan berhenti setelah memberi saran.
- User story: sebagai pengguna, aku ingin agent menyelesaikan tugas dan membuktikan hasilnya.
- Requirement:
  1. Loop terdiri dari fase `understand`, `plan`, `act`, `observe`, `evaluate`, `verify`, `report`.
  2. Loop berhenti hanya jika kriteria selesai terpenuhi, pengguna membatalkan, budget habis, atau kegagalan tidak bisa dipulihkan.
  3. Setiap fase menghasilkan event yang bisa diamati dan dicatat di trace.
  4. Agent tidak boleh mengubah goal, menaikkan permission, atau menghapus audit trail.
  5. Jika model berhenti tanpa tool call dan tanpa kriteria selesai, agent melanjutkan dengan pertanyaan atau aksi berikutnya, bukan langsung `done`.
- Dependensi: RC-FR-101, RC-FR-031, RC-FR-039.

#### RC-FR-022. Perencanaan otomatis
- Prioritas: P0
- Tujuan: memecah goal kompleks menjadi langkah yang bisa dieksekusi.
- User story: sebagai pengguna, aku ingin agent membuat rencana sendiri untuk tugas besar.
- Requirement:
  1. Planner dipanggil jika goal mengandung ≥ 3 langkah, menyentuh ≥ 3 file, atau memiliki dependensi eksternal.
  2. Plan berisi goal, task, dependensi, agen, file target, risiko, estimasi, dan kriteria selesai.
  3. Plan divalidasi terhadap skema dan dicek siklik sebelum eksekusi.
  4. Plan disimpan sebelum langkah pertama dijalankan.
  5. Untuk tugas sepele, planner boleh dilewati, tetapi keputusan itu dicatat.
- Dependensi: RC-FR-024, RC-FR-029.

#### RC-FR-023. Mode plan eksplisit
- Prioritas: P0
- Tujuan: memberi pengguna kendali sebelum perubahan besar.
- User story: sebagai pengguna, aku ingin melihat rencana sebelum agent menyentuh file.
- Requirement:
  1. `/plan` atau mode `plan` hanya menghasilkan rencana, tanpa tool tulis atau shell.
  2. Pengguna bisa menyetujui, menolak, atau mengedit task sebelum eksekusi.
  3. `--plan-only` di mode non-interaktif menghasilkan plan dalam JSON.
  4. Mode plan tetap boleh membaca file dan mencari informasi.
  5. Perpindahan dari plan ke eksekusi butuh aksi eksplisit (`/execute` atau persetujuan).
- Dependensi: RC-FR-022, RC-FR-028.

#### RC-FR-024. Dekomposisi tugas dan DAG
- Prioritas: P0
- Tujuan: mengubah goal menjadi unit kerja yang bisa diparalelkan dan diverifikasi.
- User story: sebagai pengguna, aku ingin task dipecah dengan dependensi yang jelas.
- Requirement:
  1. Setiap task punya id, judul, tujuan, agen, dependensi, file, risiko, dan kriteria selesai.
  2. Dependensi membentuk DAG; siklus ditolak dengan daftar edge yang bermasalah.
  3. Task tanpa kriteria selesai tidak valid.
  4. Task yang bisa paralel ditandai dan dijadwalkan bersamaan jika tidak ada konflik lease.
  5. Perubahan DAG setelah eksekusi menaikkan versi plan.
- Dependensi: RC-FR-025, RC-FR-053.

#### RC-FR-025. Deteksi dependensi dan urutan eksekusi
- Prioritas: P0
- Tujuan: mencegah pekerjaan dijalankan sebelum prasyaratnya selesai.
- User story: sebagai pengguna, aku ingin urutan yang benar dan tidak ada langkah yang terlewat.
- Requirement:
  1. Dependensi eksplisit dari plan dan dependensi implisit dari file atau modul dideteksi.
  2. Topological sort menghasilkan urutan yang deterministik untuk input yang sama.
  3. Task yang dependensinya gagal ditandai `blocked`, bukan `failed`.
  4. Task yang bisa berjalan tanpa menunggu dependensi non-kritis dijalankan lebih dulu.
  5. Perubahan dependensi saat replanning divalidasi ulang.
- Dependensi: RC-FR-024, RC-FR-030.

#### RC-FR-026. Penilaian risiko
- Prioritas: P0
- Tujuan: mengarahkan perhatian pengguna ke perubahan berbahaya.
- User story: sebagai pengguna, aku ingin tahu task mana yang berisiko sebelum disetujui.
- Requirement:
  1. Risiko dinilai dari kategori: perubahan skema data, migrasi, penghapusan file, operasi Git destruktif, perubahan auth, dependency baru, dan deploy.
  2. Setiap task diberi level `low`, `medium`, `high` dengan alasan.
  3. Task `high` selalu membutuhkan approval, termasuk di mode `trusted`.
  4. Risk assessment tidak boleh menurunkan level karena model yakin.
  5. Ringkasan risiko ditampilkan di plan dan approval.
- Dependensi: RC-FR-028, RC-FR-146.

#### RC-FR-027. Estimasi eksekusi
- Prioritas: P1
- Tujuan: memberi ekspektasi waktu dan biaya.
- User story: sebagai pengguna, aku ingin tahu perkiraan waktu dan biaya sebelum menyetujui plan.
- Requirement:
  1. Estimasi berupa rentang menit dan rentang biaya, bukan angka tunggal.
  2. Estimasi memakai data historis task serupa jika tersedia, dan diberi label `historical` atau `heuristic`.
  3. Estimasi diperbarui setelah plan berubah.
  4. Jika data tidak cukup, tampilkan `tidak tersedia`, bukan angka palsu.
  5. Selisih aktual vs estimasi dicatat untuk kalibrasi.
- Dependensi: RC-FR-029, RC-FR-109.

#### RC-FR-028. Persetujuan rencana
- Prioritas: P0
- Tujuan: memastikan pengguna bisa menghentikan rencana yang salah.
- User story: sebagai pengguna, aku ingin menyetujui seluruh atau sebagian rencana.
- Requirement:
  1. Approval menampilkan goal, task, risiko, file yang disentuh, dan estimasi.
  2. Pengguna bisa menyetujui semua, menyetujui task tertentu, menolak, atau meminta revisi dengan catatan.
  3. Task yang tidak disetujui tetap `pending` dan tidak dieksekusi.
  4. Approval punya masa berlaku; setelah kedaluwarsa, plan harus disetujui ulang.
  5. Keputusan dicatat dengan aktor, waktu, dan alasan.
- Dependensi: RC-FR-011, RC-FR-026, RC-FR-144.

#### RC-FR-029. Persistensi dan versi rencana
- Prioritas: P0
- Tujuan: rencana tidak hilang saat sesi berakhir.
- User story: sebagai pengguna, aku ingin melanjutkan plan besok tanpa menyusun ulang.
- Requirement:
  1. Plan disimpan di tabel `plans` dengan versi dan status.
  2. Plan lama tidak dihapus saat revisi; statusnya `superseded`.
  3. `/plan show` menampilkan versi aktif dan riwayat versi.
  4. Plan bisa diekspor ke JSON dan diimpor kembali.
  5. Plan terhubung ke task dan sesi asal.
- Dependensi: RC-FR-024, RC-FR-147.

#### RC-FR-030. Replanning dinamis
- Prioritas: P0
- Tujuan: menyesuaikan rencana saat kenyataan berbeda dari asumsi.
- User story: sebagai pengguna, aku ingin agent berhenti memaksa rencana yang sudah tidak relevan.
- Requirement:
  1. Trigger replan: task gagal permanen, dependensi berubah, file target tidak ada, atau pengguna mengubah goal.
  2. Plan baru dibuat dengan versi +1 dan alasan perubahan.
  3. Perubahan besar (menambah task `high` atau mengubah goal) butuh approval ulang.
  4. Perubahan kecil (urutan task `low`) bisa otomatis, tetapi dicatat.
  5. Task yang sudah selesai tidak diulang kecuali diminta.
- Dependensi: RC-FR-025, RC-FR-028.

#### RC-FR-031. Eksekusi multi-langkah dan pemilihan tool
- Prioritas: P0
- Tujuan: menjalankan langkah dengan tool yang tepat dan aman.
- User story: sebagai pengguna, aku ingin agent memilih tool sendiri tanpa melanggar izin.
- Requirement:
  1. Tool dipilih berdasarkan capability, izin, biaya, dan konteks tugas.
  2. Tool yang tidak diizinkan tidak pernah dikirim ke model sebagai kandidat.
  3. Setiap tool call punya id, args tervalidasi, timeout, dan audit.
  4. Agent bisa memanggil beberapa tool secara paralel jika tidak ada dependensi dan tidak melanggar concurrency.
  5. Jika tool gagal, agent menerima error terstruktur dan memutuskan langkah berikutnya.
- Dependensi: RC-FR-086, RC-FR-089, RC-FR-137.

#### RC-FR-032. Observasi dan evaluasi
- Prioritas: P0
- Tujuan: memastikan agent benar-benar membaca hasil, bukan mengabaikannya.
- User story: sebagai pengguna, aku ingin agent mengevaluasi output tool sebelum melanjutkan.
- Requirement:
  1. Setiap hasil tool dinormalisasi menjadi observation dengan status, ringkasan, data, dan artefak.
  2. Agent mengevaluasi apakah hasil memenuhi kriteria langkah.
  3. Hasil kosong, error, atau output terpotong ditandai dan tidak dianggap sukses.
  4. Evaluasi dicatat di trace dengan alasan.
  5. Jika evaluasi tidak bisa dilakukan, agent menyatakan tidak tahu, bukan mengarang.
- Dependensi: RC-FR-021, RC-FR-088.

#### RC-FR-033. Self-correction dan strategi retry
- Prioritas: P0
- Tujuan: mencegah pengulangan tindakan yang sama tanpa hasil.
- User story: sebagai pengguna, aku ingin agent mencoba cara lain ketika gagal.
- Requirement:
  1. Retry mengikuti matriks di ARCHITECTURE bagian 13.3, bukan pengulangan tanpa batas.
  2. Setelah dua kegagalan identik, percobaan ketiga wajib mengubah strategi atau parameter.
  3. Jika tidak ada strategi alternatif, agent berhenti dengan `E_NO_PROGRESS` dan analisis.
  4. Perubahan strategi dicatat beserta alasannya.
  5. Retry tidak boleh menggandakan efek samping; tool tidak idempoten tidak diulang otomatis.
- Dependensi: RC-FR-034, RC-FR-039.

#### RC-FR-034. Pemulihan error
- Prioritas: P0
- Tujuan: menjaga state konsisten saat terjadi kegagalan.
- User story: sebagai pengguna, aku ingin pekerjaan tidak rusak ketika provider atau tool gagal.
- Requirement:
  1. Error diklasifikasikan: transient, permanent, conflict, budget, policy.
  2. Transient diretry; permanent dihentikan dengan saran; conflict memicu replan; budget menghentikan task dengan laporan.
  3. Sebelum retry, state dan lease disimpan atau dilepas.
  4. Jika error terjadi setelah perubahan file, checkpoint tersedia untuk rollback.
  5. Pengguna bisa memilih `retry`, `skip`, `replan`, atau `abort` untuk error yang bisa dipulihkan.
- Dependensi: RC-FR-038, RC-FR-116, RC-FR-144.

#### RC-FR-035. Prioritas task
- Prioritas: P1
- Tujuan: memastikan pekerjaan penting berjalan lebih dulu.
- User story: sebagai pengguna, aku ingin mengatur prioritas saat banyak task antre.
- Requirement:
  1. Prioritas bernilai integer; makin tinggi makin dulu.
  2. Task yang sedang berjalan tidak dibatalkan saat prioritas berubah.
  3. Task `high` bisa memakai jalur antrean terpisah dengan concurrency lebih besar.
  4. Task yang menunggu approval tidak menghalangi task lain yang tidak butuh approval.
  5. Perubahan prioritas dicatat.
- Dependensi: RC-FR-121, RC-FR-028.

#### RC-FR-036. Goal tracking dan state
- Prioritas: P0
- Tujuan: agent tahu apa yang sedang dikejar dan apa yang sudah dicapai.
- User story: sebagai pengguna, aku ingin agent tidak kehilangan tujuan di tengah percakapan panjang.
- Requirement:
  1. Goal, kriteria selesai, dan asumsi disimpan di state task.
  2. State diperbarui setiap langkah dan bertahan setelah restart.
  3. Goal tidak bisa diubah oleh agent; hanya pengguna atau replan yang disetujui.
  4. Kriteria yang sudah terpenuhi ditandai dengan bukti.
  5. `/status` menampilkan goal, progres, dan kriteria yang belum terpenuhi.
- Dependensi: RC-FR-029, RC-FR-038.

#### RC-FR-037. Dukungan task panjang
- Prioritas: P0
- Tujuan: task berjam-jam tetap bisa dipantau dan dipulihkan.
- User story: sebagai pengguna, aku ingin meninggalkan task panjang dan kembali melihat hasilnya.
- Requirement:
  1. Heartbeat ditulis setiap ≤ 10 detik selama task berjalan.
  2. Task yang heartbeat-nya hilang > 60 detik ditandai `stalled` dan bisa dipulihkan.
  3. Task panjang memakai checkpoint berkala dan budget yang bisa dikonfigurasi.
  4. Progress dan log tersedia dari CLI, dashboard, dan messaging.
  5. Task tidak boleh berjalan tanpa batas waktu; `maxRuntime` wajib.
- Dependensi: RC-FR-038, RC-FR-121, RC-FR-131.

#### RC-FR-038. Checkpoint dan kelanjutan task
- Prioritas: P0
- Tujuan: memulihkan pekerjaan tanpa mengulang dari awal.
- User story: sebagai pengguna, aku ingin task yang terputus lanjut dari langkah terakhir.
- Requirement:
  1. Checkpoint dibuat sebelum tool tulis, setelah test lulus, dan setiap N langkah.
  2. Checkpoint menyimpan state task, daftar file berubah, hash, dan Git ref jika ada.
  3. Setelah crash, task dipulihkan dari checkpoint terakhir dan langkah yang sudah sukses tidak diulang.
  4. Restore checkpoint mengembalikan file dan state, dengan konfirmasi jika ada perubahan pengguna setelah checkpoint.
  5. Checkpoint bisa dilihat dan dihapus lewat `/checkpoint`.
- Dependensi: RC-FR-116, RC-FR-147.

#### RC-FR-039. Analisis kegagalan dan verifikasi
- Prioritas: P0
- Tujuan: laporan akhir jujur dan bisa dipercaya.
- User story: sebagai pengguna, aku ingin tahu apa yang berhasil, apa yang gagal, dan buktinya.
- Requirement:
  1. Sebelum `done`, verifier menjalankan kriteria: tes, build, runtime check, diff, atau file existence.
  2. Klaim tanpa bukti ditolak; status menjadi `verifying` atau `failed`.
  3. Laporan kegagalan memuat langkah yang dicoba, error asli, hipotesis, dan saran.
  4. Laporan sukses memuat file yang berubah, perintah verifikasi, dan hasilnya.
  5. Verifikasi yang tidak bisa dijalankan ditandai `unverified`, bukan `passed`.
- Dependensi: RC-FR-021, RC-FR-047, RC-FR-050.

### 8.3 Coding engine (RC-FR-040 sampai RC-FR-052)

#### RC-FR-040. Eksplorasi repository
- Prioritas: P0
- Tujuan: agent memahami struktur project sebelum mengubah apa pun.
- User story: sebagai pengguna, aku ingin agent tahu bahasa, framework, entry point, dan konvensi project.
- Requirement:
  1. `/init` memindai file, lockfile, konfigurasi build, dan README.
  2. Hasilnya berisi peta direktori, bahasa dominan, package manager, perintah build/test/lint, dan entry point.
  3. File biner, `node_modules`, `.git`, dan build output diabaikan secara default.
  4. Peta disimpan di `.rann/project-map.json` dan bisa diperbarui incremental.
  5. Jika deteksi ambigu, agent menyatakan asumsi dan meminta konfirmasi.
- Dependensi: RC-FR-041, RC-FR-149.

#### RC-FR-041. Pencarian kode semantik
- Prioritas: P0
- Tujuan: menemukan kode relevan tanpa membaca seluruh repo.
- User story: sebagai pengguna, aku ingin mencari berdasarkan makna, bukan hanya nama file.
- Requirement:
  1. Pencarian menggabungkan grep, indeks simbol tree-sitter, dan vektor knowledge chunk.
  2. Hasil menampilkan path, baris, cuplikan, dan alasan relevansi.
  3. Pencarian menghormati `.gitignore` dan file yang dikecualikan.
  4. Hasil dibatasi dan diberi skor; tidak ada hasil kosong tanpa penjelasan.
  5. Indeks bisa dibangun ulang dengan `/index rebuild`.
- Dependensi: RC-FR-040, RC-FR-071.

#### RC-FR-042. Operasi file dasar
- Prioritas: P0
- Tujuan: agent bisa membaca, membuat, mengubah, dan menghapus file dengan aman.
- User story: sebagai pengguna, aku ingin agent mengelola file tanpa merusak data.
- Requirement:
  1. Tool `read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `stat_file` tersedia dengan skema jelas.
  2. Path divalidasi terhadap workspace dan policy; symlink diselesaikan sebelum validasi.
  3. `write_file` menolak menimpa file yang berubah sejak dibaca tanpa konfirmasi.
  4. `delete_file` memindahkan ke trash internal sebelum hapus permanen, kecuali mode `hard`.
  5. Setiap operasi dicatat di audit dengan hash sebelum dan sesudah.
- Dependensi: RC-FR-043, RC-FR-138.

#### RC-FR-043. Patch editing yang aman
- Prioritas: P0
- Tujuan: menghindari penulisan ulang seluruh file dan konflik yang tidak terdeteksi.
- User story: sebagai pengguna, aku ingin perubahan minimal dan bisa diverifikasi.
- Requirement:
  1. `edit_file` menerima old_string dan new_string, atau unified diff, dengan konteks yang cukup unik.
  2. Jika old_string tidak ditemukan atau ditemukan lebih dari sekali, edit gagal tanpa mengubah file.
  3. Setelah tulis, file dibaca ulang dan hash dibandingkan.
  4. Diff ditampilkan dan disimpan di `file_changes`.
  5. Edit pada file yang sedang dipegang agen lain ditolak dengan `E_LEASE_CONFLICT`.
- Dependensi: RC-FR-042, RC-FR-060.

#### RC-FR-044. Modifikasi multi-file dan transaksi
- Prioritas: P0
- Tujuan: perubahan yang saling bergantung tidak setengah jadi.
- User story: sebagai pengguna, aku ingin semua file berubah bersama atau tidak sama sekali.
- Requirement:
  1. Satu tool call bisa mengubah beberapa file dalam satu transaksi.
  2. Jika satu file gagal, semua file dikembalikan ke isi awal.
  3. Sebelum transaksi, hash semua file target dicatat.
  4. Transaksi menolak file yang berubah di luar transaksi.
  5. Hasil transaksi memuat daftar file, baris berubah, dan status.
- Dependensi: RC-FR-043, RC-FR-147.

#### RC-FR-045. Code generation dan refactoring
- Prioritas: P0
- Tujuan: agent bisa menulis kode baru dan merapikan kode lama.
- User story: sebagai pengguna, aku ingin refactor yang tidak mengubah perilaku.
- Requirement:
  1. Refactor harus mempertahankan perilaku yang diuji; tes yang ada dijalankan sebelum dan sesudah.
  2. Rename simbol memperbarui semua referensi yang terdeteksi, bukan hanya satu file.
  3. Agent tidak menghapus kode yang tampak tidak terpakai tanpa bukti (grep dan simbol).
  4. Gaya kode mengikuti konfigurasi project (Prettier, ESLint, gofmt, rustfmt).
  5. Perubahan besar dipecah menjadi patch yang bisa direview.
- Dependensi: RC-FR-041, RC-FR-047.

#### RC-FR-046. Debugging dan diagnosis error
- Prioritas: P0
- Tujuan: menemukan penyebab, bukan hanya gejala.
- User story: sebagai pengguna, aku ingin agent mereproduksi bug dan memperbaikinya.
- Requirement:
  1. Agent mengumpulkan error, stack trace, log, dan langkah reproduksi.
  2. Hipotesis ditulis sebelum perubahan dan diuji satu per satu.
  3. Perbaikan disertai tes regresi yang gagal sebelum dan lulus sesudah.
  4. Jika penyebab tidak ditemukan, agent melaporkan bukti dan area yang belum diperiksa.
  5. Agent tidak menambal gejala dengan `try/catch` kosong atau `any` tanpa alasan.
- Dependensi: RC-FR-047, RC-FR-050.

#### RC-FR-047. Generasi dan eksekusi tes
- Prioritas: P0
- Tujuan: memastikan perubahan bisa diverifikasi.
- User story: sebagai pengguna, aku ingin tes dibuat dan dijalankan otomatis.
- Requirement:
  1. Agent mendeteksi framework tes dan menulis tes yang mengikuti gaya project.
  2. Tes harus bisa dijalankan ulang dengan perintah yang sama.
  3. Hasil tes menampilkan jumlah lulus, gagal, skip, dan output asli.
  4. Tes yang flaky ditandai dan dijalankan ulang maksimal dua kali.
  5. Agent tidak menghapus atau melemahkan tes yang ada untuk membuat hasil lulus.
- Dependensi: RC-FR-050, RC-FR-039.

#### RC-FR-048. Code review
- Prioritas: P0
- Tujuan: menemukan masalah sebelum commit.
- User story: sebagai pengguna, aku ingin review yang spesifik dan bisa ditindaklanjuti.
- Requirement:
  1. `/review` menganalisis diff atau file yang ditentukan.
  2. Temuan memuat path, baris, severity (`blocker`, `major`, `minor`, `nit`), penjelasan, dan saran.
  3. Temuan tanpa lokasi atau tanpa alasan tidak ditampilkan.
  4. Review mencakup bug, keamanan, performa, dan konsistensi gaya.
  5. Ringkasan memisahkan temuan pasti dan dugaan.
- Dependensi: RC-FR-041, RC-FR-049.

#### RC-FR-049. Analisis arsitektur dan dependensi
- Prioritas: P1
- Tujuan: memahami dampak perubahan pada struktur project.
- User story: sebagai pengguna, aku ingin tahu jika perubahan melanggar batas modul.
- Requirement:
  1. Analisis mendeteksi siklus dependensi, layer yang dilanggar, dan package yang tidak terpakai.
  2. Untuk JavaScript/TypeScript, analisis memakai import graph; untuk bahasa lain, gunakan parser yang tersedia.
  3. Dependency baru dilaporkan dengan lisensi dan ukuran.
  4. Hasil bisa diekspor ke Markdown atau JSON.
  5. Analisis tidak mengubah file.
- Dependensi: RC-FR-040, RC-FR-050.

#### RC-FR-050. Build, lint, typecheck, dan dependency
- Prioritas: P0
- Tujuan: memastikan perubahan bisa dibangun.
- User story: sebagai pengguna, aku ingin agent menjalankan perintah project yang benar.
- Requirement:
  1. Perintah dideteksi dari `package.json`, lockfile, Makefile, atau konfigurasi project.
  2. Jika tidak terdeteksi, agent bertanya atau memakai perintah standar dengan label asumsi.
  3. Exit code dan output asli dilaporkan; kegagalan tidak ditelan.
  4. Instalasi dependency butuh izin dan mencatat lockfile yang berubah.
  5. Perintah yang mengubah lingkungan global ditolak secara default.
- Dependensi: RC-FR-040, RC-FR-139.

#### RC-FR-051. Integrasi Git
- Prioritas: P0
- Tujuan: perubahan agent bisa dilacak dan dipulihkan.
- User story: sebagai pengguna, aku ingin melihat status, diff, dan commit tanpa keluar dari CLI.
- Requirement:
  1. Tool Git: status, diff, log, blame, branch list, show, remote.
  2. Agent tidak melakukan commit otomatis; commit hanya lewat `/commit` atau persetujuan.
  3. Commit agen menyertakan trailer `Rann-Code-Session: <id>`.
  4. Working tree kotor dicatat sebelum task dimulai.
  5. Operasi destruktif mengikuti RC-FR-146.
- Dependensi: RC-FR-115, RC-FR-116, RC-FR-146.

#### RC-FR-052. Dokumentasi dan inisialisasi project
- Prioritas: P1
- Tujuan: project baru atau lama punya dokumentasi yang berguna.
- User story: sebagai pengguna, aku ingin agent membuat README dan RANN.md yang sesuai isi project.
- Requirement:
  1. `/init` membuat `RANN.md` berisi perintah, konvensi, dan batasan project.
  2. Dokumentasi yang dihasilkan memakai fakta dari repo, bukan placeholder.
  3. Agent bisa memperbarui dokumentasi setelah perubahan besar.
  4. Dokumentasi ditulis dalam bahasa yang dipilih pengguna.
  5. File yang sudah ada tidak ditimpa tanpa konfirmasi.
- Dependensi: RC-FR-040, RC-FR-042.

### 8.4 Subagents dan agent teams (RC-FR-053 sampai RC-FR-062)

#### RC-FR-053. Spawn subagent dan profil
- Prioritas: P0
- Tujuan: memungkinkan pekerjaan didelegasikan ke agen dengan peran khusus.
- User story: sebagai pengguna, aku ingin agent membuat subagent sesuai kebutuhan tugas.
- Requirement:
  1. Subagent dibuat dengan profil yang menentukan model, system prompt, tool allowlist, permission mode, dan budget.
  2. Profil bisa berasal dari bawaan, `~/.rann/agents/`, atau `.rann/agents/`.
  3. Spawn mencatat parent, goal, konteks, dan batas kedalaman.
  4. Subagent tidak mewarisi izin parent secara otomatis; izin diambil dari irisan profil dan kebijakan sesi.
  5. Subagent yang selesai mengembalikan hasil terstruktur, bukan transkrip penuh.
- Dependensi: RC-FR-054, RC-FR-137.

#### RC-FR-054. Specialisasi agent
- Prioritas: P0
- Tujuan: setiap peran memakai pendekatan dan tool yang tepat.
- User story: sebagai pengguna, aku ingin agen arsitek, coding, testing, security, dan reviewer bekerja sesuai keahliannya.
- Requirement:
  1. Profil bawaan minimal: architect, research, coding, frontend, backend, testing, security, reviewer, documentation.
  2. Setiap profil punya deskripsi, trigger, tool allowlist, dan output yang diharapkan.
  3. Profil bisa diperluas pengguna tanpa mengubah kode inti.
  4. Agent utama memilih profil berdasarkan task, bukan berdasarkan nama yang disebut pengguna saja.
  5. Profil yang tidak cocok ditolak dengan alasan.
- Dependensi: RC-FR-053, RC-FR-077.

#### RC-FR-055. Eksekusi paralel
- Prioritas: P0
- Tujuan: mempercepat pekerjaan independen.
- User story: sebagai pengguna, aku ingin beberapa agen bekerja bersamaan tanpa saling merusak.
- Requirement:
  1. Concurrency dibatasi per provider, per model, dan per sesi.
  2. Task paralel hanya dijalankan jika tidak ada dependensi dan tidak ada konflik lease.
  3. Budget total parent mencakup semua anak.
  4. Kegagalan satu anak tidak otomatis membatalkan yang lain, kecuali kebijakan `failFast`.
  5. Hasil paralel digabung dengan status dan bukti masing-masing.
- Dependensi: RC-FR-053, RC-FR-060, RC-FR-109.

#### RC-FR-056. Delegasi dan agregasi hasil
- Prioritas: P0
- Tujuan: hasil subagent bisa dipercaya dan digabung.
- User story: sebagai pengguna, aku ingin laporan akhir yang merangkum kontribusi tiap agen.
- Requirement:
  1. Delegasi menyertakan goal, kriteria selesai, konteks, file, dan batas waktu.
  2. Subagent wajib mengembalikan status, ringkasan, bukti, file berubah, dan biaya.
  3. Klaim tanpa bukti ditandai `unverified` dan tidak dianggap selesai.
  4. Konflik antar hasil dilaporkan, bukan dipilih diam-diam.
  5. Agregasi disimpan di task parent.
- Dependensi: RC-FR-039, RC-FR-055.

#### RC-FR-057. Komunikasi antar agen
- Prioritas: P1
- Tujuan: agen bisa berkoordinasi tanpa berbagi seluruh konteks.
- User story: sebagai pengguna, aku ingin agen bertanya dan menjawab tanpa keluar dari tugasnya.
- Requirement:
  1. Pesan memakai format terstruktur: tipe, subjek, isi, referensi, dan prioritas.
  2. Pesan dicatat di `agent_messages` dan bisa diaudit.
  3. Agen hanya bisa mengirim ke parent, anak, atau peer dalam tim yang sama.
  4. Pesan tidak bisa mengubah goal atau izin penerima.
  5. Eskalasi ke pengguna terjadi jika konflik tidak selesai dalam 3 pertukaran.
- Dependensi: RC-FR-053, RC-FR-058.

#### RC-FR-058. Konteks bersama dan terisolasi
- Prioritas: P0
- Tujuan: berbagi informasi penting tanpa kebocoran dan pemborosan token.
- User story: sebagai pengguna, aku ingin subagent punya konteks cukup tetapi tidak membaca seluruh percakapan.
- Requirement:
  1. Mode `shared` membagikan goal, keputusan, artefak, dan ringkasan.
  2. Mode `isolated` hanya memberikan goal dan konteks yang eksplisit.
  3. Transkrip penuh parent tidak pernah diberikan ke anak secara default.
  4. Anak bisa meminta konteks tambahan lewat pesan, dengan persetujuan parent.
  5. Kebocoran memory atau secret antar agen ditolak.
- Dependensi: RC-FR-057, RC-FR-142.

#### RC-FR-059. Hierarki agen
- Prioritas: P1
- Tujuan: membatasi kompleksitas dan mencegah spawn tak terkendali.
- User story: sebagai pengguna, aku ingin struktur agen yang bisa dipahami.
- Requirement:
  1. Kedalaman maksimal tiga tingkat termasuk root.
  2. Jumlah anak per agen dibatasi konfigurasi, default 8.
  3. Setiap agen punya id, parent, dan path hierarki.
  4. Agen tidak bisa menjadi parent bagi dirinya sendiri.
  5. Siklus parent-child ditolak saat spawn.
- Dependensi: RC-FR-053.

#### RC-FR-060. Pencegahan konflik file
- Prioritas: P0
- Tujuan: mencegah dua agen menimpa perubahan satu sama lain.
- User story: sebagai pengguna, aku ingin perubahan paralel tidak merusak file.
- Requirement:
  1. Sebelum menulis, agen mengambil lease pada path dengan TTL dan heartbeat.
  2. Lease kedua pada path yang sama ditolak sampai lease pertama dilepas atau kedaluwarsa.
  3. Setelah menulis, hash file diperiksa; jika berubah di luar agen, tulis dibatalkan.
  4. Perubahan yang bentrok masuk merge queue dan diselesaikan dengan diff, bukan timpa.
  5. Lease yatim dilepas otomatis setelah TTL.
- Dependensi: RC-FR-043, RC-FR-055, RC-FR-147.

#### RC-FR-061. Lifecycle dan monitoring agen
- Prioritas: P0
- Tujuan: agen bisa dipantau dan dikendalikan.
- User story: sebagai pengguna, aku ingin melihat agen aktif, status, dan biayanya.
- Requirement:
  1. Status agen: `starting`, `running`, `waiting`, `done`, `failed`, `cancelled`.
  2. `/agents` menampilkan pohon, status, langkah, biaya, dan heartbeat.
  3. Heartbeat agen ≤ 10 detik; agen tanpa heartbeat 60 detik ditandai `orphaned`.
  4. Agen selesai menyimpan hasil dan transcript ringkas.
  5. Dashboard menampilkan data yang sama.
- Dependensi: RC-FR-037, RC-FR-135.

#### RC-FR-062. Pembatalan dan pemulihan agen
- Prioritas: P0
- Tujuan: menghentikan pekerjaan dengan bersih.
- User story: sebagai pengguna, aku ingin membatalkan satu agen atau seluruh tim.
- Requirement:
  1. Cancel satu agen menghentikan model call dan tool-nya, melepas lease, dan menyimpan state.
  2. Cancel parent membatalkan semua anak dalam ≤ 3 detik.
  3. Agen yang dibatalkan tidak dianggap gagal; statusnya `cancelled`.
  4. Agen orphan dipulihkan atau dibatalkan saat start, dengan keputusan yang dicatat.
  5. Tidak ada proses anak yang tertinggal setelah cancel.
- Dependensi: RC-FR-034, RC-FR-060, RC-FR-121.

### 8.5 Memory dan instruction system (RC-FR-063 sampai RC-FR-076)

#### RC-FR-063. User memory
- Prioritas: P0
- Tujuan: mengingat preferensi pengguna lintas project.
- User story: sebagai pengguna, aku ingin agent mengingat gaya kerja dan preferensiku.
- Requirement:
  1. Menyimpan preferensi bahasa, gaya jawaban, alat favorit, dan kebiasaan kerja.
  2. Memory user berlaku lintas project tetapi tidak lintas profil.
  3. Setiap entri punya sumber pesan dan tanggal.
  4. Preferensi yang bertentangan menandai entri lama `superseded`.
  5. Pengguna bisa melihat dan menghapus lewat `/memory`.
- Dependensi: RC-FR-069, RC-FR-074.

#### RC-FR-064. Project memory
- Prioritas: P0
- Tujuan: mengingat keputusan dan konvensi project.
- User story: sebagai pengguna, aku ingin agent tidak mengulang pertanyaan yang sama tentang project.
- Requirement:
  1. Menyimpan arsitektur, perintah build, konvensi, dan keputusan.
  2. Memory project terikat pada path project dan tidak dipakai di project lain.
  3. Keputusan yang diubah dicatat sebagai versi baru dengan alasan.
  4. Memory project bisa diekspor ke `RANN.md` jika diminta.
  5. Memory tidak menyimpan isi file penuh; simpan ringkasan dan referensi.
- Dependensi: RC-FR-069, RC-FR-147.

#### RC-FR-065. Session memory
- Prioritas: P1
- Tujuan: menjaga konteks dalam satu sesi panjang.
- User story: sebagai pengguna, aku ingin agent ingat apa yang baru saja terjadi di sesi ini.
- Requirement:
  1. Session memory berisi ringkasan keputusan, error, dan hasil penting.
  2. Setelah sesi berakhir, hanya ringkasan yang disimpan; transkrip mentah tidak dijadikan memory.
  3. Session memory dihapus saat sesi dihapus, kecuali dipromosikan oleh pengguna.
  4. Ringkasan diperbarui saat compaction.
  5. Session memory tidak bocor ke sesi lain.
- Dependensi: RC-FR-070, RC-FR-111.

#### RC-FR-066. Agent memory
- Prioritas: P1
- Tujuan: agen spesialis belajar dari pengalaman sebelumnya.
- User story: sebagai pengguna, aku ingin agen reviewer mengingat pola masalah yang sering muncul.
- Requirement:
  1. Memory agent terikat pada profil agen dan project.
  2. Hanya pengalaman yang relevan dengan peran yang disimpan.
  3. Memory agent tidak bisa dibaca agen lain tanpa izin.
  4. Efektivitas memory dilacak untuk menghapus yang tidak berguna.
  5. Memory agent bisa dimatikan per profil.
- Dependensi: RC-FR-053, RC-FR-069.

#### RC-FR-067. Knowledge memory
- Prioritas: P1
- Tujuan: membuat dokumen project bisa dicari dan disitasi.
- User story: sebagai pengguna, aku ingin agent menjawab berdasarkan dokumen di repo.
- Requirement:
  1. Dokumen di `.rann/knowledge/` dan file Markdown penting diindeks menjadi chunk.
  2. Chunk menyimpan path, heading, dan rentang baris.
  3. Retrieval mengembalikan sitasi yang bisa dibuka.
  4. Reindex berjalan saat file berubah atau diminta.
  5. Dokumen rahasia bisa dikecualikan lewat config.
- Dependensi: RC-FR-041, RC-FR-071.

#### RC-FR-068. Procedural memory
- Prioritas: P1
- Tujuan: menyimpan prosedur yang terbukti berhasil.
- User story: sebagai pengguna, aku ingin agent mengingat langkah yang berhasil untuk tugas berulang.
- Requirement:
  1. Prosedur disimpan dengan nama, trigger, prasyarat, langkah, dan verifikasi.
  2. Hanya prosedur yang berhasil ≥ 3 kali atau disetujui pengguna yang dipromosikan.
  3. Prosedur bisa menjadi skill jika diminta.
  4. Prosedur yang gagal berulang ditandai `stale`.
  5. Prosedur tidak menggantikan instruksi eksplisit pengguna.
- Dependensi: RC-FR-069, RC-FR-081.

#### RC-FR-069. Ekstraksi otomatis dan review kandidat
- Prioritas: P0
- Tujuan: menyeleksi informasi, bukan menyimpan semua percakapan.
- User story: sebagai pengguna, aku ingin agent belajar tanpa menyimpan sampah.
- Requirement:
  1. Ekstraktor berjalan setelah turn selesai dan menghasilkan kandidat dengan jenis, isi, sumber, dan keyakinan.
  2. Kandidat dengan keyakinan tinggi dan sumber jelas disimpan; sisanya masuk antrean review.
  3. Secret, data pribadi sensitif, dan instruksi sementara tidak disimpan.
  4. Pengguna bisa menyetujui, menolak, atau mengedit kandidat.
  5. Ekstraksi bisa dimatikan per profil atau per project.
- Dependensi: RC-FR-063, RC-FR-145.

#### RC-FR-070. Retrieval dan pencarian semantik
- Prioritas: P0
- Tujuan: mengambil memory relevan secara cepat dan akurat.
- User story: sebagai pengguna, aku ingin agent memakai memory yang tepat, bukan semua memory.
- Requirement:
  1. Retrieval menggabungkan FTS5 dan vektor dengan Reciprocal Rank Fusion.
  2. Filter wajib: profil, project, scope, status tidak dihapus, dan belum kedaluwarsa.
  3. Hasil dibatasi budget token dan diberi skor.
  4. Jika tidak ada hasil relevan di atas ambang, agent tidak menyuntikkan memory.
  5. Pencarian bisa dijelaskan lewat `/recall --explain`.
- Dependensi: RC-FR-071, RC-FR-111.

#### RC-FR-071. Indeks dan prioritas memory
- Prioritas: P0
- Tujuan: memory penting lebih mudah ditemukan.
- User story: sebagai pengguna, aku ingin keputusan penting tidak tenggelam oleh catatan kecil.
- Requirement:
  1. Setiap memory punya `importance` dan `last_used_at`.
  2. Importance dipengaruhi sumber, jenis, dan umpan balik pengguna.
  3. Memory yang sering dipakai naik peringkat, yang tidak pernah dipakai turun.
  4. Embedding dibuat asinkron dan statusnya dilacak.
  5. Reindex penuh tersedia lewat `/memory reindex`.
- Dependensi: RC-FR-072, RC-FR-147.

#### RC-FR-072. Konsolidasi dan deduplikasi
- Prioritas: P0
- Tujuan: mencegah memory berulang dan bertentangan.
- User story: sebagai pengguna, aku ingin satu fakta disimpan sekali.
- Requirement:
  1. Dedup memakai hash isi dan kemiripan vektor di atas ambang.
  2. Entri yang digabung menyimpan versi lama, bukan menghapusnya.
  3. Kontradiksi eksplisit menandai entri lama `contradicted_by`.
  4. Konsolidasi berjalan berkala dan bisa dipicu manual.
  5. Laporan konsolidasi tersedia di `/memory stats`.
- Dependensi: RC-FR-071, RC-FR-074.

#### RC-FR-073. Expiry dan staleness
- Prioritas: P1
- Tujuan: memory tidak abadi tanpa relevansi.
- User story: sebagai pengguna, aku ingin memory lama tidak mengganggu keputusan baru.
- Requirement:
  1. Setiap jenis memory punya TTL default yang bisa diubah.
  2. Memory kedaluwarsa menjadi `stale` dan tidak diinjeksi, tetapi masih bisa dilihat.
  3. Memory yang dirujuk kembali memperbarui `last_used_at` dan memperpanjang TTL.
  4. Penghapusan permanen hanya lewat perintah eksplisit atau kebijakan retensi.
  5. Job pembersihan berjalan harian.
- Dependensi: RC-FR-072, RC-FR-124.

#### RC-FR-074. Koreksi, update, dan hapus
- Prioritas: P0
- Tujuan: pengguna bisa memperbaiki memory yang salah.
- User story: sebagai pengguna, aku ingin mengubah atau menghapus memory dan melihat dampaknya.
- Requirement:
  1. Update membuat versi baru dan menyimpan alasan.
  2. Hapus bersifat soft delete; hard delete hanya dengan konfirmasi.
  3. FTS dan vektor diperbarui dalam transaksi yang sama.
  4. Audit mencatat aktor, waktu, dan perubahan.
  5. Memory yang dihapus tidak muncul di retrieval.
- Dependensi: RC-FR-072, RC-FR-144.

#### RC-FR-075. Import, export, dan inspeksi
- Prioritas: P1
- Tujuan: memory bisa dipindahkan dan diaudit.
- User story: sebagai pengguna, aku ingin membackup memory dan memindahkannya ke profil lain.
- Requirement:
  1. Export JSONL dengan metadata dan versi skema.
  2. Import mendeteksi konflik dan meminta strategi: lewati, timpa, gabung.
  3. `/memory` menampilkan daftar, filter, dan detail entri.
  4. Import tidak mengeksekusi instruksi yang ada di dalam memory.
  5. File export tidak menyertakan secret.
- Dependensi: RC-FR-074, RC-FR-140.

#### RC-FR-076. Instruction system
- Prioritas: P0
- Tujuan: instruksi project dan pengguna dipatuhi dengan prioritas yang jelas.
- User story: sebagai pengguna, aku ingin aturan project tidak bertabrakan dengan aturan global.
- Requirement:
  1. File yang didukung: `SOUL.md`, `USER.md`, `MEMORY.md`, `AGENTS.md`, `CLAUDE.md`, `RANN.md`, dan file di `.rann/rules/`.
  2. Prioritas: instruksi sistem runtime > instruksi pengguna eksplisit > project > global > default.
  3. File yang lebih spesifik (path) menang atas file umum untuk file di path tersebut.
  4. Konflik dicatat dan pemenang disebut di `/context`.
  5. Instruksi dari file tidak bisa menaikkan permission atau mematikan audit.
- Dependensi: RC-FR-070, RC-FR-137.

### 8.6 Skills dan tools (RC-FR-077 sampai RC-FR-090)

#### RC-FR-077. Discovery dan metadata skill
- Prioritas: P0
- Tujuan: agent tahu skill apa yang tersedia tanpa memuat semuanya.
- User story: sebagai pengguna, aku ingin skill ditemukan berdasarkan trigger.
- Requirement:
  1. Skill punya nama, deskripsi, trigger, versi, dependensi, dan lokasi.
  2. Discovery memindai global, project, dan registry terpasang.
  3. Metadata dimuat lebih dulu; isi penuh hanya saat diaktifkan.
  4. Nama skill unik per scope; bentrok dilaporkan.
  5. `/skills` menampilkan sumber dan status aktif.
- Dependensi: RC-FR-078, RC-FR-084.

#### RC-FR-078. Progressive loading
- Prioritas: P0
- Tujuan: menghemat token dan waktu.
- User story: sebagai pengguna, aku ingin hanya referensi yang relevan dimuat.
- Requirement:
  1. Tahap 1 metadata, tahap 2 SKILL.md, tahap 3 referensi dan skrip.
  2. Referensi dimuat berdasarkan kebutuhan tugas, bukan semua sekaligus.
  3. Jumlah token per tahap dicatat.
  4. Jika budget tidak cukup, referensi opsional dilewati dengan catatan.
  5. Skill bisa menandai bagian yang wajib.
- Dependensi: RC-FR-077, RC-FR-111.

#### RC-FR-079. Aktivasi dan pemilihan skill
- Prioritas: P0
- Tujuan: skill yang tepat dipakai pada saat yang tepat.
- User story: sebagai pengguna, aku ingin agent memilih skill tanpa aku menyebut namanya.
- Requirement:
  1. Aktivasi berdasarkan trigger, kecocokan tugas, dan riwayat keberhasilan.
  2. Skill yang dipilih mencatat alasan.
  3. Maksimal 3 skill aktif per turn kecuali ditentukan pengguna.
  4. Skill yang tidak relevan tidak boleh mengubah perilaku agent.
  5. Pengguna bisa memaksa atau melarang skill lewat `/skill`.
- Dependensi: RC-FR-077, RC-FR-068.

#### RC-FR-080. Eksekusi skill
- Prioritas: P0
- Tujuan: skill bisa menjalankan prosedur dan skrip dengan aman.
- User story: sebagai pengguna, aku ingin skill menjalankan langkah otomatis tanpa melanggar izin.
- Requirement:
  1. Skill dieksekusi dengan cwd project, env terbatas, timeout, dan sandbox yang sama dengan tool.
  2. Skrip skill tidak bisa menaikkan permission atau mengakses secret tanpa izin.
  3. Output dan error dicatat di trace.
  4. Skill bisa memanggil tool melalui broker, bukan langsung ke OS.
  5. Skill yang gagal mengembalikan error terstruktur.
- Dependensi: RC-FR-089, RC-FR-137.

#### RC-FR-081. Pembuatan dan validasi skill
- Prioritas: P0
- Tujuan: pengguna dan agent bisa membuat skill baru.
- User story: sebagai pengguna, aku ingin membuat skill dari prosedur yang berhasil.
- Requirement:
  1. `/create-skill` meminta nama, trigger, langkah, dependensi, dan contoh.
  2. Validator memeriksa frontmatter, nama, trigger, dan file referensi.
  3. Dry-run menampilkan skill yang akan dibuat tanpa menulis.
  4. Skill baru tidak aktif sampai disetujui atau diuji.
  5. Pembuatan skill oleh agent butuh persetujuan pengguna.
- Dependensi: RC-FR-068, RC-FR-077.

#### RC-FR-082. Edit dan versioning skill
- Prioritas: P1
- Tujuan: skill bisa berkembang tanpa kehilangan versi lama.
- User story: sebagai pengguna, aku ingin memperbaiki skill dan bisa kembali ke versi sebelumnya.
- Requirement:
  1. Setiap perubahan menghasilkan versi semver baru.
  2. Versi lama disimpan dan bisa dipulihkan.
  3. Perubahan mencatat alasan dan aktor.
  4. Skill yang sedang dipakai tidak berubah di tengah turn.
  5. Changelog tersedia di `/skill info`.
- Dependensi: RC-FR-081, RC-FR-147.

#### RC-FR-083. Dependensi skill
- Prioritas: P1
- Tujuan: skill bisa memakai skill atau tool lain dengan urutan yang benar.
- User story: sebagai pengguna, aku ingin skill yang membutuhkan skill lain dimuat dengan benar.
- Requirement:
  1. Dependensi dideklarasikan di frontmatter.
  2. Dependensi dimuat sebelum skill utama.
  3. Dependensi yang hilang menggagalkan aktivasi dengan pesan jelas.
  4. Siklus dependensi ditolak.
  5. Versi dependensi bisa dibatasi.
- Dependensi: RC-FR-077, RC-FR-082.

#### RC-FR-084. Registry dan instalasi skill
- Prioritas: P0
- Tujuan: skill bisa dibagikan dan dipasang dari sumber tepercaya.
- User story: sebagai pengguna, aku ingin memasang skill dari HTTPS atau Git.
- Requirement:
  1. Sumber: lokal, HTTPS tarball, dan Git repository.
  2. Checksum dan signature diverifikasi jika tersedia.
  3. Sebelum instalasi, tampilkan isi manifest, permission, dan skrip.
  4. Instalasi dari sumber tidak tepercaya butuh persetujuan eksplisit.
  5. Sumber dan versi dicatat untuk update.
- Dependensi: RC-FR-081, RC-FR-140.

#### RC-FR-085. Hapus dan update skill
- Prioritas: P1
- Tujuan: skill bisa dikelola sepanjang waktu.
- User story: sebagai pengguna, aku ingin menghapus atau memperbarui skill tanpa merusak yang lain.
- Requirement:
  1. Hapus menghapus file dan menghapus referensi, tetapi menyimpan audit.
  2. Update membandingkan versi dan menolak menimpa versi lokal yang lebih baru tanpa izin.
  3. Update menampilkan changelog dan konflik.
  4. Skill yang sedang dipakai menunggu turn selesai.
  5. Rollback ke versi sebelumnya tersedia.
- Dependensi: RC-FR-082, RC-FR-084.

#### RC-FR-086. Registry tool bawaan
- Prioritas: P0
- Tujuan: agent punya tool dasar yang lengkap.
- User story: sebagai pengguna, aku ingin agent bisa bekerja tanpa memasang tool tambahan.
- Requirement:
  1. Tool bawaan mencakup filesystem, terminal, Git, web search, HTTP, browser, eksekusi kode, database, package, testing, gambar, dokumen, sistem, scheduling, dan messaging.
  2. Setiap tool punya nama, deskripsi, skema input, skema output, permission, dan timeout default.
  3. Tool yang tidak tersedia di platform ditandai, bukan disembunyikan.
  4. `/tools` menampilkan kategori, status, dan izin.
  5. Tool bawaan bisa dimatikan per project.
- Dependensi: RC-FR-089, RC-FR-137.

#### RC-FR-087. Tool kustom dan eksternal
- Prioritas: P0
- Tujuan: pengguna bisa menambah kemampuan tanpa mengubah inti.
- User story: sebagai pengguna, aku ingin menulis tool sendiri.
- Requirement:
  1. Tool kustom bisa berupa modul TypeScript di `.rann/tools/` atau perintah CLI dengan skema JSON.
  2. Tool eksternal dijalankan sebagai proses dengan input JSON dan output JSON.
  3. Tool harus mendeklarasikan permission dan timeout.
  4. Tool tanpa skema valid ditolak saat registrasi.
  5. Tool kustom bisa diuji dengan `/tool test`.
- Dependensi: RC-FR-086, RC-FR-088.

#### RC-FR-088. Validasi skema dan chaining
- Prioritas: P0
- Tujuan: mencegah tool dipanggil dengan data yang salah.
- User story: sebagai pengguna, aku ingin error argumen yang jelas dan chaining yang aman.
- Requirement:
  1. Input dan output divalidasi dengan Zod.
  2. Error validasi menyebut path field dan nilai yang diharapkan.
  3. Chaining hanya diizinkan jika output tool A cocok dengan input tool B.
  4. Chaining tidak boleh melewati permission; setiap langkah tetap dinilai.
  5. Hasil chaining menyimpan output antara sebagai artefak.
- Dependensi: RC-FR-086, RC-FR-089.

#### RC-FR-089. Permission, timeout, retry, dan log tool
- Prioritas: P0
- Tujuan: tool berjalan dengan batas yang jelas.
- User story: sebagai pengguna, aku ingin tool tidak menggantung atau berjalan tanpa izin.
- Requirement:
  1. Setiap tool punya permission minimum dan timeout default.
  2. Timeout membunuh process group, bukan hanya proses induk.
  3. Retry hanya untuk tool idempoten dan mengikuti matriks retry.
  4. Log mencatat tool, args yang disanitasi, durasi, status, dan trace id.
  5. Output besar dipotong dan disimpan sebagai artefak.
- Dependensi: RC-FR-137, RC-FR-144, RC-FR-147.

#### RC-FR-090. Cakupan kategori tool
- Prioritas: P0
- Tujuan: memastikan seluruh kategori yang dijanjikan benar-benar ada.
- User story: sebagai pengguna, aku ingin janji fitur tidak berakhir sebagai placeholder.
- Requirement:
  1. Setiap kategori di RC-FR-086 punya minimal satu tool yang diuji end-to-end.
  2. Tool database mendukung query read-only dan penolakan write tanpa izin.
  3. Tool dokumen mendukung PDF, DOCX, dan XLSX minimal untuk ekstraksi teks.
  4. Tool gambar mendukung resize, crop, dan OCR jika mesin tersedia.
  5. Tool messaging memakai adapter yang sama dengan gateway.
- Dependensi: RC-FR-086, RC-FR-132.

### 8.7 MCP, plugin, dan hooks (RC-FR-091 sampai RC-FR-100)

#### RC-FR-091. Konfigurasi dan transport MCP
- Prioritas: P0
- Tujuan: menghubungkan Rann Code ke server MCP dengan konfigurasi yang jelas.
- User story: sebagai pengguna, aku ingin menambah server MCP lokal atau remote.
- Requirement:
  1. Konfigurasi per server berisi nama, transport, command atau URL, env, header, timeout, dan permission.
  2. Transport yang didukung: stdio dan Streamable HTTP, dengan SSE sebagai fallback jika server hanya mendukung itu.
  3. Server bisa diaktifkan per project atau global.
  4. `/mcp add`, `/mcp remove`, `/mcp list`, dan `/mcp reload` tersedia.
  5. Konfigurasi divalidasi sebelum disimpan; server yang gagal connect tidak menjatuhkan daemon.
- Dependensi: RC-FR-093, RC-FR-149.

#### RC-FR-092. Discovery tool, resource, dan prompt
- Prioritas: P0
- Tujuan: kemampuan server MCP bisa dipakai agent.
- User story: sebagai pengguna, aku ingin tool dan resource dari server muncul di daftar.
- Requirement:
  1. Saat connect, client memanggil `tools/list`, `resources/list`, dan `prompts/list` jika didukung.
  2. Nama tool diberi namespace `server.tool` untuk mencegah bentrok.
  3. Resource dan prompt disimpan dengan metadata dan bisa dibaca saat dibutuhkan.
  4. Perubahan daftar terdeteksi lewat notifikasi atau reload.
  5. Tool yang skemanya tidak valid tidak didaftarkan.
- Dependensi: RC-FR-091, RC-FR-088.

#### RC-FR-093. Autentikasi dan lifecycle MCP
- Prioritas: P0
- Tujuan: server remote yang aman dan koneksi yang stabil.
- User story: sebagai pengguna, aku ingin server MCP yang butuh login bisa dipakai tanpa menyimpan token di config.
- Requirement:
  1. OAuth 2.1 didukung untuk server HTTP yang memintanya, dengan token di secret store.
  2. Header auth bisa dikonfigurasi dan nilainya tidak pernah ditampilkan di log.
  3. Server di-restart otomatis dengan backoff jika crash, maksimal 3 kali.
  4. Status server: `connecting`, `ready`, `degraded`, `failed`, `disabled`.
  5. Timeout request mengikuti konfigurasi server dan default 30 detik.
- Dependensi: RC-FR-091, RC-FR-140.

#### RC-FR-094. Permission dan isolasi MCP
- Prioritas: P0
- Tujuan: server MCP tidak mendapat akses implisit.
- User story: sebagai pengguna, aku ingin tool MCP tetap meminta izin sesuai risikonya.
- Requirement:
  1. Setiap tool MCP punya permission default yang ditentukan konfigurasi, bukan otomatis `trusted`.
  2. Server tidak bisa membaca file di luar workspace kecuali diizinkan.
  3. Server berjalan di proses terpisah dan tidak mewarisi env sensitif.
  4. Output server diperlakukan sebagai konten tidak tepercaya.
  5. Server bisa dimatikan tanpa menghentikan sesi.
- Dependensi: RC-FR-093, RC-FR-137, RC-FR-145.

#### RC-FR-095. Instalasi dan registrasi plugin
- Prioritas: P1
- Tujuan: plugin bisa menambah kemampuan tanpa mengubah inti.
- User story: sebagai pengguna, aku ingin memasang plugin dari sumber tepercaya.
- Requirement:
  1. Plugin punya manifest berisi nama, versi, API version, permission, dan entry point.
  2. Instalasi dari folder lokal atau HTTPS tarball dengan checksum.
  3. Plugin terdaftar tetapi nonaktif sampai diaktifkan.
  4. Plugin yang bentrok nama dengan plugin lain ditolak.
  5. `/plugins` menampilkan status, versi, dan permission.
- Dependensi: RC-FR-096, RC-FR-140.

#### RC-FR-096. Lifecycle dan dependensi plugin
- Prioritas: P1
- Tujuan: plugin bisa diaktifkan, dimatikan, dan diperbarui dengan aman.
- User story: sebagai pengguna, aku ingin plugin yang rusak tidak merusak daemon.
- Requirement:
  1. Status plugin: `installed`, `enabled`, `disabled`, `error`.
  2. Dependensi plugin dimuat berurutan; dependensi hilang menggagalkan aktivasi.
  3. Plugin yang crash tidak menjatuhkan daemon; plugin ditandai `error`.
  4. Plugin bisa dinonaktifkan tanpa menghapus data.
  5. Update memeriksa kompatibilitas API sebelum menerapkan.
- Dependensi: RC-FR-095, RC-FR-097.

#### RC-FR-097. API dan permission plugin
- Prioritas: P1
- Tujuan: plugin punya batas kemampuan yang jelas.
- User story: sebagai pengembang plugin, aku ingin API stabil dan izin eksplisit.
- Requirement:
  1. Plugin API mencakup registrasi tool, command, hook, provider, dan messaging adapter.
  2. Setiap capability butuh permission di manifest.
  3. Plugin tidak bisa mengakses storage internal, secret, atau sesi lain tanpa izin.
  4. Plugin berjalan di proses anak secara default.
  5. Error plugin dikembalikan sebagai error terstruktur, bukan crash.
- Dependensi: RC-FR-096, RC-FR-142, RC-FR-143.

#### RC-FR-098. Kompatibilitas dan update plugin
- Prioritas: P1
- Tujuan: plugin lama tetap bisa dipakai atau ditolak dengan jelas.
- User story: sebagai pengguna, aku ingin tahu jika plugin tidak kompatibel.
- Requirement:
  1. Manifest menyebut rentang versi API yang didukung.
  2. Plugin di luar rentang ditolak dengan pesan versi minimum.
  3. Update menampilkan changelog dan meminta konfirmasi jika permission berubah.
  4. Rollback ke versi sebelumnya tersedia.
  5. Plugin yang tidak diupdate 90 hari ditandai `stale`.
- Dependensi: RC-FR-095, RC-FR-096.

#### RC-FR-099. Event hooks
- Prioritas: P0
- Tujuan: pengguna bisa menjalankan otomasi pada event penting.
- User story: sebagai pengguna, aku ingin hook berjalan sebelum atau sesudah tool dan task.
- Requirement:
  1. Event minimum: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `ToolError`, `PreTask`, `PostTask`, `AgentSpawn`, `AgentComplete`, `MemoryWrite`, `SkillLoad`, `ContextCompact`, `Stop`, `PreCompact`, `Notification`.
  2. Hook menerima payload JSON dengan skema per event.
  3. Hook bisa mengembalikan keputusan `allow`, `deny`, atau `modify` untuk event yang mendukung.
  4. Hook berjalan berurutan sesuai prioritas.
  5. Hook tidak bisa mengubah goal atau menaikkan permission.
- Dependensi: RC-FR-100, RC-FR-137.

#### RC-FR-100. Konfigurasi, validasi, timeout, dan error hook
- Prioritas: P0
- Tujuan: hook tidak membuat sistem macet atau tidak aman.
- User story: sebagai pengguna, aku ingin hook yang salah tidak merusak sesi.
- Requirement:
  1. Hook didefinisikan di config dengan event, command, timeout, dan `onError`.
  2. Tipe hook: command, HTTP, script, dan plugin.
  3. Timeout default 10 detik; hook yang melewati timeout dibunuh.
  4. `onError` bisa `block`, `warn`, atau `ignore`, dengan default `warn`.
  5. Dry-run menampilkan payload dan hasil tanpa menjalankan efek samping.
- Dependensi: RC-FR-099, RC-FR-089.

### 8.8 Provider, router, dan context (RC-FR-101 sampai RC-FR-114)

#### RC-FR-101. Arsitektur adapter provider
- Prioritas: P0
- Tujuan: menambah provider tanpa mengubah agent.
- User story: sebagai pengembang, aku ingin satu interface untuk semua provider.
- Requirement:
  1. Interface adapter mencakup `chat`, `stream`, `embed`, `listModels`, `health`, dan `countTokens` jika didukung.
  2. Adapter menerjemahkan request netral menjadi wire format provider dan sebaliknya.
  3. Error provider dipetakan ke kode error internal yang stabil.
  4. Adapter tidak menyimpan state sesi.
  5. Adapter baru hanya menambah folder dan entri registry.
- Dependensi: RC-FR-105, RC-FR-107.

#### RC-FR-102. Dukungan provider
- Prioritas: P0
- Tujuan: pengguna tidak terkunci pada satu vendor.
- User story: sebagai pengguna, aku ingin memakai Anthropic, OpenAI, Gemini, OpenRouter, endpoint kompatibel, dan server lokal.
- Requirement:
  1. Adapter wajib: Anthropic, OpenAI Responses, OpenAI Chat Completions, Google Gemini, OpenRouter, OpenAI-compatible, dan mock.
  2. Server lokal yang kompatibel OpenAI bisa dipakai dengan base URL kustom.
  3. Setiap adapter punya tes kontrak dan contoh konfigurasi.
  4. Provider yang tidak mendukung fitur tertentu ditandai di capability registry.
  5. Menambah provider tidak boleh mengubah kode agent atau CLI.
- Dependensi: RC-FR-101, RC-FR-105.

#### RC-FR-103. Manajemen kredensial
- Prioritas: P0
- Tujuan: API key aman dan mudah dikelola.
- User story: sebagai pengguna, aku ingin menyimpan key sekali dan tidak melihatnya di log.
- Requirement:
  1. Key disimpan di secret store terenkripsi, bukan config plaintext.
  2. Key bisa berasal dari env saat first-run, lalu dipindahkan ke store.
  3. `/provider add`, `/provider login`, `/provider test`, dan `/provider remove` tersedia.
  4. Key tidak pernah ditampilkan penuh; hanya 4 karakter terakhir.
  5. Rotasi key tidak memutus sesi yang sedang berjalan.
- Dependensi: RC-FR-140.

#### RC-FR-104. Discovery dan registrasi model
- Prioritas: P0
- Tujuan: model yang tersedia bisa diketahui dan dipakai.
- User story: sebagai pengguna, aku ingin melihat model dan menambah model manual.
- Requirement:
  1. Jika provider mendukung `listModels`, daftar diambil dan di-cache.
  2. Model manual bisa didaftarkan dengan id, context window, harga, dan capability.
  3. Model yang tidak lagi tersedia ditandai `unavailable`, bukan dihapus.
  4. `/models` menampilkan provider, context, harga, dan capability.
  5. Model alias bisa menunjuk ke model tertentu.
- Dependensi: RC-FR-105, RC-FR-112.

#### RC-FR-105. Capability registry
- Prioritas: P0
- Tujuan: sistem tidak mengasumsikan semua model sama.
- User story: sebagai pengguna, aku ingin tahu fitur yang benar-benar didukung model.
- Requirement:
  1. Capability minimum: streaming, tool calling, parallel tool calls, strict schema, structured output, vision, audio, PDF, prompt caching, reasoning, dan embedding.
  2. Capability bisa berasal dari provider, dokumentasi, atau override manual.
  3. Agent memfilter tool dan fitur berdasarkan capability.
  4. Jika capability tidak diketahui, sistem memakai asumsi aman dan menandainya.
  5. Perubahan capability dicatat dengan sumber.
- Dependensi: RC-FR-104, RC-FR-107.

#### RC-FR-106. Context window dan tokenizer
- Prioritas: P0
- Tujuan: konteks tidak overflow dan informasi penting tidak hilang.
- User story: sebagai pengguna, aku ingin percakapan panjang tetap akurat.
- Requirement:
  1. Sistem melacak context window per model dan menghitung budget input, output, dan reserve.
  2. Estimasi token memakai tokenizer model jika tersedia, atau estimator dengan error ≤ 15 persen.
  3. Saat pemakaian mencapai 75 persen, compaction dimulai; pada 90 persen, hanya operasi esensial yang diizinkan.
  4. Compaction mempertahankan goal, keputusan, error, path file, dan hasil verifikasi.
  5. Retrieval file dan memory dibatasi budget, dan overflow recovery memakai ringkasan bertahap.
  6. Prompt caching dipakai jika provider mendukung, dengan penanda bagian yang stabil.
  7. `/context` menampilkan komposisi context dan alasan pemotongan.
- Dependensi: RC-FR-070, RC-FR-109, RC-FR-111.

#### RC-FR-107. Streaming dan tool calling
- Prioritas: P0
- Tujuan: interaksi terasa hidup dan tool bisa dipanggil dengan benar.
- User story: sebagai pengguna, aku ingin jawaban streaming dan tool call yang tidak rusak.
- Requirement:
  1. Streaming mendukung delta teks, reasoning, tool call parsial, dan usage akhir.
  2. Tool call divalidasi setelah selesai; argumen parsial tidak dieksekusi.
  3. Parallel tool call didukung jika capability model mengizinkan.
  4. Stream yang terputus bisa dilanjutkan atau diulang tanpa duplikasi teks.
  5. Error streaming dipetakan ke kode yang bisa ditindaklanjuti.
- Dependensi: RC-FR-101, RC-FR-105.

#### RC-FR-108. Structured output dan multimodal
- Prioritas: P1
- Tujuan: output bisa diparse dan input kaya bisa diproses.
- User story: sebagai pengguna, aku ingin agent mengembalikan JSON valid dan membaca gambar.
- Requirement:
  1. Structured output memakai schema provider jika didukung; jika tidak, validasi dan repair terbatas.
  2. Output yang tidak valid tidak diterima sebagai hasil akhir.
  3. Multimodal mendukung gambar, PDF, dan audio jika capability tersedia.
  4. Model non-multimodal menerima ekstraksi teks atau ditolak dengan saran.
  5. Ukuran dan format divalidasi sebelum dikirim.
- Dependensi: RC-FR-105, RC-FR-019.

#### RC-FR-109. Usage dan biaya
- Prioritas: P0
- Tujuan: pengguna tahu biaya yang dikeluarkan.
- User story: sebagai pengguna, aku ingin biaya per turn, task, dan hari.
- Requirement:
  1. Usage mencatat input, output, cache read, cache write, dan provider request id.
  2. Biaya dihitung dari harga registry; jika harga tidak diketahui, biaya `null` dan ditandai.
  3. `/cost`, `/usage`, dan `/budget` menampilkan ringkasan.
  4. Budget per task dan per hari bisa ditetapkan; saat habis, task berhenti dengan `E_BUDGET_EXHAUSTED`.
  5. Usage tidak bisa diubah agent; hanya dicatat.
- Dependensi: RC-FR-104, RC-FR-147.

#### RC-FR-110. Kesehatan provider dan rate limit
- Prioritas: P0
- Tujuan: sistem tahu provider mana yang bisa dipakai.
- User story: sebagai pengguna, aku ingin fallback terjadi saat provider bermasalah.
- Requirement:
  1. Health check berkala dan on-demand mencatat status, latensi, dan error.
  2. Status: `healthy`, `degraded`, `rate_limited`, `auth_error`, `down`, `unknown`.
  3. `Retry-After` dihormati; request tidak dihantam ulang sebelum waktunya.
  4. Circuit breaker membuka setelah 5 kegagalan berturut-turut dan menutup setelah 30 detik.
  5. Status ditampilkan di `/providers` dan status bar.
- Dependensi: RC-FR-101, RC-FR-111.

#### RC-FR-111. Retry dan fallback
- Prioritas: P0
- Tujuan: pekerjaan tidak berhenti karena gangguan sementara.
- User story: sebagai pengguna, aku ingin sistem mencoba provider lain saat yang utama gagal.
- Requirement:
  1. Retry mengikuti matriks di ARCHITECTURE bagian 13.3.
  2. Fallback hanya jika model tidak dipatok atau `allowFallback` aktif.
  3. Fallback mencoba model lain dengan capability yang sama atau lebih tinggi.
  4. Setiap fallback dicatat dengan alasan dan biaya.
  5. Jika semua gagal, error akhir memuat rantai percobaan.
- Dependensi: RC-FR-110, RC-FR-114.

#### RC-FR-112. Alias dan pemilihan model
- Prioritas: P0
- Tujuan: pengguna bisa memakai nama pendek dan mengganti model dengan mudah.
- User story: sebagai pengguna, aku ingin `/model fast` atau `/model strong`.
- Requirement:
  1. Alias didefinisikan di config dan bisa menunjuk ke provider/model.
  2. `/model` tanpa argumen menampilkan model aktif dan sumber pemilihan.
  3. `/model <nama>` mengganti model untuk sesi; `--pin` mencegah fallback.
  4. Model yang dipilih eksplisit tidak diganti tanpa aturan yang mengizinkan.
  5. Perubahan model dicatat di turn.
- Dependensi: RC-FR-104, RC-FR-114.

#### RC-FR-113. Smart router
- Prioritas: P0
- Tujuan: memilih model yang tepat untuk setiap tugas.
- User story: sebagai pengguna, aku ingin model murah untuk tugas rutin dan model kuat untuk tugas sulit.
- Requirement:
  1. Router menilai kompleksitas, kebutuhan reasoning, konteks, tool, multimodal, kecepatan, biaya, dan kesehatan provider.
  2. Skor dan alasan pemilihan disimpan dan bisa dilihat dengan `/route why`.
  3. Router tidak memilih model yang tidak punya capability yang dibutuhkan.
  4. Jika tidak ada model yang cocok, router mengembalikan error yang menjelaskan kekurangan.
  5. Router belajar dari hasil task, tetapi tidak mengubah preferensi pengguna.
- Dependensi: RC-FR-105, RC-FR-109, RC-FR-110.

#### RC-FR-114. Kebijakan routing dan override
- Prioritas: P0
- Tujuan: pengguna bisa mengendalikan keputusan model.
- User story: sebagai pengguna, aku ingin aturan routing sendiri dan log keputusannya.
- Requirement:
  1. Kebijakan bisa berupa `auto`, `manual`, `cost-first`, `quality-first`, `latency-first`, dan `custom`.
  2. Aturan custom bisa memilih model berdasarkan task class, project, agen, atau biaya maksimum.
  3. Override per sesi, per task, dan per agen didukung.
  4. Routing log mencatat kandidat, skor, pilihan, dan alasan.
  5. Jika pengguna mematok model, router hanya boleh fallback jika `allowFallback` aktif.
- Dependensi: RC-FR-112, RC-FR-113.

### 8.9 Git, browser, background, dan scheduler (RC-FR-115 sampai RC-FR-126)

#### RC-FR-115. Operasi Git dasar
- Prioritas: P0
- Tujuan: perubahan bisa dilacak dan di-commit dengan benar.
- User story: sebagai pengguna, aku ingin melihat status, diff, log, branch, dan commit.
- Requirement:
  1. Tool Git menyediakan status, diff, log, show, blame, branch list, remote, stage, unstage, dan commit.
  2. Commit message dibuat dari diff dan bisa diedit pengguna.
  3. Commit tidak dibuat otomatis; butuh aksi eksplisit.
  4. Commit agen menyertakan trailer `Rann-Code-Session`.
  5. Repo dengan konflik ditolak untuk commit sampai konflik diselesaikan.
- Dependensi: RC-FR-116, RC-FR-146.

#### RC-FR-116. Checkpoint dan rollback
- Prioritas: P0
- Tujuan: perubahan agent bisa dibatalkan.
- User story: sebagai pengguna, aku ingin kembali ke keadaan sebelum perubahan.
- Requirement:
  1. Checkpoint dibuat sebelum perubahan berisiko dan setelah verifikasi sukses.
  2. Rollback mengembalikan file dan state task ke checkpoint.
  3. Rollback menolak jika ada perubahan pengguna setelah checkpoint, kecuali dipaksa dengan konfirmasi.
  4. Riwayat checkpoint bisa dilihat dan dibersihkan.
  5. Rollback dicatat di audit.
- Dependensi: RC-FR-038, RC-FR-115.

#### RC-FR-117. Worktree dan konflik
- Prioritas: P1
- Tujuan: task paralel tidak saling menimpa.
- User story: sebagai pengguna, aku ingin beberapa task berjalan di worktree terpisah.
- Requirement:
  1. Worktree bisa dibuat per task atau per agen.
  2. Merge dari worktree memakai diff dan deteksi konflik.
  3. Konflik tidak diselesaikan otomatis tanpa izin; pengguna atau agen diberi pilihan.
  4. Worktree yang selesai dibersihkan, worktree aktif tidak.
  5. Pull dan push mengikuti kebijakan izin dan tidak force push.
- Dependensi: RC-FR-060, RC-FR-115.

#### RC-FR-118. Browser automation dasar
- Prioritas: P0
- Tujuan: agent bisa berinteraksi dengan situs saat API tidak tersedia.
- User story: sebagai pengguna, aku ingin agent membuka halaman, mengisi form, dan mengambil data.
- Requirement:
  1. Aksi: navigate, click, type, scroll, select, screenshot, extract text, download, upload, dan evaluate JavaScript terbatas.
  2. Setiap aksi punya timeout dan error yang jelas.
  3. Screenshot dan file disimpan sebagai artefak.
  4. Aksi yang mengubah data atau mengirim form butuh izin.
  5. Domain yang diblokir tidak bisa diakses.
- Dependensi: RC-FR-119, RC-FR-137.

#### RC-FR-119. Isolasi sesi dan alur autentikasi browser
- Prioritas: P0
- Tujuan: sesi browser tidak bocor dan login bisa dilakukan dengan aman.
- User story: sebagai pengguna, aku ingin agent memakai sesi browser terpisah untuk setiap task.
- Requirement:
  1. Setiap task memakai browser context terpisah dengan cookie dan storage sendiri.
  2. Profil persisten hanya dipakai jika pengguna mengizinkan.
  3. Kredensial login tidak ditulis ke log atau transcript.
  4. Jika situs meminta 2FA, agent meminta pengguna menyelesaikannya.
  5. Context dihapus setelah task selesai, kecuali disimpan eksplisit.
- Dependensi: RC-FR-118, RC-FR-140, RC-FR-142.

#### RC-FR-120. Perbedaan search, fetch, dan browser
- Prioritas: P1
- Tujuan: agent memilih metode yang tepat dan tidak boros.
- User story: sebagai pengguna, aku ingin agent tahu kapan cukup HTTP, kapan perlu browser.
- Requirement:
  1. Web search mengembalikan hasil terstruktur dengan judul, URL, dan cuplikan.
  2. HTTP fetch mengambil konten statis dan menghormati robots serta batas ukuran.
  3. Browser dipakai jika halaman butuh JavaScript, login, atau interaksi.
  4. Agent mencatat alasan pemilihan metode.
  5. Jika satu metode gagal, agent mencoba metode lain yang masuk akal.
- Dependensi: RC-FR-118, RC-FR-086.

#### RC-FR-121. Eksekusi dan antrean background
- Prioritas: P0
- Tujuan: pekerjaan berjalan tanpa terminal.
- User story: sebagai pengguna, aku ingin mengirim task ke background dan menutup terminal.
- Requirement:
  1. Task background masuk antrean persisten dengan prioritas.
  2. Worker mengambil job dengan klaim transaksional dan lease.
  3. Job punya idempotency key opsional.
  4. Concurrency worker bisa dikonfigurasi.
  5. `/background` dan `/queue` menampilkan status.
- Dependensi: RC-FR-122, RC-FR-147.

#### RC-FR-122. Persistensi dan pemulihan background
- Prioritas: P0
- Tujuan: task tidak hilang saat proses mati.
- User story: sebagai pengguna, aku ingin job yang terputus dilanjutkan atau dilaporkan.
- Requirement:
  1. State job disimpan di database, bukan memori.
  2. Job `running` yang heartbeat-nya hilang dikembalikan ke `queued` atau ditandai `failed` sesuai kebijakan.
  3. Job yang sudah selesai tidak dijalankan ulang meskipun worker restart.
  4. Job `queued` tetap ada setelah restart.
  5. Pemulihan dicatat di log dan audit.
- Dependensi: RC-FR-121, RC-FR-038.

#### RC-FR-123. Monitoring, cancel, retry, dan notifikasi
- Prioritas: P0
- Tujuan: pekerjaan background bisa dikendalikan.
- User story: sebagai pengguna, aku ingin melihat, membatalkan, dan mengulang job.
- Requirement:
  1. `/background status`, `/background cancel`, dan `/background retry` tersedia.
  2. Log job bisa dilihat dan diekspor.
  3. Notifikasi dikirim saat job selesai, gagal, atau butuh approval.
  4. Retry mengikuti kebijakan dan tidak menggandakan efek samping.
  5. Job yang gagal permanen masuk dead letter dan bisa diperiksa.
- Dependensi: RC-FR-121, RC-FR-132.

#### RC-FR-124. Jenis jadwal
- Prioritas: P1
- Tujuan: pekerjaan rutin dan satu kali bisa dijadwalkan.
- User story: sebagai pengguna, aku ingin menjadwalkan backup dan laporan.
- Requirement:
  1. Dukungan one-time, recurring interval, dan cron expression.
  2. Setiap job punya timezone dan `next_run_at`.
  3. Jadwal bisa diaktifkan, dinonaktifkan, dan dihapus.
  4. `/scheduler add`, `/scheduler list`, `/scheduler run`, dan `/scheduler remove` tersedia.
  5. Job yang tumpang tindih mengikuti kebijakan `skip`, `queue`, atau `replace`.
- Dependensi: RC-FR-125, RC-FR-126.

#### RC-FR-125. Trigger, timezone, dan DST
- Prioritas: P1
- Tujuan: jadwal berjalan pada waktu yang benar di zona waktu pengguna.
- User story: sebagai pengguna, aku ingin job jam 7 pagi tetap jam 7 pagi saat DST berubah.
- Requirement:
  1. Timezone disimpan per job dan divalidasi terhadap database timezone.
  2. Perhitungan `next_run_at` memakai waktu lokal lalu dikonversi ke UTC.
  3. DST tidak menyebabkan job berjalan dua kali atau terlewat.
  4. Trigger kondisional mendukung ekspresi sederhana (status, tanggal, hasil job sebelumnya) dan event.
  5. Jika waktu terlewat saat daemon mati, kebijakan `catchUp` menentukan dijalankan sekali atau dilewati.
- Dependensi: RC-FR-124, RC-FR-126.

#### RC-FR-126. Persistensi, riwayat, dan retry jadwal
- Prioritas: P1
- Tujuan: jadwal bisa diaudit dan dipulihkan.
- User story: sebagai pengguna, aku ingin melihat riwayat job dan mengulang yang gagal.
- Requirement:
  1. Setiap eksekusi dicatat di `job_runs` dengan status, durasi, dan output.
  2. Retry policy per job: maksimal percobaan, backoff, dan batas waktu.
  3. Riwayat bisa difilter dan diekspor.
  4. Job yang gagal berulang dinonaktifkan dan memberi notifikasi.
  5. Perubahan jadwal dicatat di audit.
- Dependensi: RC-FR-124, RC-FR-123.

### 8.10 Gateway, messaging, dan dashboard (RC-FR-127 sampai RC-FR-136)

#### RC-FR-127. Gateway server dan transport
- Prioritas: P0
- Tujuan: agent bisa diakses dari luar terminal.
- User story: sebagai pengguna, aku ingin menghubungkan perangkat lain ke daemon yang sama.
- Requirement:
  1. Gateway menyediakan REST `/v1` dan WebSocket `/v1/events`.
  2. Gateway bisa berjalan di localhost, di VPS, atau di belakang reverse proxy TLS.
  3. Gateway tidak pernah membuka akses langsung ke database atau socket daemon.
  4. Gateway bisa dijalankan sebagai proses terpisah atau modul dalam daemon.
  5. Konfigurasi port, host, public URL, dan TLS divalidasi saat start.
- Dependensi: RC-FR-128, RC-FR-131.

#### RC-FR-128. Autentikasi dan pairing
- Prioritas: P0
- Tujuan: hanya perangkat yang disetujui yang bisa mengakses agent.
- User story: sebagai pengguna, aku ingin menghubungkan perangkat baru dengan kode sekali pakai.
- Requirement:
  1. `/pair` menghasilkan kode 8 karakter yang berlaku 10 menit dan hanya bisa dipakai sekali.
  2. Setelah pairing, perangkat menerima token opaque yang disimpan sebagai hash di server.
  3. Token tidak pernah ditampilkan lagi setelah dibuat; perangkat bisa meminta token baru lewat pairing ulang.
  4. Token bisa dicabut seketika dan pencabutan berlaku untuk koneksi aktif.
  5. Percobaan pairing gagal dibatasi 5 kali per 15 menit per IP.
- Dependensi: RC-FR-129, RC-FR-140.

#### RC-FR-129. Otorisasi, scope, dan RBAC
- Prioritas: P0
- Tujuan: perangkat dan pengguna hanya bisa melakukan yang diizinkan.
- User story: sebagai pemilik, aku ingin token read-only tidak bisa menjalankan task.
- Requirement:
  1. Scope minimum: `read`, `run`, `approve`, `admin`.
  2. Setiap endpoint memeriksa scope dan kepemilikan resource.
  3. Role lokal: `owner`, `operator`, `viewer`, `approver`.
  4. Token terikat pada profil dan tidak bisa mengakses profil lain.
  5. Penolakan otorisasi dicatat di audit dengan scope yang kurang.
- Dependensi: RC-FR-128, RC-FR-141.

#### RC-FR-130. Routing sesi, task, dan eksekusi remote
- Prioritas: P0
- Tujuan: permintaan dari kanal mana pun sampai ke sesi yang benar.
- User story: sebagai pengguna, aku ingin pesan Telegram dan dashboard masuk ke sesi yang sama.
- Requirement:
  1. Setiap permintaan membawa `sessionId` atau konteks yang bisa dipetakan ke sesi.
  2. Jika sesi belum ada, gateway membuat sesi baru dengan project default.
  3. Task dari messaging memakai antrean yang sama dengan CLI.
  4. Hasil dikembalikan ke kanal asal, termasuk format dan thread.
  5. Sesi terikat pada node asal sampai selesai; perpindahan node butuh langkah eksplisit.
- Dependensi: RC-FR-121, RC-FR-127, RC-FR-132.

#### RC-FR-131. Health, reconnect, dan multi-node
- Prioritas: P1
- Tujuan: gateway tetap bisa dipakai saat komponen bermasalah.
- User story: sebagai operator, aku ingin tahu status gateway dan melanjutkan setelah koneksi putus.
- Requirement:
  1. `/health` melaporkan status gateway, daemon, database, dan provider.
  2. WebSocket menyimpan event terakhir dan mengirim yang terlewat setelah reconnect.
  3. Heartbeat 20 detik; koneksi tanpa pong 60 detik ditutup.
  4. Multi-node mendukung routing berdasarkan project dan beban.
  5. Node yang mati dilaporkan, bukan di-failover diam-diam untuk task berjalan.
- Dependensi: RC-FR-127, RC-FR-037.

#### RC-FR-132. Adapter Telegram
- Prioritas: P0
- Tujuan: Telegram menjadi kanal utama untuk kontrol dan notifikasi.
- User story: sebagai pengguna, aku ingin mengirim task dan menyetujui aksi dari Telegram.
- Requirement:
  1. Adapter mendukung pesan teks, gambar, dokumen, dan tombol inline.
  2. Session dipisahkan berdasarkan chat dan topic/thread jika tersedia.
  3. Approval bisa dilakukan lewat tombol, dengan tampilan dampak dan alasan.
  4. Perintah remote minimal: `/status`, `/cancel`, `/resume`, `/model`, `/cost`, `/approve`, `/deny`.
  5. Pesan panjang dipecah sesuai batas platform dan ditandai jika terpotong.
- Dependensi: RC-FR-130, RC-FR-134, RC-FR-140.

#### RC-FR-133. Adapter Discord dan Slack
- Prioritas: P1
- Tujuan: tim bisa memakai kanal yang sudah dipakai.
- User story: sebagai tim, aku ingin agent merespons di thread yang benar.
- Requirement:
  1. Discord mendukung guild, channel, thread, dan slash command.
  2. Slack mendukung channel, thread, Block Kit, dan slash command.
  3. Pesan dan approval mengikuti format platform.
  4. Attachment diunduh dan disimpan sebagai artefak.
  5. Access control per channel dan per role didukung.
- Dependensi: RC-FR-130, RC-FR-129.

#### RC-FR-134. Web chat, lampiran, dan multi-user
- Prioritas: P1
- Tujuan: pengguna tanpa aplikasi bisa memakai agent lewat browser.
- User story: sebagai pengguna, aku ingin mengobrol dan mengunggah file dari web.
- Requirement:
  1. Web chat memakai gateway API yang sama, bukan backend terpisah.
  2. File yang diunggah disimpan sebagai artefak dengan batas ukuran.
  3. Setiap pengguna punya sesi dan identitas sendiri.
  4. Pesan bisa memuat Markdown dan blok kode.
  5. Riwayat dimuat dengan pagination dan bisa dicari.
- Dependensi: RC-FR-127, RC-FR-147.

#### RC-FR-135. Halaman dashboard
- Prioritas: P1
- Tujuan: operator bisa mengelola ekosistem tanpa CLI.
- User story: sebagai operator, aku ingin melihat dan mengubah state dari dashboard.
- Requirement:
  1. Halaman: overview, sessions, tasks, agents, plans, models, providers, skills, memory, tools, MCP, plugins, gateway, scheduler, usage, logs, permissions, settings.
  2. Setiap halaman menampilkan data nyata dari API dan menangani empty, loading, dan error state.
  3. Aksi berisiko memakai dialog konfirmasi dan alasan.
  4. Dashboard tidak menyimpan state bisnis sendiri.
  5. Dashboard bisa diakses dari mobile dengan layout responsif.
- Dependensi: RC-FR-136, RC-FR-127.

#### RC-FR-136. Konsistensi dashboard, analytics, dan log
- Prioritas: P1
- Tujuan: dashboard dan CLI tidak saling bertentangan.
- User story: sebagai pengguna, aku ingin perubahan di CLI langsung terlihat di dashboard.
- Requirement:
  1. Dashboard memakai API dan model data yang sama dengan CLI.
  2. Perubahan state memicu event dan refresh di klien lain.
  3. Analytics menampilkan usage, biaya, task sukses/gagal, dan latensi per provider.
  4. Log bisa difilter berdasarkan level, sesi, task, dan waktu.
  5. Export CSV dan JSON tersedia untuk usage dan log.
- Dependensi: RC-FR-135, RC-FR-144.

### 8.11 Keamanan, storage, config, dan operasi (RC-FR-137 sampai RC-FR-151)

#### RC-FR-137. Mode izin dan policy engine
- Prioritas: P0
- Tujuan: aksi berisiko dikendalikan oleh kebijakan, bukan oleh prompt.
- User story: sebagai pengguna, aku ingin menentukan seberapa bebas agent bekerja.
- Requirement:
  1. Mode: `read-only`, `ask`, `accept-edits`, `trusted`, `custom`.
  2. Policy dievaluasi di runtime sebelum tool dieksekusi, bukan hanya diinstruksikan ke model.
  3. Rule bisa berdasarkan tool, path, domain, perintah, dan risiko.
  4. Default aman: `ask` untuk instalasi baru, `read-only` untuk remote viewer.
  5. Perubahan mode dicatat dan tidak bisa dilakukan agent tanpa persetujuan.
- Dependensi: RC-FR-138, RC-FR-139, RC-FR-144.

#### RC-FR-138. Sandbox filesystem
- Prioritas: P0
- Tujuan: file di luar workspace tidak bisa dibaca atau diubah tanpa izin.
- User story: sebagai pengguna, aku ingin agent hanya menyentuh project yang aku buka.
- Requirement:
  1. Workspace root ditentukan saat sesi dibuat dan tidak bisa diubah agent.
  2. Path traversal, symlink, dan hardlink diselesaikan sebelum validasi.
  3. Baca dan tulis di luar workspace memerlukan izin eksplisit.
  4. File sensitif (`~/.ssh`, `.env`, kredensial) diblokir secara default.
  5. Sandbox OS dipakai jika tersedia; jika tidak, policy tetap ditegakkan di aplikasi.
- Dependensi: RC-FR-137, RC-FR-042.

#### RC-FR-139. Batasan terminal dan approval perintah
- Prioritas: P0
- Tujuan: perintah shell tidak merusak sistem.
- User story: sebagai pengguna, aku ingin perintah berbahaya ditolak atau dikonfirmasi.
- Requirement:
  1. Shell dijalankan tanpa `sudo` kecuali diizinkan eksplisit.
  2. Env sensitif dibersihkan sebelum eksekusi.
  3. Perintah destruktif dan pola berbahaya dideteksi dan butuh konfirmasi.
  4. Timeout membunuh process group.
  5. cwd selalu di dalam workspace kecuali diizinkan.
- Dependensi: RC-FR-137, RC-FR-089.

#### RC-FR-140. Secret management dan enkripsi
- Prioritas: P0
- Tujuan: kredensial tidak bocor.
- User story: sebagai pengguna, aku ingin key tersimpan aman dan tidak muncul di log.
- Requirement:
  1. Secret disimpan di vault terenkripsi dengan XChaCha20-Poly1305.
  2. Master key dari OS keychain jika tersedia, fallback passphrase dengan file 0600.
  3. Log, trace, error, dan audit menyaring pola secret.
  4. Rotasi dan ekspor terenkripsi didukung.
  5. Jika master key hilang, ada prosedur pemulihan yang jelas dan tidak merusak data lain.
- Dependensi: RC-FR-144, RC-FR-147.

#### RC-FR-141. Autentikasi pengguna dan RBAC
- Prioritas: P1
- Tujuan: beberapa pengguna bisa memakai satu instalasi dengan peran berbeda.
- User story: sebagai pemilik, aku ingin memberikan akses terbatas ke operator lain.
- Requirement:
  1. Pengguna lokal punya identitas dan role.
  2. Role: `owner`, `operator`, `viewer`, `approver`.
  3. Login dashboard memakai sesi atau token; tidak ada password default.
  4. Perubahan role dicatat dan butuh owner.
  5. Pengguna yang dicabut aksesnya kehilangan sesi aktif.
- Dependensi: RC-FR-128, RC-FR-129.

#### RC-FR-142. Isolasi sesi dan agen
- Prioritas: P0
- Tujuan: data satu sesi tidak bocor ke sesi lain.
- User story: sebagai pengguna, aku ingin sesi saya terpisah dari sesi orang lain.
- Requirement:
  1. Query database selalu memfilter `profile_id` dan `session_id`.
  2. Memory, transcript, dan artefak tidak bisa diakses lintas sesi tanpa izin.
  3. Agen hanya menerima konteks sesi miliknya.
  4. Browser context dan proses tool dipisahkan per task.
  5. Kebocoran yang terdeteksi dicatat sebagai insiden.
- Dependensi: RC-FR-058, RC-FR-119, RC-FR-143.

#### RC-FR-143. Isolasi plugin dan MCP
- Prioritas: P0
- Tujuan: kode pihak ketiga tidak mendapat akses penuh.
- User story: sebagai pengguna, aku ingin plugin tidak membaca seluruh sistem.
- Requirement:
  1. Plugin berjalan di proses terpisah dengan env minimal.
  2. MCP server berjalan di proses atau koneksi terpisah.
  3. Akses file dan jaringan dibatasi permission yang dideklarasikan.
  4. Output plugin dan MCP diperlakukan sebagai konten tidak tepercaya.
  5. Plugin bisa dimatikan tanpa menghentikan sesi.
- Dependensi: RC-FR-094, RC-FR-097, RC-FR-137.

#### RC-FR-144. Audit log
- Prioritas: P0
- Tujuan: setiap aksi penting bisa ditelusuri.
- User story: sebagai operator, aku ingin memeriksa siapa melakukan apa dan kapan.
- Requirement:
  1. Audit mencatat tool call, approval, perubahan config, perubahan izin, akses secret, dan aksi gateway.
  2. Setiap entri punya hash dan `prev_hash` sehingga perubahan bisa dideteksi.
  3. Audit tidak bisa dihapus oleh agent.
  4. Export JSONL dan verifikasi rantai hash tersedia.
  5. Retensi bisa dikonfigurasi; entri lama diarsipkan, bukan dihapus diam-diam.
- Dependensi: RC-FR-137, RC-FR-147.

#### RC-FR-145. Pertahanan prompt injection
- Prioritas: P0
- Tujuan: konten tidak tepercaya tidak bisa mengendalikan agent.
- User story: sebagai pengguna, aku ingin agent membaca file dan web tanpa mengikuti instruksi jahat di dalamnya.
- Requirement:
  1. Konten dari file, web, tool, MCP, dan plugin diberi label sumber dan tingkat kepercayaan.
  2. Instruksi di dalam konten tidak pernah menaikkan permission atau mengubah goal.
  3. Aksi yang dipicu konten tidak tepercaya butuh approval.
  4. Secret dan system prompt tidak dimasukkan ke konteks yang bisa dibaca tool.
  5. Ada suite fixture prompt injection yang dijalankan di CI.
- Dependensi: RC-FR-094, RC-FR-137, RC-FR-143.

#### RC-FR-146. Perlindungan operasi destruktif
- Prioritas: P0
- Tujuan: mencegah kehilangan data yang tidak disengaja.
- User story: sebagai pengguna, aku ingin operasi berbahaya dikonfirmasi dengan jelas.
- Requirement:
  1. Operasi berikut butuh konfirmasi eksplisit: `rm -rf`, `git reset --hard`, `git clean -fd`, `git push --force`, hapus branch, drop table, migrasi turun, dan overwrite file besar.
  2. Konfirmasi menampilkan target dan dampak, bukan hanya "lanjut?".
  3. Backup atau checkpoint dibuat sebelum operasi jika memungkinkan.
  4. Operasi yang tidak bisa dibatalkan ditolak secara default di mode `ask`.
  5. Semua percobaan dan keputusan dicatat di audit.
- Dependensi: RC-FR-116, RC-FR-144.

#### RC-FR-147. Skema storage dan integritas
- Prioritas: P0
- Tujuan: data konsisten dan bisa dipulihkan.
- User story: sebagai pengguna, aku ingin database tidak rusak setelah crash.
- Requirement:
  1. Skema mengikuti ARCHITECTURE bagian 9.3 dengan foreign key dan indeks.
  2. Migrasi versioned dan checksum.
  3. FTS dan vektor diperbarui dalam transaksi yang sama dengan data sumber.
  4. `PRAGMA integrity_check` dan `foreign_key_check` tersedia lewat `/doctor`.
  5. Garbage collection menghapus blob tanpa referensi dan data kedaluwarsa sesuai retensi.
- Dependensi: RC-FR-148, RC-FR-144.

#### RC-FR-148. Backup, restore, dan migrasi
- Prioritas: P0
- Tujuan: data tidak hilang saat upgrade atau kesalahan.
- User story: sebagai pengguna, aku ingin backup otomatis dan restore yang teruji.
- Requirement:
  1. Backup sebelum migrasi dan backup harian jika diaktifkan.
  2. Backup memakai `VACUUM INTO` dan diverifikasi dengan integrity check.
  3. Restore menghasilkan database yang sama dan tidak merusak vault.
  4. Migrasi yang gagal memulihkan backup otomatis.
  5. Perintah restore terdokumentasi dan bisa dijalankan saat daemon mati.
- Dependensi: RC-FR-147, RC-FR-149.

#### RC-FR-149. Hierarki dan struktur konfigurasi
- Prioritas: P0
- Tujuan: konfigurasi global, profil, project, dan sesi bekerja bersama.
- User story: sebagai pengguna, aku ingin mengatur default global dan override per project.
- Requirement:
  1. Hierarki: default, global, profil, project, env, flag, sesi.
  2. `/config explain <key>` menampilkan nilai efektif dan sumber.
  3. Config divalidasi dengan skema; field invalid memakai default dan ditandai.
  4. Struktur direktori mengikuti ARCHITECTURE bagian 9.2 dengan permission 0700.
  5. Migrasi config membuat backup dan tidak menghapus field tanpa jejak.
- Dependensi: RC-FR-148, RC-FR-147.

#### RC-FR-150. Operability, performa, dan distribusi
- Prioritas: P0
- Tujuan: sistem bisa dijalankan, dipantau, dan diperbarui.
- User story: sebagai operator, aku ingin instalasi bersih, health check, dan upgrade tanpa kehilangan data.
- Requirement:
  1. `rann doctor` memeriksa versi, socket, permission, database, provider, sandbox, dan gateway.
  2. Graceful shutdown menyelesaikan turn atau menyimpan checkpoint dalam ≤ 5 detik.
  3. Process supervision: systemd, launchd, atau Windows Service; restart otomatis.
  4. Log, metrics, dan trace bisa diakses lewat CLI dan dashboard.
  5. Distribusi: npm, binary per platform, Docker, dan Homebrew; update memverifikasi checksum.
- Dependensi: RC-FR-147, RC-FR-148, RC-FR-136.

#### RC-FR-151. Self-improvement terkendali
- Prioritas: P1
- Tujuan: sistem belajar dari pengalaman tanpa mengubah dirinya sendiri secara liar.
- User story: sebagai pengguna, aku ingin agent memperbaiki cara kerjanya berdasarkan hasil nyata.
- Requirement:
  1. Setiap task dievaluasi hasilnya: sukses, gagal, biaya, durasi, dan intervensi pengguna.
  2. Pola kegagalan berulang dianalisis dan menghasilkan rekomendasi, bukan perubahan langsung.
  3. Efektivitas skill dan tool dilacak; yang tidak berguna ditandai untuk ditinjau.
  4. Perubahan pada skill, tool, config, atau memory memerlukan validasi dan persetujuan sesuai kebijakan.
  5. Setiap perubahan bisa di-rollback dan dicatat di audit.
- Dependensi: RC-FR-068, RC-FR-144, RC-FR-082.

## 9. Non-functional requirements

### RC-NFR-001. Startup dan memori
- `rann --version` < 200 ms; REPL siap < 1 detik p95 pada mesin 4 core.
- RSS idle daemon < 150 MB; RSS dengan 8 agen aktif < 600 MB.
- Tidak ada memory leak > 5 persen per jam pada sesi 8 jam.

### RC-NFR-002. Latensi streaming
- Delta pertama tampil < 1,5 detik p95 setelah provider mengirim byte pertama.
- Overhead renderer < 16 ms per frame pada 30 fps.
- Tool call mulai dieksekusi < 200 ms setelah args valid.

### RC-NFR-003. Throughput gateway
- 120 request/menit per token dan 600 per IP tanpa error 5xx.
- WebSocket 500 koneksi bersamaan pada 2 vCPU, dengan heartbeat.
- Event fan-out < 50 ms p95 untuk 100 klien.

### RC-NFR-004. Database
- Query pesan terbaru < 50 ms pada 1 juta pesan.
- Retrieval memory < 80 ms p95 pada 50.000 entri.
- Insert tool call < 5 ms p95.
- Backup 1 GB < 30 detik.

### RC-NFR-005. Recovery
- Task pulih ≤ 5 detik setelah daemon restart.
- Job queue tidak kehilangan job yang sudah diakui.
- Gateway reconnect mengirim event yang terlewat tanpa duplikasi.
- Tidak ada data korup setelah kill -9 pada 100 iterasi uji.

### RC-NFR-006. Keamanan
- Tidak ada secret di log, trace, database, atau artefak build.
- Path traversal dan symlink escape ditolak 100 persen pada suite uji.
- Prompt injection fixture tidak menghasilkan aksi tanpa approval.
- Audit hash chain terverifikasi pada setiap start.

### RC-NFR-007. Skalabilitas
- 10.000 sesi dan 1 juta pesan per profil tanpa penurunan > 20 persen pada query utama.
- 8 agen paralel tanpa konflik file.
- 100 job terjadwal aktif dengan drift < 2 detik.

### RC-NFR-008. Kompatibilitas
- Linux x64/arm64, macOS x64/arm64, Windows x64.
- Node.js 22 LTS atau binary.
- Terminal xterm-256color, Windows Terminal, iTerm2.
- Provider: minimal 5 adapter lulus tes kontrak.

### RC-NFR-009. Aksesibilitas
- Kontras teks ≥ 4.5:1.
- Semua status punya teks atau simbol, bukan warna saja.
- Mode screen reader menonaktifkan animasi.
- Navigasi keyboard penuh untuk dialog approval.

### RC-NFR-010. Privasi
- Telemetry mati secara default.
- Tidak ada data yang dikirim ke pihak ketiga selain provider yang dipilih.
- Prompt dan file tidak dikirim ke layanan lain tanpa izin.
- Pengguna bisa menghapus semua data profil dengan satu perintah.

### RC-NFR-011. Maintainability
- Coverage paket inti ≥ 80 persen.
- Tidak ada circular dependency.
- Semua modul punya README dan pemilik.
- Waktu build CI < 15 menit.

### RC-NFR-012. Dokumentasi
- Setiap command punya help yang dihasilkan dari registry.
- Setiap FR punya AC dan tes atau prosedur manual.
- Contoh di dokumentasi memakai command yang benar-benar ada.
- Dokumentasi diperbarui dalam PR yang sama dengan perubahan perilaku.

### RC-NFR-013. Observability
- Log terstruktur JSON dengan `traceId`, `sessionId`, `taskId`, dan `toolCallId`.
- Metrics minimum: latensi provider, tool, dan DB; jumlah error per kode; usage token dan biaya; panjang antrean.
- Trace sampling default 10 persen, bisa 100 persen per sesi debug.
- Dashboard dan `/metrics` menampilkan data yang sama.

### RC-NFR-014. Retensi dan privasi data
- Retensi default: transcript 90 hari, log 14 hari, audit 1 tahun, artefak 30 hari, backup 7 hari.
- Retensi bisa diubah per profil; penghapusan permanen butuh konfirmasi.
- Export dan hapus semua data profil tersedia lewat satu perintah.
- Tidak ada data yang dikirim ke pihak ketiga selain provider yang dipilih pengguna.

### RC-NFR-015. Deployment
- Mode lokal: satu proses daemon, tanpa port terbuka.
- Mode VPS: gateway di belakang TLS, daemon hanya di localhost atau jaringan privat.
- Mode container: image tunggal dengan volume untuk `~/.rann` dan workspace.
- Health check tersedia untuk systemd, Docker, dan Kubernetes.
- Tidak ada dependensi wajib pada Redis, PostgreSQL, atau layanan cloud.

### RC-NFR-016. Upgrade dan kompatibilitas data
- Upgrade minor tidak mengubah skema tanpa migrasi otomatis.
- Downgrade tidak didukung; restore backup adalah jalur resmi.
- Data lama harus bisa dibaca setelah migrasi, dengan tes fixture versi sebelumnya.
- Config lama dimigrasikan dengan backup dan laporan perubahan.

### RC-NFR-017. Distribusi dan integritas
- Setiap artefak rilis punya checksum SHA-256 dan signature.
- Binary dan paket npm memakai versi yang sama.
- Auto-update memverifikasi signature sebelum menerapkan.
- Tidak ada akses jaringan saat instalasi offline; paket bisa diunduh manual.

### RC-NFR-018. Efisiensi biaya
- Operasi non-model (parsing, indexing, retrieval) tidak memanggil model.
- Embedding hanya untuk konten yang lolos filter dan dedup.
- Router memilih model termurah yang memenuhi capability, kecuali kebijakan lain.
- Budget per task dan per hari wajib bisa ditetapkan; default tidak membatasi tetapi memberi peringatan pada 80 persen.

### RC-NFR-019. Extensibility
- Provider, tool, command, skill, plugin, hook, messaging adapter, dan storage backend punya interface publik.
- Penambahan adapter tidak mengubah paket `agent`.
- Versi API plugin dan SDK mengikuti semver.
- Ada contoh dan tes untuk setiap jenis ekstensi.

### RC-NFR-020. Testability
- Semua komponen inti bisa diuji tanpa provider nyata.
- Waktu, ID, dan randomness bisa diinjeksi untuk tes deterministik.
- Provider mock mendukung skenario sukses, timeout, 429, 500, stream terputus, dan tool call invalid.
- E2E berjalan di CI dengan database sementara dan filesystem fixture.

### RC-NFR-021. Internasionalisasi
- Pesan UI tersedia dalam Indonesia dan Inggris.
- Bahasa default mengikuti locale, bisa diubah lewat config.
- Tanggal, angka, dan mata uang mengikuti locale pengguna.
- Prompt sistem tidak bergantung pada bahasa UI.

### RC-NFR-022. Resource limits
- Setiap tool punya timeout, batas output, dan batas memori jika memungkinkan.
- Jumlah agen, job, dan koneksi dibatasi konfigurasi.
- Queue bisa menolak job baru dengan `E_QUEUE_FULL` saat batas tercapai.
- Daemon memantau file descriptor dan koneksi DB.

### RC-NFR-023. Concurrency
- Tidak ada dua penulis database bersamaan; antrean tulis internal.
- Path lease mencegah dua agen menulis file yang sama.
- Event emitter tidak memblokir; listener lambat diputus dengan peringatan.
- Tidak ada state global yang bocor antar sesi.

### RC-NFR-024. Stabilitas API dan event
- JSON-RPC, REST, dan event memakai versi.
- Field tidak dihapus tanpa deprecation minimal satu minor.
- Penambahan field tidak dianggap breaking.
- Skema event dan API diuji dengan snapshot dan kontrak.
