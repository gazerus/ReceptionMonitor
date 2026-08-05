# Pulls the latest changes, rebuilds the reception app, and deploys it
# straight to a connected Android tablet -- no Android Studio UI needed.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File .\scripts\rebuild-reception.ps1
# or, from inside the repo:
#   .\scripts\rebuild-reception.ps1
#
# Requires: the tablet connected via USB with Developer Options + USB
# debugging enabled, and adb able to see it (same requirement as running
# from Android Studio).

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Set-Location $repoRoot
Write-Host "==> git pull" -ForegroundColor Cyan
git pull

Write-Host "==> npm install" -ForegroundColor Cyan
npm install

Write-Host "==> Building shared config package" -ForegroundColor Cyan
npm run build:shared

Write-Host "==> Building reception app" -ForegroundColor Cyan
npm run build -w packages/reception

Set-Location (Join-Path $repoRoot "packages\reception")
Write-Host "==> Deploying to connected Android device" -ForegroundColor Cyan
npx cap run android

Write-Host ""
Write-Host "Done. If 'cap run android' couldn't find a device or failed to" -ForegroundColor Yellow
Write-Host "build, run 'npx cap sync android' and press Run in Android Studio" -ForegroundColor Yellow
Write-Host "instead -- everything up to that point still applies." -ForegroundColor Yellow
