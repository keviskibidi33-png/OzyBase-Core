param(
  [string]$ApiPort = "8090",
  [string]$EmbeddedPort = "5544",
  [string]$Email = "admin@ozybase.local",
  [string]$Password = "OzyBase123!",
  [int]$Rows = 20000,
  [int]$Iterations = 12,
  [int]$Workers = 4
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Stop-PortListeners {
  param([int[]]$Ports)
  foreach ($port in $Ports) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      try {
        Stop-Process -Id $listener.OwningProcess -Force
      } catch {
      }
    }
  }
}

function Wait-HttpHealthy {
  param(
    [string]$Url,
    [System.Diagnostics.Process]$Process,
    [int]$Attempts = 180
  )
  for ($i = 0; $i -lt $Attempts; $i++) {
    if ($null -ne $Process -and $Process.HasExited) {
      throw "Process exited before becoming healthy: $Url"
    }
    Start-Sleep -Seconds 1
    try {
      $response = Invoke-WebRequest -UseBasicParsing $Url
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
    }
  }
  throw "Timeout waiting for $Url"
}

function Stop-EmbeddedPostgres {
  param([string]$EmbeddedRoot)
  $target = [regex]::Escape($EmbeddedRoot)
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -eq "postgres.exe" -and (
        ($_.ExecutablePath -and $_.ExecutablePath -match $target) -or
        ($_.CommandLine -and $_.CommandLine -match $target)
      )
    }
  foreach ($proc in $processes) {
    try {
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    } catch {
    }
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$apiBinary = Join-Path $repoRoot "ozybase.exe"
$runId = Get-Date -Format "yyyyMMddHHmmss"
$embeddedRootName = "ozybase-bench-embedded"
$embeddedRoot = Join-Path $env:TEMP $embeddedRootName
$embeddedDataPath = Join-Path $embeddedRoot "pg_data_$runId"
$embeddedBinPath = Join-Path $embeddedRoot "bin"
$apiLog = Join-Path $env:TEMP "ozybase-bench-api-$runId.out.log"
$apiErrLog = Join-Path $env:TEMP "ozybase-bench-api-$runId.err.log"
$apiProc = $null

try {
  Stop-PortListeners -Ports @([int]$ApiPort, [int]$EmbeddedPort)
  Stop-EmbeddedPostgres -EmbeddedRoot $embeddedRootName
  New-Item -ItemType Directory -Force -Path $embeddedBinPath | Out-Null

  $env:PORT = $ApiPort
  $env:SITE_URL = "http://127.0.0.1:$ApiPort"
  $env:APP_DOMAIN = "localhost"
  $env:ALLOWED_ORIGINS = "http://127.0.0.1:$ApiPort"
  $env:OZY_EMBEDDED_ROOT = $embeddedRoot
  $env:OZY_EMBEDDED_DATA_PATH = $embeddedDataPath
  $env:OZY_EMBEDDED_BIN_PATH = $embeddedBinPath
  $env:OZY_EMBEDDED_PORT = $EmbeddedPort
  $env:OZY_AUTO_BOOTSTRAP_ADMIN = "true"
  $env:INITIAL_ADMIN_EMAIL = $Email
  $env:INITIAL_ADMIN_PASSWORD = $Password
  $env:DEBUG = "false"
  $env:OZY_SKIP_DOTENV = "true"

  $apiProc = Start-Process -FilePath $apiBinary -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog
  Wait-HttpHealthy -Url "http://127.0.0.1:$ApiPort/api/health" -Process $apiProc

  go run ./cmd/ozybase-bench `
    -base-url "http://127.0.0.1:$ApiPort" `
    -email $Email `
    -password $Password `
    -rows $Rows `
    -iterations $Iterations `
    -workers $Workers
}
finally {
  if ($null -ne $apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force
  }
  Stop-EmbeddedPostgres -EmbeddedRoot $embeddedRootName
  Stop-PortListeners -Ports @([int]$ApiPort, [int]$EmbeddedPort)
  if (Test-Path $embeddedDataPath) {
    Remove-Item -Recurse -Force $embeddedDataPath
  }
  Write-Host ""
  Write-Host "API log: $apiLog"
  Write-Host "API err: $apiErrLog"
}
