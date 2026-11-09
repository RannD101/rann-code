# Tutorial Claude Code CLI

Jalur lain: [Rann Code CLI](tutorial-rann-code.md). Kembali ke [pilihan tutorial](tutorial-v1.1.0.md).

Panduan ini memasang dan memakai Claude Code, CLI agent dari Anthropic. Panduan ini bukan bagian dari Rann Code dan tidak memakai provider Rann. Perintahnya `claude`, bukan `rann`.

## 1. Yang dibutuhkan

- Node.js 18 atau lebih baru. Node.js 22 LTS disarankan.
- Akun Claude yang mendukung Claude Code, atau API key Anthropic.
- Terminal di macOS, Linux, atau Windows.
- Git disarankan untuk proyek yang memakai riwayat perubahan.

Claude Code bisa dipasang bersama Rann Code. Keduanya memakai nama perintah yang berbeda, jadi tidak saling menimpa.

## 2. Pasang Claude Code

### macOS dan Linux

Cara resmi yang disarankan:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Alternatif lewat npm:

```bash
npm install -g @anthropic-ai/claude-code
```

### Windows

Buka PowerShell baru:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Alternatif lewat npm:

```powershell
npm install -g @anthropic-ai/claude-code
```

Kalau muncul error izin saat memakai npm, jangan memakai Administrator untuk seluruh sesi. Buat folder global milik pengguna:

```powershell
mkdir $HOME\.npm-global
npm config set prefix $HOME\.npm-global
$env:Path = "$HOME\.npm-global;$env:Path"
```

Lalu ulangi perintah npm. Untuk pemakaian permanen, tambahkan folder itu ke `Path` lewat Environment Variables.

## 3. Cek instalasi

```bash
claude --version
claude doctor
```

`claude doctor` memeriksa versi Node, lokasi instalasi, dan masalah konfigurasi yang umum. Kalau perintah `claude` belum dikenali, tutup terminal, buka lagi, lalu cek `npm config get prefix`.

## 4. Masuk ke akun

Jalankan dari folder proyek:

```bash
cd ~/proyek-kamu
claude
```

Pada pemakaian pertama, Claude Code meminta login. Pilih login lewat browser, lalu selesaikan proses di halaman Anthropic. Setelah kembali ke terminal, cek status:

```bash
claude auth status
```

Kalau memakai API key, isi lewat environment, jangan tulis key di dalam repository:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Di Windows PowerShell:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

Untuk pemakaian permanen, simpan di profil shell atau secret manager. Jangan commit file yang berisi key.

## 5. Percakapan pertama

Dari folder proyek:

```bash
claude
```

Saat pertama kali membuka folder, Claude Code menanyakan apakah folder itu dipercaya. Baca daftar berkas yang bisa diakses sebelum menyetujui. Setelah masuk, ketik permintaan biasa:

```text
Baca README dan jelaskan cara menjalankan proyek ini.
```

Claude Code akan membaca berkas, menjalankan perintah yang diizinkan, dan meminta persetujuan sebelum tindakan yang mengubah sistem.

## 6. Mode non-interaktif

Untuk satu pertanyaan lalu keluar:

```bash
claude -p "Ringkas isi README proyek ini"
```

Output JSON:

```bash
claude -p "Cari penyebab tes gagal" --output-format json
```

Batasi jumlah putaran agent:

```bash
claude -p "Perbaiki tes yang gagal" --max-turns 8
```

Batasi tool yang boleh dipakai:

```bash
claude -p "Baca package.json" --allowedTools "Read,Grep"
```

Mode izin:

```bash
claude -p "Rencanakan refactor modul auth" --permission-mode plan
```

Gunakan `plan` untuk tugas yang perlu dilihat rencananya sebelum ada perubahan berkas.

## 7. Perintah di dalam sesi

- `/help` menampilkan bantuan.
- `/model` memilih model.
- `/context` menampilkan pemakaian konteks.
- `/compact` merangkum percakapan yang panjang.
- `/review` meminta tinjauan perubahan.
- `/exit` keluar dari sesi.

Daftar perintah bisa berbeda menurut versi. `/help` adalah sumber yang paling dekat dengan versi yang terpasang.

## 8. CLAUDE.md

Claude Code membaca `CLAUDE.md` di akar proyek sebagai instruksi tetap. Isi dengan hal yang tidak ingin kamu ulang setiap sesi:

```markdown
# Aturan proyek

- Pakai Node.js 22.
- Jalankan `pnpm test` sebelum menyatakan selesai.
- Jangan mengubah folder `migrations/` tanpa persetujuan.
- Bahasa komentar: Indonesia.
```

Untuk aturan pribadi yang berlaku di semua proyek, letakkan `CLAUDE.md` di folder konfigurasi pengguna. Untuk aturan tim, commit `CLAUDE.md` di repository.

## 9. Izin dan keamanan

Claude Code membedakan membaca, mengubah berkas, dan menjalankan perintah shell. Jangan memberi izin penuh ke folder yang berisi kredensial produksi.

- Mulai dengan mode `plan` atau izin baca saja.
- Periksa diff sebelum menyetujui perubahan.
- Jangan pernah menempel API key, token bot, atau password ke prompt.
- Jalankan dari folder proyek, bukan dari `~` atau `/`.
- Untuk proyek sensitif, pakai container atau akun sistem terpisah.

## 10. Windows: pilihan terminal

Installer PowerShell resmi bisa dipakai langsung. Kalau proyek membutuhkan perintah Unix (`grep`, `sed`, `bash`), gunakan WSL atau Git Bash. Jalankan Claude Code dari terminal yang sama dengan lingkungan proyek agar path dan tool konsisten.

## 11. Kalau memakai gateway atau proxy

Claude Code bisa diarahkan ke endpoint yang kompatibel dengan Anthropic API. Umumnya butuh dua variabel:

```bash
export ANTHROPIC_BASE_URL="https://gateway-contoh/v1"
export ANTHROPIC_API_KEY="token-gateway"
```

Nama variabel dan format autentikasi bisa berbeda tergantung gateway. Ikuti dokumentasi gateway, lalu uji dengan `claude doctor` dan satu prompt pendek. Jangan menganggap gateway kompatibel penuh sebelum tool call dan streaming diuji.

## 12. Perbedaan dengan Rann Code

- Perintah: `claude` untuk Claude Code, `rann` untuk Rann Code.
- Autentikasi: Claude Code memakai akun atau key Anthropic. Rann Code memakai provider yang kamu daftarkan sendiri.
- Data: Rann Code menyimpan sesi dan memori di `RANN_HOME`. Claude Code memakai konfigurasi bawaannya.
- Model: Claude Code terikat ekosistem Anthropic. Rann Code bisa memakai provider OpenAI-compatible.
- Offline: Rann Code bisa diuji dengan provider `mock`. Claude Code memerlukan autentikasi untuk menjalankan model.

## 13. Troubleshooting

`claude: command not found`

Cek `npm config get prefix`, pastikan folder `bin` ada di `PATH`, lalu buka terminal baru.

Login tidak selesai

Jalankan `claude auth status`. Kalau sesi browser gagal, ulangi `claude` dan pilih login ulang. Jangan mengisi password Anthropic ke dalam prompt.

Error izin saat npm install

Pakai folder npm milik pengguna seperti pada bagian Windows, atau pakai installer resmi yang tidak membutuhkan sudo.

Proyek tidak membaca `CLAUDE.md`

Pastikan nama berkas tepat, berada di akar proyek, dan sesi dijalankan dari folder itu. Jalankan `/context` untuk melihat berkas yang termuat.
