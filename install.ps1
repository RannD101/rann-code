# Rann Code installer untuk Windows 10/11.
# Jalankan di PowerShell:
#   irm https://raw.githubusercontent.com/RannD101/rann-code/main/install.ps1 | iex
# Versi tertentu:
#   $env:RANN_VERSION = "1.0.0"; irm ... | iex

$ErrorActionPreference = "Stop"
$repo = "RannD101/rann-code"
$package = "rann-code"

function Fail([string]$message) {
  Write-Host "Error: $message" -ForegroundColor Red
  exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js belum terpasang. Pasang Node.js 22 LTS minimal 22.11 dari https://nodejs.org lalu buka PowerShell baru." }
if (-not $npm) { Fail "npm tidak ditemukan. Pasang ulang Node.js 22 LTS dan pastikan Add to PATH dicentang." }

$nodeVersion = (& node -p "process.versions.node").Trim()
$parts = $nodeVersion.Split(".")
if ([int]$parts[0] -lt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -lt 11)) {
  Fail "Node.js $nodeVersion terlalu lama. Butuh 22.11 atau lebih baru."
}

if ($env:RANN_VERSION) {
  $version = $env:RANN_VERSION.TrimStart("v")
} else {
  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "rann-installer" }
    $version = $release.tag_name.TrimStart("v")
  } catch {
    Fail "Tidak bisa membaca rilis terbaru dari GitHub. Set `$env:RANN_VERSION = 'x.y.z' lalu ulangi."
  }
}
if ($version -notmatch "^\d+\.\d+\.\d+$") { Fail "Versi tidak valid: $version" }

$url = "https://github.com/$repo/releases/download/v$version/$package-$version.tgz"
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("rann-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp | Out-Null
$archive = Join-Path $temp "$package.tgz"

try {
  Write-Host "Node.js $nodeVersion terdeteksi."
  Write-Host "Mengunduh $package $version dari GitHub..."
  Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  Write-Host "Memasang paket secara global lewat npm..."
  & $npmExe install -g $archive
  if ($LASTEXITCODE -ne 0) { Fail "npm install gagal dengan kode $LASTEXITCODE. Jangan pakai Administrator kecuali folder npm kamu memang butuh." }
  & rann --version
  if ($LASTEXITCODE -ne 0) { Fail "rann --version gagal. Tutup PowerShell, buka lagi, lalu cek rann --version." }
  Write-Host ""
  Write-Host "Langkah berikutnya:"
  Write-Host "  1. rann doctor"
  Write-Host "  2. cd ke folder proyek kamu"
  Write-Host '  3. rann new --title "Coba pertama"'
  Write-Host '  4. rann "jelaskan isi folder ini"'
  Write-Host ""
  Write-Host "Tutorial: https://github.com/$repo/blob/main/docs/tutorial-v1.0.0.md"
} finally {
  Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}
