Rann Code 1.1.0 memperbaiki tampilan terminal yang tidak terasa berubah setelah instalasi ulang, karena rilis 1.0.0 masih dipakai installer `latest`.

## Yang berubah

- Header lengkap dicetak sekali setelah sesi tersambung. Sebelum daemon siap hanya ada satu baris `Rann Code  memuat sesi...`, bukan header penuh kedua.
- Status prompt default lebih tenang: model, context, branch, dan izin. Token serta biaya muncul setelah turn pertama; sesi, project, task, dan hitungan agen hanya pada mode `verbose` atau lebar yang relevan.
- Tagline header menjadi `coding agent`, dan pemisah status memakai `·`.
- Command palette menyembunyikan command tanpa backend secara bawaan; `ui.hide_unavailable = false` menampilkannya kembali dengan alasan.
- Dialog izin memakai hint `A/S/D/V · Esc tolak` di bawah 100 kolom; `V` membuka detail argumen penuh tanpa menutup dialog.
- Pencarian memori memperbarui `last_used_at` dan event `retrieved` dalam satu transaksi.
- 22 tes acceptance desain mencakup header 40 sampai 160 kolom, panel 40 kolom, markdown, streaming, status tool, plan, multi-agent, diff, izin, palette, kontras tiga tema, no-color, dan pemindaian emoji.
- Versi paket, installer, tutorial, dan tautan rilis naik ke 1.1.0.

## Pasang

macOS dan Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/RannD101/rann-code/main/install.sh | sh
rann --version
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/RannD101/rann-code/main/install.ps1 | iex
rann --version
```

Atau pasang tarball rilis ini langsung:

```bash
npm install -g https://github.com/RannD101/rann-code/releases/download/v1.1.0/rann-code-1.1.0.tgz
```

## Verifikasi

- `pnpm check` lulus: 484 tes lulus, 2 dilewati, 100 berkas lulus, 1 berkas dilewati.
- `acceptance-design.test.ts` lulus 22 dari 22 tes.
- Instalasi tarball diuji di prefix bersih sebelum aset diunggah.

## Catatan

- Tes pty dan resize dijalankan di Linux. Windows belum diuji di mesin fisik.
- AC-070, p95 pencarian memori di bawah 80 ms, sensitif beban mesin 2 core. Nilai dapat naik saat suite paralel atau proses lain berjalan.
- Provider live yang diuji adalah endpoint OpenAI-compatible; provider lain mengikuti kompatibilitas masing-masing.

## Checksum

Lihat `rann-code-1.1.0.tgz.sha256`.
