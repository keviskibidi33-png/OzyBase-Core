param(
  [string]$ApiPort = "8096",
  [string]$HttpsPort = "8443",
  [string]$MailhogSMTPPort = "1025",
  [string]$MailhogUIPort = "8025",
  [string]$AdminEmail = "admin@ozybase.local",
  [string]$AdminPassword = "OzyBase1234!"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Stop-ProcessSafe {
  param([System.Diagnostics.Process]$Process)
  if ($null -ne $Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
  }
}

function Stop-PortListeners {
  param([int[]]$Ports)
  foreach ($port in $Ports) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        Stop-Process -Id $_.OwningProcess -Force
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

function Wait-Check {
  param(
    [scriptblock]$Check,
    [string]$Label,
    [int]$Attempts = 90,
    [int]$DelaySeconds = 2
  )
  for ($i = 0; $i -lt $Attempts; $i++) {
    try {
      & $Check
      if ($?) {
        return
      }
    } catch {
    }
    Start-Sleep -Seconds $DelaySeconds
  }
  throw "Timeout waiting for $Label"
}

function Ensure-DockerReady {
  $dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  try {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) {
      return
    }
  } catch {
  }

  try {
    Start-Service com.docker.service -ErrorAction SilentlyContinue
  } catch {
  }
  if (Test-Path $dockerDesktop) {
    Start-Process $dockerDesktop | Out-Null
  }

  for ($i = 0; $i -lt 180; $i++) {
    Start-Sleep -Seconds 2
    try {
      docker info *> $null
      if ($LASTEXITCODE -eq 0) {
        return
      }
    } catch {
    }
  }
  throw "Docker engine did not become ready in time"
}

function Remove-ContainerSafe {
  param([string]$Name)
  try {
    docker rm -f $Name 2>$null | Out-Null
  } catch {
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$mailhogName = "ozy-https-mailhog"
$caddyName = "ozy-https-caddy"
$apiLog = Join-Path $env:TEMP "ozybase-https-api.out.log"
$apiErr = Join-Path $env:TEMP "ozybase-https-api.err.log"
$apiBinary = Join-Path $env:TEMP "ozybase-https-validation.exe"
$embeddedRoot = Join-Path $env:TEMP "ozybase-https-embedded"
$caddyfile = Join-Path $env:TEMP "ozybase-caddyfile"
$apiProc = $null

try {
  Ensure-DockerReady
  Stop-PortListeners -Ports @(5433, [int]$ApiPort, [int]$HttpsPort, [int]$MailhogSMTPPort, [int]$MailhogUIPort)
  Remove-ContainerSafe -Name $caddyName
  Remove-ContainerSafe -Name $mailhogName

  docker run -d --name $mailhogName -p "${MailhogSMTPPort}:1025" -p "${MailhogUIPort}:8025" mailhog/mailhog | Out-Null

  @"
{
  auto_https disable_redirects
}

https://localhost {
  tls internal
  reverse_proxy host.docker.internal:$ApiPort
}
"@ | Set-Content -Path $caddyfile -Encoding ascii

  docker run -d --name $caddyName -p "${HttpsPort}:443" -v "${caddyfile}:/etc/caddy/Caddyfile" caddy:2-alpine | Out-Null

  Wait-Check -Label "mailhog api" -Check {
    $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$MailhogUIPort/api/v2/messages"
    if ($response.StatusCode -ne 200) {
      throw "mailhog not ready"
    }
  }

  if (Test-Path $embeddedRoot) {
    Remove-Item -Recurse -Force $embeddedRoot
  }
  New-Item -ItemType Directory -Force -Path $embeddedRoot | Out-Null

  go build -o $apiBinary ./cmd/ozybase

  $env:PORT = $ApiPort
  $env:SITE_URL = "https://localhost:$HttpsPort"
  $env:APP_DOMAIN = "localhost"
  $env:ALLOWED_ORIGINS = "https://localhost:$HttpsPort,http://127.0.0.1:$ApiPort"
  $env:OZY_SKIP_DOTENV = "true"
  $env:DEBUG = "true"
  $env:OZY_STRICT_SECURITY = "false"
  $env:OZY_EMBEDDED_ROOT = $embeddedRoot
  $env:OZY_STORAGE_PATH = (Join-Path $embeddedRoot "storage")
  $env:OZY_AUTO_BOOTSTRAP_ADMIN = "true"
  $env:INITIAL_ADMIN_EMAIL = $AdminEmail
  $env:INITIAL_ADMIN_PASSWORD = $AdminPassword
  $env:SMTP_HOST = "127.0.0.1"
  $env:SMTP_PORT = $MailhogSMTPPort
  $env:SMTP_USER = ""
  $env:SMTP_PASS = ""
  $env:SMTP_FROM = "alerts@ozybase.local"

  $apiProc = Start-Process -FilePath $apiBinary -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErr
  Wait-HttpHealthy -Url "http://127.0.0.1:$ApiPort/api/health" -Process $apiProc

  $apiStdout = if (Test-Path $apiLog) { Get-Content $apiLog -Raw } else { "" }
  if ($apiStdout -notmatch "SMTP mailer initialized") {
    throw "API did not report SMTP mailer startup"
  }

  Wait-Check -Label "https proxy" -Check {
    & curl.exe -sk "https://localhost:$HttpsPort/api/health" *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "https proxy not ready"
    }
  }

  $statusRaw = & curl.exe -sk "https://localhost:$HttpsPort/api/system/status"
  $status = $statusRaw | ConvertFrom-Json
  if (-not $status.initialized) {
    throw "system did not bootstrap admin over HTTPS stack"
  }

  $login = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/auth/login" -ContentType "application/json" -Body (@{ email = $AdminEmail; password = $AdminPassword } | ConvertTo-Json)
  $token = [string]$login.token
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "admin token missing from local api login"
  }

  $inviteeEmail = "invitee+$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@ozybase.local"
  $inviteePassword = "Invitee123!"
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/auth/signup" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body (@{ email = $inviteeEmail; password = $inviteePassword } | ConvertTo-Json) | Out-Null

  $createdWorkspace = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/workspaces" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body (@{ name = "SMTP Validation Workspace" } | ConvertTo-Json)
  $workspaceId = [string]$createdWorkspace.id
  if ([string]::IsNullOrWhiteSpace($workspaceId)) {
    throw "workspace id missing for SMTP validation"
  }

  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/workspaces/$workspaceId/members" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body (@{ email = $inviteeEmail; role = "member" } | ConvertTo-Json) | Out-Null

  $resetSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $csrf = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/auth/csrf" -WebSession $resetSession
  $csrfToken = [string]$csrf.csrf_token
  if ([string]::IsNullOrWhiteSpace($csrfToken)) {
    throw "csrf token missing for reset flow"
  }
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/auth/reset-password/request" -WebSession $resetSession -Headers @{ "X-CSRF-Token" = $csrfToken } -ContentType "application/json" -Body (@{ email = $AdminEmail } | ConvertTo-Json) | Out-Null

  Wait-Check -Label "smtp reset email" -Check {
    $messages = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$MailhogUIPort/api/v2/messages"
    $items = @($messages.items)
    if ($items.Count -lt 1) {
      throw "no smtp messages captured yet"
    }
    $match = $items | Where-Object {
      $_.Content.Headers.Subject -match "Reset your OzyBase password" -and
      $_.Content.Headers.To -match $AdminEmail
    } | Select-Object -First 1
    if ($null -eq $match) {
      throw "expected reset email not found"
    }
    $body = [string]$match.Content.Body
    if ($body -notmatch [regex]::Escape("https://localhost:$HttpsPort/reset-password?token=")) {
      throw "reset email did not include HTTPS reset link"
    }
  }

  Write-Host "==> HTTPS reverse proxy passed"
  Write-Host "==> SMTP password reset flow passed"
}
finally {
  Stop-ProcessSafe -Process $apiProc
  if (Test-Path $apiBinary) {
    try {
      Remove-Item -Force $apiBinary -ErrorAction SilentlyContinue
    } catch {
    }
  }
  if (Test-Path $embeddedRoot) {
    try {
      Remove-Item -Recurse -Force $embeddedRoot -ErrorAction SilentlyContinue
    } catch {
    }
  }
  if (Test-Path $caddyfile) {
    try {
      Remove-Item -Force $caddyfile -ErrorAction SilentlyContinue
    } catch {
    }
  }
  Remove-ContainerSafe -Name $caddyName
  Remove-ContainerSafe -Name $mailhogName
}
