# Tutorial Rann Code v1.1.0

Jalur lain: [Claude Code CLI](tutorial-claude-code.md). Kembali ke [pilihan tutorial](tutorial-v1.1.0.md).

Panduan ini untuk kamu yang baru pertama kali memakai Rann Code. Semua langkah ditulis untuk pengguna, bukan pengembang. Kamu tidak perlu clone repository, tidak perlu pnpm, dan tidak perlu npx.

Yang kamu butuhkan hanya Node.js 22 LTS minimal 22.11, koneksi internet, dan terminal. API key provider model bersifat opsional saat pertama mencoba, karena Rann Code punya provider `mock` yang tidak memanggil jaringan.

Catatan uji: langkah Windows di tutorial ini belum diuji di mesin Windows fisik. Perintah PowerShell ditulis mengikuti perilaku npm dan Node.js pada umumnya. Kalau ada langkah yang gagal, pakai bagian Troubleshooting di bawah.

## 1. Kenali tiga hal ini dulu

Rann Code adalah aplikasi terminal untuk mengobrol dengan AI coding agent. Agent bisa membaca file, menulis file, menjalankan perintah shell, menyimpan memori, dan membuat skill.

Ada tiga bagian yang sering tertukar:

- Node.js: mesin yang menjalankan aplikasi. Ini yang kamu pasang dari nodejs.org.
- npm: pengelola paket yang ikut terpasang bersama Node.js. Ini yang memasang Rann Code.
- Rann Code: aplikasi yang menyediakan perintah `rann`.

Setelah terpasang, semua interaksi dimulai dari perintah `rann`. Data aplikasi disimpan di folder `~/.rann` di macOS dan Linux, atau `%USERPROFILE%\.rann` di Windows.

## 2. Pasang Node.js 22 LTS

Versi minimum adalah Node.js 22.11. Pakai Node.js 22 LTS yang lebih baru kalau tersedia. Jangan lanjut sebelum `node -v` menampilkan 22.11 atau lebih baru.

### Windows 10 dan 11

1. Buka https://nodejs.org.
2. Unduh installer LTS untuk Windows.
3. Jalankan file `.msi`.
4. Klik Next sampai selesai. Biarkan opsi Add to PATH tercentang.
5. Tutup semua jendela PowerShell yang lama.
6. Buka PowerShell baru dari Start Menu.
7. Jalankan:

```powershell
node -v
npm -v
```

Contoh hasil yang benar:

```text
v22.23.3
10.9.4
```

Nomor npm tidak harus sama dengan contoh. Yang penting nomor Node.js minimal 22.11.

Kalau `node` atau `npm` tidak dikenali, tutup PowerShell, buka lagi, lalu ulangi. Kalau masih gagal, pasang ulang Node.js dan pastikan Add to PATH dicentang.

### macOS

Cara paling mudah adalah installer dari https://nodejs.org. Unduh paket LTS untuk macOS, jalankan installer, lalu buka Terminal dan cek:

```bash
node -v
npm -v
```

Kalau kamu memakai Homebrew, ini alternatifnya:

```bash
brew install node@22
brew link --overwrite node@22
node -v
```

Kalau `brew` tidak dikenal, lewati cara ini dan pakai installer dari nodejs.org.

### Linux Ubuntu atau Debian

Buka Terminal, lalu jalankan:

```bash
sudo apt-get update
sudo apt-get install -y curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

Untuk distro lain, pasang Node.js 22 dari repository resmi distro atau dari nodejs.org. Syaratnya tetap sama: versi 22.11 atau lebih baru.

## 3. Pasang Rann Code

Ada dua installer: `install.sh` untuk macOS dan Linux, `install.ps1` untuk Windows. Keduanya mengunduh arsip rilis dari GitHub Releases lalu memasangnya secara global, sehingga perintah `rann` bisa dipakai dari folder mana pun. Registry npm tidak dipakai.

Installer tidak memakai sudo otomatis. Kalau npm tidak punya izin menulis ke folder global, installer berhenti dan menunjukkan cara memakai folder npm milik pengguna.

### macOS dan Linux

Jalankan satu perintah ini:

```bash
curl -fsSL https://raw.githubusercontent.com/RannD101/rann-code/main/install.sh | sh
```

Kalau kamu sudah mengunduh `install.sh` ke komputer, jalankan dari folder file itu berada:

```bash
sh install.sh
```

Installer menerima `RANN_VERSION` kalau kamu perlu memasang versi tertentu. Isi dengan nomor versi yang sudah tersedia di GitHub Releases, misalnya saat ingin kembali ke versi sebelumnya. Bentuk perintahnya `RANN_VERSION=x.y.z sh install.sh`.

Setelah selesai, cek:

```bash
rann --version
```

Kalau muncul baris `rann-code` diikuti nomor versi, instalasi berhasil.

Kalau `rann` belum dikenali, tutup terminal, buka lagi, lalu cek ulang. Kalau masih gagal, lihat bagian Troubleshooting.

### Windows 10 dan 11

Buka PowerShell baru, lalu jalankan:

```powershell
irm https://raw.githubusercontent.com/RannD101/rann-code/main/install.ps1 | iex
```

Untuk memasang versi tertentu:

```powershell
$env:RANN_VERSION = "1.1.0"
irm https://raw.githubusercontent.com/RannD101/rann-code/main/install.ps1 | iex
```

Kalau `rann` belum dikenali, tutup PowerShell, buka lagi, lalu coba `rann --version`. Folder global npm di Windows biasanya `%APPDATA%\npm`.

Kalau muncul error izin, jangan memakai sudo. Cek folder global npm dengan `npm config get prefix`. Di Windows folder itu biasanya berada di profil pengguna dan tidak membutuhkan Administrator.

## 4. Pertama kali menjalankan

Buat folder latihan supaya kamu tidak mengubah file penting. Rann Code akan memakai folder tempat perintah dijalankan sebagai workspace.

### Windows PowerShell

```powershell
cd $env:USERPROFILE
New-Item -ItemType Directory -Path rann-projek -Force | Out-Null
cd rann-projek
rann doctor
rann new --title "Coba pertama"
rann "jelaskan isi folder ini"
```

### macOS dan Linux

```bash
mkdir -p ~/rann-projek
cd ~/rann-projek
rann doctor
rann new --title "Coba pertama"
rann "jelaskan isi folder ini"
```

`rann doctor` memeriksa Node.js, folder data, daemon, database, dan config. `rann new` membuat sesi baru. `rann "..."` mengirim satu tugas ke sesi terbaru.

Pada percobaan pertama, provider default adalah `mock`. Provider ini tidak memanggil jaringan dan tidak membutuhkan API key. Balasannya memang tiruan, jadi cocok untuk memastikan instalasi, sesi, dan izin bekerja.

Kalau `rann doctor` melaporkan daemon belum berjalan, jalankan:

```bash
rann daemon start
```

Perintah itu menyalakan daemon di latar belakang, lalu keluar. Kamu tidak perlu membiarkan terminal terbuka.

## 5. Chat dasar

Buka chat interaktif:

```bash
rann chat
```

Di dalam chat, kamu bisa memakai perintah berikut:

| Perintah | Fungsi |
|---|---|
| `/help` | Daftar perintah chat |
| `/status` | Status sesi dan provider |
| `/sessions` | Daftar sesi |
| `/new` | Sesi baru |
| `/model` | Model yang dipakai |
| `/permission` | Mode izin saat ini |
| `/usage` | Token dan biaya |
| `/exit` | Keluar dari chat |

Untuk keluar, ketik `/exit` lalu Enter.

Kalau kamu hanya ingin satu jawaban tanpa masuk chat, jalankan:

```bash
rann "ringkas isi README di folder ini"
```

Untuk melihat sesi yang pernah dibuat:

```bash
rann sessions --limit 10
```

Untuk melanjutkan sesi tertentu:

```bash
rann resume ses_01j9x2k3m4n5p6q7r8s9t0v1w2 "lanjutkan dari langkah tadi"
```

Ganti `ses_01j9x2k3m4n5p6q7r8s9t0v1w2` dengan id yang muncul di `rann sessions`.

## 6. Pasang provider model

Provider `mock` cukup untuk latihan. Untuk jawaban model sungguhan, kamu perlu provider yang kompatibel dengan API OpenAI dan API key dari provider tersebut.

Contoh untuk OpenAI:

```bash
rann provider add openai --type openai-compatible --base-url https://api.openai.com/v1 --key-env OPENAI_API_KEY --model gpt-4o-mini
```

Perintah itu menyimpan nama variabel `OPENAI_API_KEY`, bukan nilai key. Nilai key dibaca dari environment saat daemon berjalan.

### Isi key di Windows PowerShell

Untuk sesi PowerShell saat ini:

```powershell
$env:OPENAI_API_KEY = "sk-...kamu"
```

Kalau ingin key tetap ada setelah PowerShell ditutup:

```powershell
setx OPENAI_API_KEY "sk-...kamu"
```

Tutup PowerShell, buka lagi, lalu cek:

```powershell
$env:OPENAI_API_KEY
```

### Isi key di macOS dan Linux

Untuk terminal saat ini:

```bash
export OPENAI_API_KEY="sk-...kamu"
```

Kalau memakai zsh, tambahkan ke `~/.zshrc`. Kalau memakai bash, tambahkan ke `~/.bashrc`:

```bash
echo 'export OPENAI_API_KEY="sk-...kamu"' >> ~/.zshrc
```

Tutup terminal, buka lagi, lalu cek:

```bash
echo "$OPENAI_API_KEY"
```

Ganti `sk-...kamu` dengan key asli sebelum menjalankan perintah. Jangan menulis key asli di tutorial, chat, atau file yang dibagikan.

### Simpan key di vault

Kalau tidak ingin mengandalkan environment setiap kali membuka terminal, simpan key ke vault terenkripsi Rann Code:

```bash
rann provider login openai --env OPENAI_API_KEY
```

Perintah ini membaca nilai dari environment, lalu menyimpannya di vault. Setelah itu, key tidak perlu ada di environment saat daemon start.

### Aktifkan provider dan uji

```bash
rann config set provider openai
rann provider test openai
```

Hasil yang benar kurang lebih:

```text
OK  openai  gpt-4o-mini  812 ms
balasan: ...
```

Kalau `provider test` gagal, cek kembali key, base URL, dan nama model. Untuk OpenAI, base URL harus `https://api.openai.com/v1`.

### Provider lain

OpenRouter memakai endpoint dan model yang berbeda:

```bash
rann provider add openrouter --type openai-compatible --base-url https://openrouter.ai/api/v1 --key-env OPENROUTER_API_KEY --model openai/gpt-4o-mini
```

Isi key OpenRouter dengan format `sk-or-...kamu`:

```bash
export OPENROUTER_API_KEY="sk-or-...kamu"
rann provider login openrouter --env OPENROUTER_API_KEY
rann config set provider openrouter
rann provider test openrouter
```

Endpoint lokal seperti Ollama, vLLM, atau LM Studio juga bisa. Contoh:

```bash
export LOKAL_API_KEY="key-kamu"
rann provider add lokal --type openai-compatible --base-url http://127.0.0.1:11434/v1 --key-env LOKAL_API_KEY --model llama3.1
rann config set provider lokal
rann provider test lokal
```

Kalau endpoint lokal tidak memeriksa key, isi `LOKAL_API_KEY` dengan teks apa saja, misalnya `key-kamu`. Selalu pakai `--key-env`, jangan opsi key langsung.

### Hapus key provider

```bash
rann provider remove openai
```

Perintah ini menghapus key dari vault dan referensinya. Blok provider di config tetap ada, jadi kamu bisa memasang key baru dengan `rann provider login` tanpa menambah provider lagi.

## 7. Pilih mode izin

Rann Code punya lima mode izin:

| Mode | Arti |
|---|---|
| `read-only` | Hanya membaca. Tulis file dan shell ditolak. |
| `ask` | Setiap tool yang mengubah state meminta izin. Ini default. |
| `accept-edits` | Tulis dan edit file otomatis, shell tetap bertanya. |
| `trusted` | Semua tool diizinkan selama masih di dalam workspace. |
| `custom` | Mengikuti daftar allow dan deny di config. |

Contoh memakai mode tertentu untuk satu perintah:

```bash
rann --permission read-only "ringkas isi folder ini"
rann --permission accept-edits "perbaiki typo di README"
rann --permission trusted "jalankan tes dan perbaiki yang gagal"
```

Mengubah default:

```bash
rann config set permissions.mode ask
```

Saat meminta izin, CLI menampilkan tiga pilihan: setujui sekali, selalu untuk tool itu di sesi tersebut, atau tolak. `--yes` menyetujui semua permintaan pada satu perintah. Pakai `--yes` hanya untuk otomasi yang memang kamu percaya.

Perintah shell berbahaya seperti `rm -rf /`, `mkfs`, atau `shutdown` tetap ditolak walaupun mode `trusted`. Di pipe dan cron tanpa terminal, permintaan izin otomatis ditolak supaya proses tidak menggantung.

## 8. Susun rencana sebelum menjalankan

Mode plan hanya menyusun rencana. Tool tidak dijalankan dan file tidak diubah. Mode ini membutuhkan provider model sungguhan, bukan `mock`.

```bash
rann plan "tambahkan halaman pengaturan ke aplikasi ini"
```

Di dalam chat, kamu bisa memakai:

```text
/plan tambahkan halaman pengaturan ke aplikasi ini
```

Setelah rencana muncul, kamu bisa meminta agent menjalankannya dengan perintah terpisah. Ini berguna kalau tugasnya besar dan kamu ingin memeriksa arahnya dulu.

## 9. Jalankan tugas di latar belakang

Untuk tugas panjang, lepas turn ke latar belakang:

```bash
rann "bangun ulang indeks dokumen" --detach --permission trusted
```

Perintah itu langsung mencetak id turn, misalnya `turn_01j9x2k3m4n5p6q7r8s9t0v1w2`. Cek hasilnya dengan:

```bash
rann turn turn_01j9x2k3m4n5p6q7r8s9t0v1w2 --wait
```

Tanpa `--wait`, perintah hanya menampilkan status saat itu. Daemon tetap menjalankan turn setelah CLI keluar. Kalau daemon berhenti di tengah turn, turn itu bisa gagal, jadi cek statusnya dengan perintah yang sama setelah daemon hidup lagi.

Untuk melihat sesi dan turn yang ada:

```bash
rann sessions --limit 10
rann usage
```

Kalau ingin daemon hidup terus setelah logout atau reboot, gunakan file supervise yang tersedia di repository pada folder `deploy/`: https://github.com/RannD101/rann-code/tree/main/deploy. Ada contoh systemd untuk Linux, launchd untuk macOS, dan PowerShell service untuk Windows. File itu template, jadi baca komentar dan ganti path, nama user, serta folder data sebelum dipakai.

## 10. Gateway dan pairing perangkat

Gateway adalah dashboard web lokal untuk memantau sesi, mengirim chat, dan menyetujui tool dari browser. Gateway hanya mendengarkan di `127.0.0.1` secara default.

Nyalakan gateway:

```bash
rann gateway enable
```

Perintah itu menulis `gateway.enabled = true` ke config dan menjalankan gateway. Cek statusnya:

```bash
rann gateway status
```

Buat kode pairing:

```bash
rann gateway pair
```

Outputnya kurang lebih:

```text
Kode pairing : AB12CD34
Dashboard    : http://127.0.0.1:8787
Berlaku      : 10 menit
```

Buka alamat dashboard di browser, masukkan kode pairing dan nama perangkat, misalnya `laptop-kamu`. Kode hanya berlaku sekali dan kedaluwarsa setelah sekitar 10 menit.

Lihat perangkat yang terdaftar:

```bash
rann gateway devices
```

Cabut perangkat yang tidak dipakai:

```bash
rann gateway revoke dev_01j9x2k3m4n5p6q7r8s9t0v1w2
```

Ganti `dev_01j9x2k3m4n5p6q7r8s9t0v1w2` dengan id dari `rann gateway devices`.

Hentikan gateway tanpa mematikan daemon:

```bash
rann gateway stop
```

Matikan gateway secara permanen:

```bash
rann gateway disable
rann daemon stop
```

Jangan mengubah host gateway menjadi `0.0.0.0` tanpa TLS, reverse proxy, dan aturan firewall. Kode pairing adalah kunci sementara, jadi jangan membagikannya ke orang lain.

## 11. Hubungkan Telegram

Adapter Telegram membuat kamu bisa mengirim tugas dari aplikasi Telegram. Daemon harus berjalan dan variabel `TELEGRAM_BOT_TOKEN` harus terlihat oleh proses daemon.

### Buat bot

1. Buka Telegram, cari `@BotFather`.
2. Kirim `/newbot`.
3. Ikuti instruksi sampai mendapat token.
4. Simpan token itu, jangan dibagikan.

### Isi token di Windows PowerShell

```powershell
$env:TELEGRAM_BOT_TOKEN = "123456789:token-kamu"
```

Kalau ingin token tetap ada setelah PowerShell ditutup:

```powershell
setx TELEGRAM_BOT_TOKEN "123456789:token-kamu"
```

Tutup PowerShell, buka lagi, lalu jalankan `rann` dari jendela baru.

### Isi token di macOS dan Linux

```bash
export TELEGRAM_BOT_TOKEN="123456789:token-kamu"
```

Untuk permanen di zsh:

```bash
echo 'export TELEGRAM_BOT_TOKEN="123456789:token-kamu"' >> ~/.zshrc
```

Untuk bash, ganti `~/.zshrc` dengan `~/.bashrc`. Buka terminal baru setelah mengubah file profil.

### Cari chat id

Kirim satu pesan ke bot kamu di Telegram, lalu jalankan:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates"
```

Di Windows PowerShell:

```powershell
Invoke-RestMethod "https://api.telegram.org/bot$env:TELEGRAM_BOT_TOKEN/getUpdates"
```

Cari nilai `chat.id` di hasilnya. Untuk chat pribadi, angkanya positif. Untuk grup, angkanya negatif.

### Aktifkan adapter

```bash
rann config set messaging.telegram.enabled true
rann config set messaging.telegram.allowed_chats '["123456789"]'
rann daemon stop
rann messaging status
```

Ganti `123456789` dengan chat id kamu. Untuk beberapa chat, tulis sebagai array:

```bash
rann config set messaging.telegram.allowed_chats '["123456789","-987654321"]'
```

Status yang benar menampilkan `telegram aktif`. Kalau muncul `gagal start`, token belum terbaca oleh daemon atau token salah. Restart daemon setelah mengubah environment.

Di Telegram, kamu bisa memakai perintah berikut:

| Perintah | Fungsi |
|---|---|
| `/status` | Status sesi |
| `/cancel` | Batalkan turn yang berjalan |
| `/resume` | Lanjutkan sesi |
| `/model` | Ganti model |
| `/cost` | Lihat biaya |
| `/approve` | Setujui permintaan tool |
| `/deny` | Tolak permintaan tool |

Hanya chat id yang ada di `allowed_chats` yang dilayani. Pesan dari chat lain diabaikan.

Kalau memakai systemd atau launchd, tambahkan `TELEGRAM_BOT_TOKEN` ke environment service. Untuk systemd, cara aman adalah file env terpisah:

```ini
EnvironmentFile=/etc/rann/rann.env
```

Isi file itu dengan `TELEGRAM_BOT_TOKEN=...` dan batasi izin file ke pemilik service.

## 12. Upgrade

Hentikan daemon dulu supaya file database tidak terkunci:

```bash
rann daemon stop
```

Backup folder data:

```bash
cp -R ~/.rann ~/.rann-backup
```

Di Windows PowerShell:

```powershell
Copy-Item "$env:USERPROFILE\.rann" "$env:USERPROFILE\.rann-backup" -Recurse
```

Pasang versi terbaru. Di macOS dan Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/RannD101/rann-code/main/install.sh | sh
```

Di Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/RannD101/rann-code/main/install.ps1 | iex
```

Cek hasilnya:

```bash
rann --version
rann doctor
```

Data lama tetap dipakai. Skema database dimigrasikan saat daemon start. Kalau migrasi gagal, jangan menimpa database dengan versi lama tanpa backup.

## 13. Uninstall

Hentikan daemon dulu:

```bash
rann daemon stop
```

Kalau memakai service, hentikan dan hapus service lebih dulu. Untuk Windows, buka PowerShell sebagai Administrator:

```powershell
sc.exe stop RannCodeDaemon
Start-Sleep -Seconds 2
sc.exe delete RannCodeDaemon
```

Untuk Linux:

```bash
sudo systemctl disable --now rann
sudo rm /etc/systemd/system/rann.service
sudo systemctl daemon-reload
```

Kalau memakai unit `rann@namauser`, ganti `rann` pada perintah `systemctl` dengan `rann@namauser`. File yang dihapus namanya `rann@.service`, bukan `rann.service`.

Untuk macOS:

```bash
launchctl bootout gui/$(id -u)/com.rann.daemon
rm ~/Library/LaunchAgents/com.rann.daemon.plist
```

Hapus aplikasi. Di macOS dan Linux, kalau kamu masih menyimpan `install.sh`:

```bash
sh install.sh --uninstall
```

Kalau tidak menyimpan `install.sh`, hapus lewat npm:

```bash
npm uninstall -g rann-code
```

Di Windows PowerShell:

```powershell
npm uninstall -g rann-code
```

Data tidak dihapus otomatis. Kalau memang ingin menghapus semua sesi, memori, dan skill, jalankan perintah untuk sistem kamu.

Windows PowerShell:

```powershell
Remove-Item "$env:USERPROFILE\.rann" -Recurse -Force
```

macOS dan Linux:

```bash
rm -rf ~/.rann
```

Hati-hati, perintah itu tidak bisa dibatalkan. Kalau pernah mengatur `RANN_HOME`, hapus juga folder yang kamu tunjuk.

## 14. Troubleshooting

### `node` atau `npm` tidak dikenali

Node.js belum terpasang atau PATH belum terbaca. Pasang Node.js 22 LTS dari https://nodejs.org, tutup terminal, buka lagi, lalu cek `node -v`.

### `rann` tidak dikenali

Folder bin npm belum masuk PATH. Cek lokasinya:

```bash
npm config get prefix
```

Di Windows, folder bin biasanya `%APPDATA%\npm`. Di macOS dan Linux, biasanya `/usr/local/bin` atau `~/.npm-global/bin`. Tambahkan folder itu ke PATH, buka terminal baru, lalu coba `rann --version`.

### Error EACCES saat npm install

Jangan memakai sudo. Buat prefix npm milik pengguna:

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.profile
. ~/.profile
```

Lalu jalankan ulang installer:

```bash
curl -fsSL https://raw.githubusercontent.com/RannD101/rann-code/main/install.sh | sh
```

### Daemon tidak berjalan

Cek status dan log:

```bash
rann daemon status
rann doctor
```

Log tergantung cara daemon dijalankan. Lewat systemd, lihat `journalctl -u rann -n 100`. Lewat launchd, lihat `~/Library/Logs/rann/daemon.err.log`. Lewat service Windows, cek Event Viewer untuk error service, lalu jalankan `rannd` di PowerShell untuk melihat error aplikasi. Kalau dijalankan manual, error tampil di terminal.

Kalau daemon mati dan socket tertinggal di macOS atau Linux, pastikan tidak ada proses `rannd` yang masih hidup, lalu hapus socket lama:

```bash
rm ~/.rann/run/daemon.sock
rann daemon start
```

Di Windows, socket berupa named pipe dan hilang sendiri saat proses berhenti. Jangan menghapus socket saat daemon masih berjalan.

### `provider test` gagal

Periksa tiga hal: key benar, base URL benar, dan nama model tersedia di provider. Untuk provider yang memakai `--key-env`, pastikan variabel itu terbaca oleh daemon. Kalau memakai vault, ulangi:

```bash
rann provider login openai --env OPENAI_API_KEY
rann provider test openai
```

Error 401 biasanya berarti key salah atau kedaluwarsa. Error 404 biasanya berarti base URL atau nama model salah.

### Telegram `gagal start`

Pastikan `TELEGRAM_BOT_TOKEN` ada di environment proses yang menjalankan daemon. Setelah mengubah environment, jalankan:

```bash
rann daemon stop
rann messaging status
```

Pastikan juga chat id kamu ada di `allowed_chats`.

### Gateway tidak bisa dibuka

Pastikan gateway berjalan:

```bash
rann gateway status
```

Kalau port 8787 dipakai aplikasi lain, ganti port:

```bash
rann config set gateway.port 8788
rann gateway enable
```

Lalu buka `http://127.0.0.1:8788`.

### PowerShell menolak script

Kalau PowerShell menolak menjalankan script lokal, ubah kebijakan untuk pengguna sendiri:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Kalau yang gagal adalah `npm.ps1`, installer `install.ps1` sudah otomatis memakai `npm.cmd`. Sebagai alternatif manual, jalankan installer dengan versi yang sama:

```powershell
$env:RANN_VERSION = "1.1.0"
irm https://raw.githubusercontent.com/RannD101/rann-code/main/install.ps1 | iex
```

### Instalasi native gagal di Windows

Kalau npm gagal membangun `better-sqlite3`, pastikan memakai Node.js 22 LTS versi 64 bit dari nodejs.org. Kalau tetap gagal, pasang Visual Studio Build Tools dengan workload Desktop development with C++, lalu ulangi perintah `irm .../install.ps1 | iex` dari Bagian 3.

Langkah Windows di tutorial ini belum diuji di mesin Windows fisik. Kalau kamu menemukan pesan error yang berbeda, simpan teks error lengkapnya dan laporkan lewat issue repository.

## 15. Privasi

Prompt hanya dikirim ke provider model yang kamu pilih

## 16. Bantuan

Repository dan issue: https://github.com/RannD101/rann-code

Installer: https://github.com/RannD101/rann-code/blob/main/install.sh

Tutorial ini: https://github.com/RannD101/rann-code/blob/main/docs/tutorial-v1.1.0.md
