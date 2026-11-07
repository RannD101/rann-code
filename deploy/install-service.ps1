<#
.SYNOPSIS
  Memasang, memeriksa, atau menghapus service Windows untuk daemon Rann Code.

.DESCRIPTION
  Script ini memakai New-Service dengan binPath yang dikutip benar:
    "C:\Program Files\nodejs\node.exe" "C:\Users\...\npm\node_modules\rann-code\dist\daemon-main.js"

  Service berjalan sebagai LocalSystem dan memakai RANN_HOME dari DataDir.
  Jalankan PowerShell sebagai Administrator untuk install dan uninstall.

.EXAMPLE
  .\deploy\install-service.ps1 -Action install

.EXAMPLE
  .\deploy\install-service.ps1 -Action status

.EXAMPLE
  .\deploy\install-service.ps1 -Action uninstall
#>

[CmdletBinding()]
param(
  [ValidateSet("install", "uninstall", "status")]
  [string]$Action = "install",

  [string]$ServiceName = "RannCodeDaemon",

  [string]$DataDir = (Join-Path $env:ProgramData "Rann"),

  [string]$NodePath = "",

  [switch]$RemoveData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-NpmCommand {
  $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($null -ne $npmCmd) { return $npmCmd.Source }
  $npmAny = Get-Command npm -ErrorAction SilentlyContinue
  if ($null -ne $npmAny) { return $npmAny.Source }
  throw "npm tidak ditemukan. Pasang Node.js 22 LTS minimal 22.11 dari https://nodejs.org lalu buka PowerShell baru."
}

function Get-NodePath {
  if (-not [string]::IsNullOrWhiteSpace($NodePath)) {
    if (-not (Test-Path -LiteralPath $NodePath)) {
      throw "NodePath tidak ditemukan: $NodePath"
    }
    return $NodePath
  }
  $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -eq $nodeCmd) {
    throw "node.exe tidak ditemukan di PATH. Pasang Node.js 22 LTS minimal 22.11 dari https://nodejs.org lalu buka PowerShell baru."
  }
  return $nodeCmd.Source
}

function Get-DaemonScript {
  $npm = Get-NpmCommand
  $npmRoot = (& $npm root -g).Trim()
  if ([string]::IsNullOrWhiteSpace($npmRoot)) {
    throw "Tidak bisa membaca npm root -g."
  }
  $daemonJs = Join-Path $npmRoot "rann-code\dist\daemon-main.js"
  if (-not (Test-Path -LiteralPath $daemonJs)) {
    throw "Paket rann-code belum terpasang. Jalankan: npm install -g rann-code@latest"
  }
  return $daemonJs
}

if ($Action -eq "status") {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($null -eq $svc) {
    Write-Host "Service $ServiceName belum terpasang."
    exit 1
  }
  $svc | Format-List Name, DisplayName, Status, StartType
  & sc.exe qc $ServiceName
  exit 0
}

if ($Action -eq "uninstall") {
  if (-not (Test-IsAdmin)) {
    throw "Buka PowerShell sebagai Administrator lalu jalankan ulang script ini."
  }
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($null -ne $svc) {
    if ($svc.Status -ne "Stopped") {
      Stop-Service -Name $ServiceName -Force
    }
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "Service $ServiceName dihapus."
  } else {
    Write-Host "Service $ServiceName tidak ditemukan."
  }
  if ($RemoveData) {
    if (Test-Path -LiteralPath $DataDir) {
      Remove-Item -LiteralPath $DataDir -Recurse -Force
      Write-Host "Folder data dihapus: $DataDir"
    }
  } else {
    Write-Host "Data tidak dihapus. Folder data: $DataDir"
    Write-Host "Pakai -RemoveData kalau memang ingin menghapus sesi, memori, dan skill."
  }
  exit 0
}

if (-not (Test-IsAdmin)) {
  throw "Buka PowerShell sebagai Administrator lalu jalankan ulang script ini."
}

$nodeExe = Get-NodePath
$daemonJs = Get-DaemonScript
$binPath = '"' + $nodeExe + '" "' + $daemonJs + '"'

if (-not (Test-Path -LiteralPath $DataDir)) {
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $existing) {
  if ($existing.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force
  }
  & sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

New-Service `
  -Name $ServiceName `
  -BinaryPathName $binPath `
  -DisplayName "Rann Code Daemon" `
  -StartupType Automatic | Out-Null
& sc.exe description $ServiceName "Menjalankan daemon Rann Code untuk CLI, gateway, dan messaging." | Out-Null

# Service membaca environment block dari key registry miliknya sendiri.
$serviceKey = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
New-ItemProperty `
  -Path $serviceKey `
  -Name "Environment" `
  -PropertyType MultiString `
  -Value @("RANN_HOME=$DataDir", "NODE_ENV=production") `
  -Force | Out-Null

Start-Service -Name $ServiceName
Start-Sleep -Seconds 2

$svc = Get-Service -Name $ServiceName
if ($svc.Status -ne "Running") {
  throw "Service $ServiceName tidak berjalan. Cek Event Viewer, bagian Windows Logs, System."
}

Write-Host "Service $ServiceName berjalan."
Write-Host "Data daemon: $DataDir"
Write-Host "BinPath terpasang:"
& sc.exe qc $ServiceName
