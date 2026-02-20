param(
  [string]$Repo = "Xangel0s/OzyBase",
  [string]$BinDir = "$env:ProgramFiles\OzyBase",
  [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

if (-not [Environment]::Is64BitProcess) {
  throw "64-bit PowerShell is required."
}

$os = "windows"
$arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { throw "Unsupported architecture." }

if ($Version -eq "latest") {
  $releaseUrl = "https://api.github.com/repos/$Repo/releases/latest"
} else {
  $cleanVersion = $Version.TrimStart("v")
  $releaseUrl = "https://api.github.com/repos/$Repo/releases/tags/v$cleanVersion"
}

Write-Host "Fetching release metadata from $Repo..."
$release = Invoke-RestMethod -Uri $releaseUrl -Headers @{ "User-Agent" = "ozybase-installer" }
$tag = $release.tag_name.TrimStart("v")
if ([string]::IsNullOrWhiteSpace($tag)) {
  throw "Unable to resolve release tag."
}

$asset = "ozybase_${tag}_${os}_${arch}.zip"
$downloadUrl = "https://github.com/$Repo/releases/download/v$tag/$asset"

$tempDir = Join-Path $env:TEMP ("ozybase-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
  $zipPath = Join-Path $tempDir $asset
  Write-Host "Downloading $asset..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath

  Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

  if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir | Out-Null
  }

  $source = Join-Path $tempDir "ozybase.exe"
  $target = Join-Path $BinDir "ozybase.exe"
  Copy-Item -Path $source -Destination $target -Force

  Write-Host "Installed ozybase.exe to $target"
  & $target version
} finally {
  Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
