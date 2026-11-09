Rann Code 1.0.0 adalah rilis stabil pertama setelah seluruh 151 functional requirement dan 151 acceptance criteria PRD v1 lulus.

## Yang berubah

- Audit acceptance criteria mencapai 151 dari 151 `pass`.
- `pnpm check` hijau: 451 tes lulus, 2 dilewati, lint dan depcruise bersih.
- Esc membatalkan dialog izin tanpa membuat perubahan berkas.
- Resize terminal diuji dari 40x20 ke 200x60 melalui pty nyata.
- Refactor menjaga perilaku tes dan ekspor publik.
- Provider live, estimator token, embedding memori, checksum skill, dan 8 subagent paralel sudah diuji.
- Versi paket dan CLI naik ke 1.0.0.

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
npm install -g https://github.com/RannD101/rann-code/releases/download/v1.0.0/rann-code-1.0.0.tgz
```

## Tutorial

- Rann Code CLI: https://github.com/RannD101/rann-code/blob/main/docs/tutorial-rann-code.md
- Claude Code CLI: https://github.com/RannD101/rann-code/blob/main/docs/tutorial-claude-code.md
- Perbandingan dua jalur: https://github.com/RannD101/rann-code/blob/main/docs/tutorial-v1.0.0.md

## Catatan

- Tes pty dan resize dijalankan di Linux. Windows belum diuji di mesin fisik.
- AC-070, p95 pencarian memori di bawah 80 ms, sensitif beban mesin 2 core. Run tunggal dan `pnpm check` terakhir lulus.
- Provider live yang diuji adalah endpoint OpenAI-compatible dengan model `river/GLM-5.3`. Provider lain mengikuti kompatibilitas masing-masing.

## Checksum

Lihat `rann-code-1.0.0.tgz.sha256`.
