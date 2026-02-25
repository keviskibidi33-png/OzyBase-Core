param(
  [switch]$SkipE2E,
  [string]$ApiPort = "8090",
  [string]$UiPort = "5342",
  [string]$EmbeddedPort = "5543",
  [int]$PlaywrightGlobalTimeoutMs = 300000,
  [int]$GoTestTimeoutSeconds = 900,
  [int]$GoBuildTimeoutSeconds = 600,
  [int]$FrontendLintTimeoutSeconds = 300,
  [int]$FrontendTypecheckTimeoutSeconds = 300,
  [int]$FrontendBuildTimeoutSeconds = 1200,
  [int]$FrontendBundleTimeoutSeconds = 300,
  [int]$SmokeApiTimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Get-LogTail {
  param(
    [string]$Path,
    [int]$Lines = 80
  )
  if (Test-Path $Path) {
    Get-Content -Path $Path -Tail $Lines
  }
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Wait-HttpHealthy {
  param(
    [string]$Url,
    [System.Diagnostics.Process]$Process,
    [int]$Attempts = 120,
    [int]$DelaySeconds = 1
  )
  for ($i = 0; $i -lt $Attempts; $i++) {
    if ($null -ne $Process -and $Process.HasExited) {
      throw "Process exited before becoming healthy: $Url"
    }
    Start-Sleep -Seconds $DelaySeconds
    $ok = $false
    try {
      & curl.exe -fsS $Url *> $null
      $ok = ($LASTEXITCODE -eq 0)
    } catch {
      $ok = $false
    }
    if ($ok) {
      return
    }
  }
  throw "Timeout waiting for $Url"
}

function Stop-ProcessSafe {
  param([System.Diagnostics.Process]$Process)
  if ($null -ne $Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
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
      # best effort
    }
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
        # best effort
      }
    }
  }
}

function Invoke-CommandWithTimeout {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory,
    [int]$TimeoutSeconds = 600
  )

  function Quote-CmdArg {
    param([string]$Value)
    if ($null -eq $Value -or $Value -eq "") {
      return '""'
    }
    if ($Value -match '[\s"&|<>()^]') {
      return '"' + ($Value -replace '"', '""') + '"'
    }
    return $Value
  }

  $safeName = ($Name -replace '[^A-Za-z0-9_-]', '_')
  $stdoutLog = Join-Path $env:TEMP "ozybase-$safeName-$runId.stdout.log"
  $stderrLog = Join-Path $env:TEMP "ozybase-$safeName-$runId.stderr.log"

  $quotedFile = Quote-CmdArg -Value $FilePath
  $joinedArgs = ""
  if ($null -ne $Arguments -and $Arguments.Count -gt 0) {
    $joinedArgs = ($Arguments | ForEach-Object { Quote-CmdArg -Value $_ }) -join " "
  }
  $redirectOut = Quote-CmdArg -Value $stdoutLog
  $redirectErr = Quote-CmdArg -Value $stderrLog
  $fullCommand = "$quotedFile $joinedArgs 1> $redirectOut 2> $redirectErr"

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = "/d /s /c `"$fullCommand`""
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $null = $proc.Start()
  $completed = $proc.WaitForExit($TimeoutSeconds * 1000)
  if (-not $completed) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Write-Warning "$Name timed out after ${TimeoutSeconds}s"
    Write-Host "--- $Name stdout (tail) ---"
    Get-LogTail -Path $stdoutLog
    Write-Host "--- $Name stderr (tail) ---"
    Get-LogTail -Path $stderrLog
    throw "$Name timed out"
  }

  if ($proc.ExitCode -ne 0) {
    Write-Warning "$Name failed with exit code $($proc.ExitCode)"
    Write-Host "--- $Name stdout (tail) ---"
    Get-LogTail -Path $stdoutLog
    Write-Host "--- $Name stderr (tail) ---"
    Get-LogTail -Path $stderrLog
    throw "$Name failed"
  }
}

Require-Command go
Require-Command curl.exe

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontendDir = Join-Path $repoRoot "frontend"
$e2eSmokeSpec = Join-Path $frontendDir "tests/smoke-critical.spec.js"
$bashPath = "C:/Program Files/Git/bin/bash.exe"
$npmCmd = "npm"
if (Test-Path "D:/Dependencias/nodejs/npm.cmd") {
  $npmCmd = "D:/Dependencias/nodejs/npm.cmd"
}
if (-not (Test-Path $bashPath)) {
  throw "Git Bash not found at $bashPath"
}

$runId = Get-Date -Format "yyyyMMddHHmmss"
$embeddedRootName = "ozybase-validation-embedded"
$embeddedRoot = Join-Path $env:TEMP $embeddedRootName
$embeddedDataPath = Join-Path $embeddedRoot "pg_data_$runId"
$embeddedBinPath = Join-Path $embeddedRoot "bin"

$apiLog = Join-Path $env:TEMP "ozybase-api-$runId.out.log"
$apiErrLog = Join-Path $env:TEMP "ozybase-api-$runId.err.log"
$uiLog = Join-Path $env:TEMP "ozybase-ui-$runId.out.log"
$uiErrLog = Join-Path $env:TEMP "ozybase-ui-$runId.err.log"

$apiProc = $null
$uiProc = $null
$apiBinary = Join-Path $env:TEMP "ozybase-validation-$runId.exe"
$migrationsDir = Join-Path $repoRoot "migrations"
$existingMigrationMap = @{}
$newSmokeMigrations = @()

try {
  Stop-PortListeners -Ports @([int]$ApiPort, [int]$UiPort, [int]$EmbeddedPort)
  Stop-EmbeddedPostgres -EmbeddedRoot $embeddedRootName
  New-Item -ItemType Directory -Path $embeddedRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $embeddedBinPath -Force | Out-Null
  if (Test-Path $migrationsDir) {
    Get-ChildItem -Path $migrationsDir -File | ForEach-Object {
      $existingMigrationMap[$_.FullName] = $true
    }
  }

  Write-Step "Backend tests"
  Invoke-CommandWithTimeout -Name "backend_go_test" -FilePath "go" -Arguments @("test", "-timeout=12m", "./...") -WorkingDirectory $repoRoot -TimeoutSeconds $GoTestTimeoutSeconds
  Invoke-CommandWithTimeout -Name "backend_go_build" -FilePath "go" -Arguments @("build", "-o", $apiBinary, "./cmd/ozybase") -WorkingDirectory $repoRoot -TimeoutSeconds $GoBuildTimeoutSeconds

  Write-Step "Frontend lint/typecheck/build/bundle"
  Invoke-CommandWithTimeout -Name "frontend_lint" -FilePath $npmCmd -Arguments @("run", "lint") -WorkingDirectory $frontendDir -TimeoutSeconds $FrontendLintTimeoutSeconds
  Invoke-CommandWithTimeout -Name "frontend_typecheck" -FilePath $npmCmd -Arguments @("run", "typecheck") -WorkingDirectory $frontendDir -TimeoutSeconds $FrontendTypecheckTimeoutSeconds
  Invoke-CommandWithTimeout -Name "frontend_build" -FilePath $npmCmd -Arguments @("run", "build") -WorkingDirectory $frontendDir -TimeoutSeconds $FrontendBuildTimeoutSeconds
  Invoke-CommandWithTimeout -Name "frontend_bundle_check" -FilePath $npmCmd -Arguments @("run", "bundle:check") -WorkingDirectory $frontendDir -TimeoutSeconds $FrontendBundleTimeoutSeconds

  Write-Step "Start API (isolated embedded postgres)"
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
  $env:SMOKE_ADMIN_EMAIL = "admin@ozybase.local"
  $env:SMOKE_ADMIN_PASSWORD = "OzyBase123!"
  $env:E2E_ADMIN_EMAIL = "admin@ozybase.local"
  $env:E2E_ADMIN_PASSWORD = "OzyBase123!"
  $env:BASE_URL = "http://127.0.0.1:$ApiPort"
  $env:SMOKE_CURL_CONNECT_TIMEOUT = "3"
  $env:SMOKE_CURL_TIMEOUT = "15"
  $env:CI = "1"
  $env:DEBUG = "false"

  $apiProc = Start-Process -FilePath $apiBinary -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrLog
  Wait-HttpHealthy -Url "http://127.0.0.1:$ApiPort/api/health" -Process $apiProc
  $apiListener = Get-NetTCPConnection -LocalPort ([int]$ApiPort) -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $apiListener) {
    throw "API listener not found on port $ApiPort after health check"
  }
  if ($apiListener.OwningProcess -ne $apiProc.Id) {
    $resolved = Get-Process -Id $apiListener.OwningProcess -ErrorAction SilentlyContinue
    if ($null -ne $resolved) {
      $apiProc = $resolved
    }
  }
  Write-Host "API listener PID: $($apiListener.OwningProcess) | tracked PID: $($apiProc.Id)"

  Write-Step "Smoke API"
  Invoke-CommandWithTimeout -Name "smoke_api" -FilePath $bashPath -Arguments @("$repoRoot/scripts/smoke_api.sh") -WorkingDirectory $repoRoot -TimeoutSeconds $SmokeApiTimeoutSeconds
  if (Test-Path $migrationsDir) {
    $newSmokeMigrations = Get-ChildItem -Path $migrationsDir -File -Filter "*ci_smoke*.sql" |
      Where-Object { -not $existingMigrationMap.ContainsKey($_.FullName) }
  }

  if (-not $SkipE2E) {
    if (-not (Test-Path $e2eSmokeSpec)) {
      Write-Warning "Skipping E2E smoke: spec not found at $e2eSmokeSpec"
    } else {
      Write-Step "Start frontend"
      $uiProc = Start-Process -FilePath $npmCmd -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", $UiPort, "--strictPort") -WorkingDirectory $frontendDir -PassThru -RedirectStandardOutput $uiLog -RedirectStandardError $uiErrLog
      Wait-HttpHealthy -Url "http://127.0.0.1:$UiPort" -Process $uiProc

      Write-Step "Smoke E2E"
      $playwrightTimeoutSeconds = [Math]::Ceiling($PlaywrightGlobalTimeoutMs / 1000) + 120
      Invoke-CommandWithTimeout -Name "playwright_smoke" -FilePath $npmCmd -Arguments @("run", "test", "--", "tests/smoke-critical.spec.js", "--project=chromium", "--workers=1", "--pass-with-no-tests", "--global-timeout=$PlaywrightGlobalTimeoutMs") -WorkingDirectory $frontendDir -TimeoutSeconds $playwrightTimeoutSeconds
    }
  }

  Write-Step "Validation completed"
  Write-Host "PASS: enterprise validation suite completed."
  Write-Host "API log (stdout): $apiLog"
  Write-Host "API log (stderr): $apiErrLog"
  if (-not $SkipE2E) {
    Write-Host "UI log (stdout): $uiLog"
    Write-Host "UI log (stderr): $uiErrLog"
  }
}
finally {
  foreach ($migration in $newSmokeMigrations) {
    if (Test-Path $migration.FullName) {
      Remove-Item -Force $migration.FullName
    }
  }
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
}
