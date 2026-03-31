param(
  [string]$ApiPort = "8092",
  [string]$PgPort = "55432",
  [string]$RedisPort = "56379",
  [string]$MinioApiPort = "59000",
  [string]$MinioConsolePort = "59001",
  [string]$PoolerPort = "56432",
  [string]$AdminEmail = "admin@ozybase.local",
  [string]$AdminPassword = "OzyBase1234!",
  [int]$Rows = 100000,
  [int]$Iterations = 12,
  [int]$Workers = 8
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
$network = "ozy-validate-net"
$pgName = "ozy-validate-pg"
$redisName = "ozy-validate-redis"
$minioName = "ozy-validate-minio"
$pgbName = "ozy-validate-pgb"
$dbUser = "ozybase"
$dbPass = "ozybasepass123"
$dbName = "ozybase"
$apiLog = Join-Path $env:TEMP "ozybase-external-api.out.log"
$apiErr = Join-Path $env:TEMP "ozybase-external-api.err.log"
$apiBinary = Join-Path $env:TEMP "ozybase-external-validation.exe"
$storageDir = Join-Path $env:TEMP "ozybase-external-storage-test"
$downloadPath = Join-Path $storageDir "downloaded-large.bin"
$apiProc = $null
$rng = $null

try {
  Ensure-DockerReady
  Stop-PortListeners -Ports @([int]$ApiPort, [int]$PgPort, [int]$RedisPort, [int]$MinioApiPort, [int]$MinioConsolePort, [int]$PoolerPort)
  Remove-ContainerSafe -Name $pgbName
  Remove-ContainerSafe -Name $minioName
  Remove-ContainerSafe -Name $redisName
  Remove-ContainerSafe -Name $pgName
  try {
    docker network rm $network 2>$null | Out-Null
  } catch {
  }
  docker network create $network | Out-Null

  docker run -d --name $pgName --network $network -p "${PgPort}:5432" -e "POSTGRES_USER=$dbUser" -e "POSTGRES_PASSWORD=$dbPass" -e "POSTGRES_DB=$dbName" -e "POSTGRES_HOST_AUTH_METHOD=md5" -e "POSTGRES_INITDB_ARGS=--auth-host=md5" postgres:15-alpine | Out-Null
  docker run -d --name $redisName --network $network -p "${RedisPort}:6379" redis:7-alpine | Out-Null
  docker run -d --name $minioName --network $network -p "${MinioApiPort}:9000" -p "${MinioConsolePort}:9001" -e "MINIO_ROOT_USER=minioadmin" -e "MINIO_ROOT_PASSWORD=minioadmin" minio/minio server /data --console-address :9001 | Out-Null
  docker run -d --name $pgbName --network $network -p "${PoolerPort}:5432" -e "DB_USER=$dbUser" -e "DB_PASSWORD=$dbPass" -e "DB_HOST=$pgName" -e "DB_NAME=$dbName" -e "POOL_MODE=transaction" -e "MAX_CLIENT_CONN=300" -e "DEFAULT_POOL_SIZE=30" edoburu/pgbouncer:latest | Out-Null

  Wait-Check -Label "postgres" -Check {
    docker run --rm --network $network postgres:15-alpine pg_isready -h $pgName -U $dbUser -d $dbName *> $null
  }
  docker exec $pgName psql -U $dbUser -d postgres -c "SET password_encryption='md5'; ALTER ROLE $dbUser WITH PASSWORD '$dbPass';" | Out-Null
  Wait-Check -Label "redis" -Check {
    docker run --rm --network $network redis:7-alpine redis-cli -h $redisName ping *> $null
  }
  Wait-Check -Label "minio" -Check {
    $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$MinioApiPort/minio/health/live"
    if ($response.StatusCode -ne 200) {
      throw "minio not ready"
    }
  }
  Wait-Check -Label "pgbouncer" -Check {
    docker run --rm --network $network postgres:15-alpine pg_isready -h $pgbName -U $dbUser -d $dbName *> $null
  }

  Write-Host "==> External services ready"

  go build -o $apiBinary ./cmd/ozybase

  $env:PORT = $ApiPort
  $env:DATABASE_URL = "postgres://${dbUser}:${dbPass}@127.0.0.1:$PoolerPort/${dbName}?sslmode=disable"
  $env:DB_POOLER_URL = $env:DATABASE_URL
  $env:SITE_URL = "http://127.0.0.1:$ApiPort"
  $env:APP_DOMAIN = "localhost"
  $env:ALLOWED_ORIGINS = "http://127.0.0.1:$ApiPort"
  $env:OZY_SKIP_DOTENV = "true"
  $env:DEBUG = "false"
  $env:OZY_STRICT_SECURITY = "false"
  $env:OZY_AUTO_BOOTSTRAP_ADMIN = "true"
  $env:INITIAL_ADMIN_EMAIL = $AdminEmail
  $env:INITIAL_ADMIN_PASSWORD = $AdminPassword
  $env:SMOKE_ADMIN_EMAIL = $AdminEmail
  $env:SMOKE_ADMIN_PASSWORD = $AdminPassword
  $env:OZY_STORAGE_PROVIDER = "s3"
  $env:OZY_STORAGE_FALLBACK_LOCAL = "false"
  $env:S3_ENDPOINT = "127.0.0.1:$MinioApiPort"
  $env:S3_ACCESS_KEY = "minioadmin"
  $env:S3_SECRET_KEY = "minioadmin"
  $env:S3_USE_SSL = "false"
  $env:OZY_REALTIME_BROKER = "redis"
  $env:REDIS_ADDR = "127.0.0.1:$RedisPort"
  $env:REDIS_PASSWORD = ""
  $env:REDIS_DB = "0"

  $apiProc = Start-Process -FilePath $apiBinary -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErr
  Wait-HttpHealthy -Url "http://127.0.0.1:$ApiPort/api/health" -Process $apiProc

  $apiStdout = if (Test-Path $apiLog) { Get-Content $apiLog -Raw } else { "" }
  if ($apiStdout -notmatch "Using S3-compatible storage") {
    throw "API did not report S3-compatible storage startup"
  }
  if ($apiStdout -notmatch "Using Redis PubSub") {
    throw "API did not report Redis PubSub startup"
  }

  $env:BASE_URL = "http://127.0.0.1:$ApiPort"
  & "C:/Program Files/Git/bin/bash.exe" "$repoRoot/scripts/smoke_api.sh"
  if ($LASTEXITCODE -ne 0) {
    throw "smoke_api.sh failed"
  }
  Write-Host "==> Core smoke passed on external stack"

  New-Item -ItemType Directory -Force -Path $storageDir | Out-Null
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $smallPaths = @()
  for ($i = 1; $i -le 20; $i++) {
    $path = Join-Path $storageDir ("doc-{0:00}.bin" -f $i)
    $bytes = New-Object byte[](262144)
    $rng.GetBytes($bytes)
    [System.IO.File]::WriteAllBytes($path, $bytes)
    $smallPaths += $path
  }
  $largePath = Join-Path $storageDir "large-doc.bin"
  $largeBytes = New-Object byte[](8388608)
  $rng.GetBytes($largeBytes)
  [System.IO.File]::WriteAllBytes($largePath, $largeBytes)

  $loginResponse = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/auth/login" -ContentType "application/json" -Body (@{ email = $AdminEmail; password = $AdminPassword } | ConvertTo-Json)
  $token = [string]$loginResponse.token
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "login token missing for external validation"
  }
  $workspaceList = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/workspaces" -Headers @{ Authorization = "Bearer $token" }
  $workspaceId = if ($workspaceList.Count -gt 0) { [string]$workspaceList[0].id } else { "" }
  $headers = @{ Authorization = "Bearer $token"; "X-Workspace-Id" = $workspaceId }

  $bucketName = "s3mass$((Get-Date).ToString('HHmmss'))"
  $bucketBody = @{ name = $bucketName; public = $false; rls_enabled = $false } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/files/buckets" -Headers ($headers + @{ "Content-Type" = "application/json" }) -Body $bucketBody | Out-Null

  foreach ($filePath in ($smallPaths + $largePath)) {
    $uploadUrl = "http://127.0.0.1:$ApiPort/api/files?bucket=$bucketName"
    & curl.exe -sS -X POST $uploadUrl -H "Authorization: Bearer $token" -H "X-Workspace-Id: $workspaceId" -F "file=@$filePath" *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "upload failed for $filePath"
    }
  }

  $files = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/files?bucket=$bucketName" -Headers $headers
  if ($files.Count -lt 21) {
    throw "expected at least 21 files in bucket, got $($files.Count)"
  }
  $largeEntry = $files | Where-Object { $_.name -eq "large-doc.bin" } | Select-Object -First 1
  if ($null -eq $largeEntry) {
    throw "large-doc.bin missing from storage listing"
  }
  & curl.exe -sS -o $downloadPath -H "Authorization: Bearer $token" -H "X-Workspace-Id: $workspaceId" "http://127.0.0.1:$ApiPort$($largeEntry.path)" *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "download of large S3-backed object failed"
  }
  if ((Get-Item $downloadPath).Length -ne (Get-Item $largePath).Length) {
    throw "downloaded large object size mismatch"
  }
  Write-Host "==> S3-compatible storage upload/list/download passed"

  $realtimeStatus = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/project/realtime/status" -Headers $headers
  if ([string]$realtimeStatus.mode -ne "redis") {
    throw "expected realtime mode redis, got $($realtimeStatus.mode)"
  }
  Write-Host "==> Redis realtime status passed"

  go run ./cmd/ozybase-bench -base-url "http://127.0.0.1:$ApiPort" -email $AdminEmail -password $AdminPassword -rows $Rows -iterations $Iterations -workers $Workers
}
finally {
  if ($null -ne $rng) {
    $rng.Dispose()
  }
  Stop-ProcessSafe -Process $apiProc
  if (Test-Path $apiBinary) {
    try {
      Remove-Item -Force $apiBinary -ErrorAction SilentlyContinue
    } catch {
    }
  }
  Remove-ContainerSafe -Name $pgbName
  Remove-ContainerSafe -Name $minioName
  Remove-ContainerSafe -Name $redisName
  Remove-ContainerSafe -Name $pgName
  try {
    docker network rm $network 2>$null | Out-Null
  } catch {
  }
}
