# Terminal UI Rann Code

Dokumen ini mencatat keputusan tampilan, ambang responsif, dan bukti untuk 20 kriteria acceptance desain terminal. Semua status di bawah mengacu pada `pnpm check` tanggal 2026-11-10.

## Keputusan renderer

Tampilan memakai renderer ANSI sendiri di atas `readline` dan raw mode, bukan Ink atau blessed. Alasannya kontrol penuh atas streaming token, lebar baris, dan urutan escape, sehingga layar tidak perlu digambar ulang setiap potongan teks. Lapisan tampilan dipisah per komponen di `packages/cli/src/tui/`, sedangkan `ui.ts` menangani warna, tema, dan pengukuran lebar.

Konsekuensinya, setiap komponen harus punya tes lebar dan tes isi sendiri. Benefitnya, CLI tidak menambah dependensi runtime dan startup tetap di bawah satu detik.

## Warna dan tema

`RANN_COLOR` menerima `truecolor`, `256`, `16`, dan `none`. Tanpa nilai itu, kedalaman warna dideteksi dari `TERM` dan `COLORTERM`. `NO_COLOR` mematikan warna sepenuhnya. Tema bawaan: `auto`, `dark`, `light`, dan `minimal`; tema kustom dibaca dari `~/.rann/theme.json`, atau `$RANN_HOME/theme.json` bila `RANN_HOME` diatur.

Warna tidak pernah menjadi satu-satunya pembeda. Status tool memakai penanda teks (`[ ]`, `[>]`, `[x]`, `[!]`, `[-]`, `[?]`), dan setiap panel tetap terbaca saat `RANN_COLOR=none`.

## Mode tampilan

`--ui interactive|compact|verbose|debug` atau `RANN_UI_MODE` memilih kerapatan tampilan. Nilai asing ditolak dengan pesan yang menyebut pilihan sah. Mode non-interaktif dicapai lewat `rann run "<prompt>"`, `--json`, dan pipa stdin; mode ini tidak membuka prompt keyboard.

## Ambang lebar

- Di bawah 60 kolom, header hanya menampilkan nama, model, dan direktori; status bar menyisakan model dan context.
- Di bawah 100 kolom, hint izin dipendekkan menjadi `A/S/D/V · Esc tolak`.
- Pada 100 kolom ke atas, hint izin ditulis penuh dan detail argumen tetap dipotong 600 karakter sampai pengguna menekan `V`.
- Status bar menampilkan project pada 134 kolom, task pada 126 kolom, dan jumlah agen pada 120 kolom.
- Semua panel diuji pada 40 kolom; tidak ada baris yang melewati lebar terminal.

## Pintasan

`Ctrl+C` menghentikan operasi, `Ctrl+D` keluar atau memilih aksi saat sibuk, `Ctrl+L` membersihkan layar, `Ctrl+R` mencari riwayat, `Tab` melengkapi perintah dan path, `Esc` menutup popup atau menolak dialog, `↑` dan `↓` memindahkan pilihan, `Enter` mengirim, `Shift+Enter` menambah baris, dan `Ctrl+K` membuka command palette. Daftar yang dinonaktifkan bisa diatur lewat `RANN_DISABLED_SHORTCUTS`.

## Kriteria acceptance

| No | Kriteria | Status | Bukti |
| --- | --- | --- | --- |
| 1 | `rann` membuka interface interaktif | lulus | `acceptance-pty.test.ts` AC-001, `acceptance-design.test.ts` tes palette |
| 2 | `/` langsung membuka saran command | lulus | `acceptance-design.test.ts` tes palette, `acceptance-pty.test.ts` AC-002 |
| 3 | Saran command bisa dinavigasi keyboard | lulus | tes palette menekan panah bawah lalu Enter dan menjalankan `/agents` |
| 4 | Markdown dirender benar | lulus | tes markdown pada `acceptance-design.test.ts` |
| 5 | Code block punya syntax highlighting | lulus | tes highlighter mempertahankan teks asli |
| 6 | Streaming tidak menyebabkan flickering | lulus | tes `MarkdownStream` memastikan tidak ada `ESC[2J` atau `ESC[H` |
| 7 | Eksekusi tool terlihat realtime | lulus | `acceptance-pty.test.ts` AC-008, enam status di `tui-premium.test.ts` |
| 8 | Plan dapat dipantau | lulus | tes plan menghitung progres, status, agen, dan batas 20 baris |
| 9 | Aktivitas multi-agent dapat dipantau | lulus | tes agent menampilkan status dan ringkasan 5 agen |
| 10 | Diff dapat dibaca | lulus | tes diff menghitung tambah dan hapus |
| 11 | Approval interface berfungsi | lulus | `acceptance-pty.test.ts` AC-011, tes `V` pada `chooseWith` |
| 12 | Status bar menampilkan informasi relevan | lulus | `acceptance-pty.test.ts` AC-010, tes status bar 40 dan 160 kolom |
| 13 | Resize terminal ditangani | lulus | `acceptance-resize.test.ts` AC-013 |
| 14 | Tampilan nyaman di terminal kecil | lulus | tes panel 40 kolom dan header 40 sampai 160 kolom |
| 15 | Mode non-interaktif bekerja | lulus | tes `rann run` menghasilkan teks polos tanpa escape, `acceptance-cli.test.ts` AC-014 dan AC-015 |
| 16 | No-color tetap terbaca | lulus | tes pty `RANN_COLOR=none`, `acceptance-cli.test.ts` AC-016 |
| 17 | Tidak ada emoji sebagai elemen desain | lulus | pemindaian seluruh sumber `.ts` non-tes |
| 18 | Tidak ada placeholder UI | lulus | audit manual `/status`, `/plan`, `/agents`, dialog izin; semua panel memakai data sesi |
| 19 | Command yang ditampilkan berfungsi | lulus | palette menyembunyikan command yang belum tersedia secara bawaan; command yang dipanggil langsung tetap menyebut alasan |
| 20 | Seluruh komponen punya pengujian | lulus | 22 tes di `acceptance-design.test.ts` plus tes unit tiap modul `tui/` |

## Perintah verifikasi

```bash
cd /root/rann-code
export PATH=/root/.nvm/versions/node/v22.23.3/bin:$PATH
pnpm check
pnpm vitest run packages/cli/src/acceptance-design.test.ts
```

Hasil terakhir: `pnpm check` lulus dengan 484 tes lulus, 2 dilewati, 100 berkas lulus, 1 dilewati. Berkas acceptance desain berisi 22 tes dan semuanya lulus.

## Batas yang diketahui

- Clipboard dan copy code block bergantung pada terminal. Tidak ada integrasi clipboard khusus.
- Deteksi tema terang bergantung pada `COLORFGBG`; terminal yang tidak mengirim variabel itu memakai tema gelap.
- Command yang belum punya backend disembunyikan dari palette, tetapi masih muncul di `rann --help` dengan label `belum tersedia` dan alasan.
