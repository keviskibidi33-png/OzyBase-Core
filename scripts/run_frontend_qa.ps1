param(
  [string]$ApiPort = "8090",
  [string]$UiPort = "5342",
  [string]$EmbeddedPort = "5543",
  [string[]]$Specs = @(
    "tests/smoke-critical.spec.js",
    "tests/essential-keys-mcp.spec.js",
    "tests/auth-scroll-audit.spec.js",
    "tests/production-qa-smoke.spec.js",
    "tests/data-grid-massive.spec.js"
  ),
  [int]$PlaywrightGlobalTimeoutMs = 420000
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Stop-ProcessSafe {
  param([System.Diagnostics.Process]$Process)
  if ($null -ne $Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
  }
}

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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontendDir = Join-Path $repoRoot "frontend"
$normalizedSpecs = @($Specs | ForEach-Object {
  $spec = $_
  if ($spec -match '^[Ff]rontend[\\/](.+)$') {
    $spec = $Matches[1]
  }
  return ($spec -replace '\\', '/')
})
$runId = Get-Date -Format "yyyyMMddHHmmss"
$embeddedRootName = "ozybase-qa-embedded"
$embeddedRoot = Join-Path $env:TEMP $embeddedRootName
$embeddedDataPath = Join-Path $embeddedRoot "pg_data_$runId"
$embeddedBinPath = Join-Path $embeddedRoot "bin"
$apiLog = Join-Path $env:TEMP "ozybase-qa-api-$runId.out.log"
$apiErrLog = Join-Path $env:TEMP "ozybase-qa-api-$runId.err.log"
$uiLog = Join-Path $env:TEMP "ozybase-qa-ui-$runId.out.log"
$uiErrLog = Join-Path $env:TEMP "ozybase-qa-ui-$runId.err.log"
$apiBinary = Join-Path $env:TEMP "ozybase-qa-$runId.exe"
$apiProc = $null
$uiProc = $null

try {
  Stop-PortListeners -Ports @([int]$ApiPort, [int]$UiPort, [int]$EmbeddedPort)
  Stop-EmbeddedPostgres -EmbeddedRoot $embeddedRootName
  New-Item -ItemType Directory -Force -Path $embeddedBinPath | Out-Null

  Write-Step "Build backend"
  go build -o $apiBinary ./cmd/ozybase

  Write-Step "Start API"
  $env:PORT = $ApiPort
  $env:SITE_URL = "http://127.0.0.1:$ApiPort"
  $env:APP_DOMAIN = "localhost"
  $env:ALLOWED_ORIGINS = "http://127.0.0.1:$UiPort,http://localhost:$UiPort"
  $env:OZY_EMBEDDED_ROOT = $embeddedRoot
  $env:OZY_EMBEDDED_DATA_PATH = $embeddedDataPath
  $env:OZY_EMBEDDED_BIN_PATH = $embeddedBinPath
  $env:OZY_EMBEDDED_PORT = $EmbeddedPort
  $env:OZY_AUTO_BOOTSTRAP_ADMIN = "true"
  $env:INITIAL_ADMIN_EMAIL = "admin@ozybase.local"
  $env:INITIAL_ADMIN_PASSWORD = "OzyBase123!"
  $env:E2E_ADMIN_EMAIL = "admin@ozybase.local"
  $env:E2E_ADMIN_PASSWORD = "OzyBase123!"
  $env:CI = "1"
  $env:DEBUG = "false"
  $env:OZY_SKIP_DOTENV = "true"

  $apiProc = Start-Process -FilePath $apiBinary -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog
  Wait-HttpHealthy -Url "http://127.0.0.1:$ApiPort/api/health" -Process $apiProc

  Write-Step "Start frontend"
  $uiProc = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", $UiPort, "--strictPort") -WorkingDirectory $frontendDir -PassThru -RedirectStandardOutput $uiLog -RedirectStandardError $uiErrLog
  Wait-HttpHealthy -Url "http://127.0.0.1:$UiPort" -Process $uiProc

  Write-Step "Run Playwright QA"
  $args = @("run", "test", "--") + $normalizedSpecs + @("--project=chromium", "--workers=1", "--reporter=list", "--global-timeout=$PlaywrightGlobalTimeoutMs")
  Push-Location $frontendDir
  try {
    & npm.cmd @args
  } finally {
    Pop-Location
  }
}
finally {
  Stop-ProcessSafe -Process $uiProc
  Stop-ProcessSafe -Process $apiProc
  Stop-EmbeddedPostgres -EmbeddedRoot $embeddedRootName
  Stop-PortListeners -Ports @([int]$ApiPort, [int]$UiPort, [int]$EmbeddedPort)
  if (Test-Path $embeddedDataPath) {
    Remove-Item -Recurse -Force $embeddedDataPath
  }
  if (Test-Path $apiBinary) {
    Remove-Item -Force $apiBinary
  }
  Write-Host ""
  Write-Host "API log: $apiLog"
  Write-Host "API err: $apiErrLog"
  Write-Host "UI log: $uiLog"
  Write-Host "UI err: $uiErrLog"
}
