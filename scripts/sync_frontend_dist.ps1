$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "frontend/dist"
$dst = Join-Path $root "internal/api/frontend_dist"

if (!(Test-Path $src)) {
  throw "frontend/dist does not exist. Run the frontend build first."
}

New-Item -ItemType Directory -Force -Path $dst | Out-Null
Get-ChildItem -Force $dst | Remove-Item -Recurse -Force
Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
Write-Host "Synced frontend assets into internal/api/frontend_dist" -ForegroundColor Green
