# OzyBase Build Script
# This script builds the OzyBase binary for multiple platforms.

$VERSION = "1.1.0"
$DIST_DIR = "./dist"

# Ensure dist directory exists
if (!(Test-Path $DIST_DIR)) {
    New-Item -ItemType Directory -Path $DIST_DIR
}

# --- Step 1: Build Frontend ---
Write-Host "🎨 Building Frontend..." -ForegroundColor Cyan
Push-Location frontend
npm install
npm run build
Pop-Location

# Ensure internal/api/frontend_dist exists and is clean
Write-Host "📦 Preparing Embedded Files..." -ForegroundColor Cyan
if (Test-Path "./internal/api/frontend_dist") {
    Remove-Item -Recurse -Force "./internal/api/frontend_dist/*"
} else {
    New-Item -ItemType Directory -Path "./internal/api/frontend_dist"
}
Copy-Item -Path "./frontend/dist/*" -Destination "./internal/api/frontend_dist" -Recurse

# --- Step 2: Build Binaries ---
function Build-Ozy($os, $arch, $suffix) {
    $output = "$DIST_DIR/ozybase-$VERSION-$os-$arch$suffix"
    Write-Host "🚀 Building for $os/$arch..." -ForegroundColor Green
    $env:GOOS = $os
    $env:GOARCH = $arch
    go build -ldflags="-s -w" -o $output ./cmd/ozybase
}

# Windows x64
Build-Ozy "windows" "amd64" ".exe"

# Linux x64
Build-Ozy "linux" "amd64" ""

# Linux ARM64 (Requested)
Build-Ozy "linux" "arm64" ""

Write-Host "✨ Build process completed. Binaries are in $DIST_DIR" -ForegroundColor Cyan
