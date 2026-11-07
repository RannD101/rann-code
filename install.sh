#!/bin/sh
# Rann Code installer untuk macOS dan Linux.
#
# Pakai:
#   sh install.sh
#   RANN_VERSION=0.1.1 sh install.sh
#   sh install.sh --uninstall
#
# Script ini tidak memakai sudo otomatis. Kalau npm menolak menulis ke folder
# global, script berhenti dan menampilkan pilihan prefix milik pengguna.

set -eu

# Rilis diunduh dari GitHub Releases, bukan dari registry npm.
PACKAGE_NAME="rann-code"
REPO="RannD101/rann-code"
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=11
TUTORIAL_URL="https://github.com/RannD101/rann-code/blob/main/docs/tutorial-v1.0.0.md"

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Pasang Rann Code dari GitHub Releases.

Pemakaian:
  sh install.sh                 pasang versi latest
  RANN_VERSION=0.1.1 sh install.sh   pasang versi tertentu
  sh install.sh --uninstall     hapus aplikasi, data tetap disimpan

Syarat: Node.js 22.11 atau lebih baru dan npm.
Script ini tidak menjalankan sudo.
EOF
}

ACTION="install"
for arg in "$@"; do
  case "$arg" in
    --uninstall)
      ACTION="uninstall"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Argumen tidak dikenal: $arg. Pakai --help untuk melihat pilihan."
      ;;
  esac
done

command -v node >/dev/null 2>&1 || fail "Node.js belum terpasang. Pasang Node.js 22 LTS minimal 22.11 dari https://nodejs.org lalu buka terminal baru."
command -v npm >/dev/null 2>&1 || fail "npm tidak ditemukan. Pasang Node.js 22 LTS dari https://nodejs.org lalu buka terminal baru."

if [ "$ACTION" = "uninstall" ]; then
  say "Menghapus $PACKAGE_NAME dari instalasi global npm..."
  if ! npm uninstall -g "$PACKAGE_NAME"; then
    fail "npm uninstall gagal. Periksa pesan di atas, lalu jalankan ulang tanpa sudo."
  fi
  if command -v rann >/dev/null 2>&1; then
    say "Paket sudah dihapus, tetapi perintah rann masih terbaca di PATH."
    say "Buka terminal baru lalu cek: rann --version"
  else
    say "Selesai. Perintah rann sudah tidak tersedia di PATH."
  fi
  say ""
  say "Data pengguna tidak dihapus."
  say "Lokasi default: $HOME/.rann (atau folder yang ditunjuk RANN_HOME)."
  say "Hapus folder itu secara manual kalau sesi, memori, dan skill tidak diperlukan lagi."
  exit 0
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null)" || fail "Gagal membaca versi Node.js."
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REST="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REST%%.*}"

case "$NODE_MAJOR" in
  ''|*[!0-9]*) fail "Versi Node.js tidak dikenali: $NODE_VERSION" ;;
esac
case "$NODE_MINOR" in
  ''|*[!0-9]*) fail "Versi Node.js tidak dikenali: $NODE_VERSION" ;;
esac

if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ] || { [ "$NODE_MAJOR" -eq "$MIN_NODE_MAJOR" ] && [ "$NODE_MINOR" -lt "$MIN_NODE_MINOR" ]; }; then
  fail "Node.js $NODE_VERSION terlalu lama. Butuh Node.js 22.11 atau lebih baru. Pasang Node.js 22 LTS dari https://nodejs.org lalu buka terminal baru."
fi

VERSION="${RANN_VERSION:-latest}"
VERSION="${VERSION#v}"
if [ "$VERSION" = "latest" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)"
  [ -n "$VERSION" ] || fail "Tidak bisa membaca rilis terbaru dari GitHub. Set RANN_VERSION=x.y.z lalu ulangi."
fi
if ! printf '%s\n' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  fail "RANN_VERSION harus latest atau nomor versi x.y.z, misalnya 1.0.0."
fi

ARCHIVE_URL="https://github.com/$REPO/releases/download/v$VERSION/$PACKAGE_NAME-$VERSION.tgz"
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t rann-install)"
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM
say "Node.js $NODE_VERSION terdeteksi."
say "Mengunduh $PACKAGE_NAME $VERSION dari GitHub..."
if ! curl -fL --retry 3 -o "$TMP_DIR/$PACKAGE_NAME.tgz" "$ARCHIVE_URL"; then
  fail "Unduhan gagal: $ARCHIVE_URL. Periksa koneksi atau pastikan rilis v$VERSION tersedia."
fi
say "Memasang paket secara global lewat npm..."
say ""

if ! npm install -g "$TMP_DIR/$PACKAGE_NAME.tgz"; then
  say ""
  say "Instalasi npm gagal. Kalau pesannya EACCES, jangan pakai sudo."
  say "Buat prefix npm milik pengguna sendiri:"
  say ""
  say "  mkdir -p \"\$HOME/.npm-global\""
  say "  npm config set prefix \"\$HOME/.npm-global\""
  say "  echo 'export PATH=\"\$HOME/.npm-global/bin:\$PATH\"' >> \"\$HOME/.profile\""
  say "  . \"\$HOME/.profile\""
  say ""
  say "Lalu jalankan ulang: sh install.sh"
  exit 1
fi

say ""
if ! command -v rann >/dev/null 2>&1; then
  NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
  say "Paket terpasang, tetapi perintah rann belum ada di PATH."
  say "Folder bin npm: ${NPM_PREFIX}/bin"
  say "Tambahkan folder itu ke PATH, buka terminal baru, lalu jalankan:"
  say ""
  say "  rann --version"
  exit 1
fi

if ! RANN_OUTPUT="$(rann --version 2>&1)"; then
  fail "rann --version gagal: $RANN_OUTPUT"
fi

say "Terpasang: $RANN_OUTPUT"
say ""
say "Langkah berikutnya:"
say "  1. rann doctor"
say "  2. cd ke folder proyek kamu"
say "  3. rann new --title \"Coba pertama\""
say "  4. rann \"jelaskan isi folder ini\""
say ""
say "Tutorial lengkap: $TUTORIAL_URL"
