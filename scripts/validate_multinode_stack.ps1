param(
  [string]$ApiPortA = "8097",
  [string]$ApiPortB = "8098",
  [string]$PgPort = "56442",
  [string]$RedisPort = "57379",
  [string]$MinioApiPort = "60000",
  [string]$MinioConsolePort = "60001",
  [string]$PoolerPort = "57432",
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
$network = "ozy-multinode-net"
$pgName = "ozy-multinode-pg"
$redisName = "ozy-multinode-redis"
$minioName = "ozy-multinode-minio"
$pgbName = "ozy-multinode-pgb"
$dbUser = "ozybase"
$dbPass = "ozybasepass123"
$dbName = "ozybase"
$apiBinary = Join-Path $env:TEMP "ozybase-multinode-validation.exe"
$apiLogA = Join-Path $env:TEMP "ozybase-multinode-a.out.log"
$apiErrA = Join-Path $env:TEMP "ozybase-multinode-a.err.log"
$apiLogB = Join-Path $env:TEMP "ozybase-multinode-b.out.log"
$apiErrB = Join-Path $env:TEMP "ozybase-multinode-b.err.log"
$sseLog = Join-Path $env:TEMP "ozybase-multinode-sse.log"
$apiProcA = $null
$apiProcB = $null
$sseProc = $null

try {
  Ensure-DockerReady
  Stop-PortListeners -Ports @([int]$ApiPortA, [int]$ApiPortB, [int]$PgPort, [int]$RedisPort, [int]$MinioApiPort, [int]$MinioConsolePort, [int]$PoolerPort)
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

  go build -o $apiBinary ./cmd/ozybase

  $sharedEnv = @{
    DATABASE_URL                  = "postgres://${dbUser}:${dbPass}@127.0.0.1:$PgPort/${dbName}?sslmode=disable"
    DB_POOLER_URL                 = "postgres://${dbUser}:${dbPass}@127.0.0.1:$PoolerPort/${dbName}?sslmode=disable"
    SITE_URL                      = "http://127.0.0.1:$ApiPortA"
    APP_DOMAIN                    = "localhost"
    ALLOWED_ORIGINS               = "http://127.0.0.1:$ApiPortA,http://127.0.0.1:$ApiPortB"
    OZY_SKIP_DOTENV               = "true"
    DEBUG                         = "false"
    OZY_STRICT_SECURITY           = "false"
    JWT_SECRET                    = "ozy_multinode_jwt_secret_1234567890abcdef"
    ANON_KEY                      = "ozy_multinode_publishable_key_1234567890abcdef"
    SERVICE_ROLE_KEY              = "ozy_multinode_secret_key_1234567890abcdef"
    OZY_API_KEY_ENCRYPTION_SECRET = "ozy_multinode_api_key_encryption_1234567890abcdef"
    OZY_AUTO_BOOTSTRAP_ADMIN      = "true"
    INITIAL_ADMIN_EMAIL           = $AdminEmail
    INITIAL_ADMIN_PASSWORD        = $AdminPassword
    OZY_STORAGE_PROVIDER          = "s3"
    OZY_STORAGE_FALLBACK_LOCAL    = "false"
    S3_ENDPOINT                   = "127.0.0.1:$MinioApiPort"
    S3_ACCESS_KEY                 = "minioadmin"
    S3_SECRET_KEY                 = "minioadmin"
    S3_USE_SSL                    = "false"
    OZY_REALTIME_BROKER           = "redis"
    REDIS_ADDR                    = "127.0.0.1:$RedisPort"
    REDIS_PASSWORD                = ""
    REDIS_DB                      = "0"
  }

  foreach ($entry in $sharedEnv.GetEnumerator()) {
    Set-Item -Path ("Env:" + $entry.Key) -Value ([string]$entry.Value)
  }

  $env:PORT = $ApiPortA
  $env:OZY_REALTIME_NODE_ID = "node-alpha"
  $apiProcA = Start-Process -FilePath $apiBinary -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiLogA -RedirectStandardError $apiErrA

  $env:PORT = $ApiPortB
  $env:OZY_REALTIME_NODE_ID = "node-beta"
  $apiProcB = Start-Process -FilePath $apiBinary -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $apiLogB -RedirectStandardError $apiErrB

  Wait-HttpHealthy -Url "http://127.0.0.1:$ApiPortA/api/health" -Process $apiProcA
  Wait-HttpHealthy -Url "http://127.0.0.1:$ApiPortB/api/health" -Process $apiProcB

  $stdoutA = if (Test-Path $apiLogA) { Get-Content $apiLogA -Raw } else { "" }
  $stdoutB = if (Test-Path $apiLogB) { Get-Content $apiLogB -Raw } else { "" }
  $stderrA = if (Test-Path $apiErrA) { Get-Content $apiErrA -Raw } else { "" }
  $stderrB = if (Test-Path $apiErrB) { Get-Content $apiErrB -Raw } else { "" }
  if ($stdoutA -notmatch "Using Redis PubSub" -or $stdoutB -notmatch "Using Redis PubSub") {
    throw "both nodes must initialize Redis PubSub"
  }
  if (($stdoutA + $stderrA) -notmatch "Realtime PubSub bridge active" -or ($stdoutB + $stderrB) -notmatch "Realtime PubSub bridge active") {
    throw "both nodes must initialize the realtime pubsub bridge"
  }

  $loginResponse = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPortA/api/auth/login" -ContentType "application/json" -Body (@{ email = $AdminEmail; password = $AdminPassword } | ConvertTo-Json)
  $token = [string]$loginResponse.token
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "login token missing for multinode validation"
  }

  $workspaceResponse = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPortA/api/workspaces" -Headers @{ Authorization = "Bearer $token" }
  $workspaceList = @($workspaceResponse)
  $workspaceId = ""
  if ($workspaceList.Count -gt 0) {
    $firstWorkspace = $workspaceList | Select-Object -First 1
    if ($null -ne $firstWorkspace -and $firstWorkspace.PSObject.Properties.Name -contains "id") {
      $workspaceId = [string]$firstWorkspace.id
    }
  }
  $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
  if (-not [string]::IsNullOrWhiteSpace($workspaceId)) {
    $headers["X-Workspace-Id"] = $workspaceId
  }

  $statusA = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPortA/api/project/realtime/status" -Headers $headers
  $statusB = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPortB/api/project/realtime/status" -Headers $headers
  if ([string]$statusA.mode -ne "redis" -or [string]$statusB.mode -ne "redis") {
    throw "expected redis realtime mode on both nodes"
  }
  if ([string]$statusA.node_id -eq [string]$statusB.node_id) {
    throw "node ids should differ across nodes"
  }

  $tableName = "mnvalidate$((Get-Date).ToString('HHmmss'))"
  $collectionBody = @{
    name             = $tableName
    display_name     = $tableName
    schema           = @(
      @{ name = "title"; type = "text"; required = $false; unique = $false; is_primary = $false; references = $null }
    )
    rls_enabled      = $false
    rls_rule         = ""
    rls_policies     = @{}
    realtime_enabled = $true
  } | ConvertTo-Json -Depth 6

  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPortA/api/collections" -Headers $headers -Body $collectionBody | Out-Null

  if (Test-Path $sseLog) {
    Remove-Item -Force $sseLog
  }
  $sseProc = Start-Process -FilePath "curl.exe" -ArgumentList @("-sN", "http://127.0.0.1:$ApiPortB/api/realtime") -NoNewWindow -PassThru -RedirectStandardOutput $sseLog -RedirectStandardError "$sseLog.err"
  Start-Sleep -Seconds 2

  $insertBody = @{ title = "node-alpha-row" } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPortA/api/tables/$tableName" -Headers $headers -Body $insertBody | Out-Null

  Wait-Check -Label "cross-node realtime event" -Check {
    if (-not (Test-Path $sseLog)) {
      throw "sse log missing"
    }
    $content = Get-Content $sseLog -Raw
    if ($content -notmatch [regex]::Escape('"table":"' + $tableName + '"')) {
      throw "realtime event not observed yet"
    }
  } -Attempts 30 -DelaySeconds 1

  Start-Sleep -Seconds 2
  Stop-ProcessSafe -Process $sseProc
  $sseProc = $null

  $sseContent = if (Test-Path $sseLog) { Get-Content $sseLog -Raw } else { "" }
  $eventMatches = [regex]::Matches($sseContent, [regex]::Escape('"table":"' + $tableName + '"')).Count
  if ($eventMatches -ne 1) {
    throw "expected exactly one realtime event for $tableName on node beta, got $eventMatches"
  }

  Stop-ProcessSafe -Process $apiProcA
  $apiProcA = $null
  Wait-Check -Label "node beta health after node alpha stop" -Check {
    $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$ApiPortB/api/health"
    if ($response.StatusCode -ne 200) {
      throw "node beta unhealthy after node alpha stop"
    }
  }

  $insertBodyB = @{ title = "node-beta-row" } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPortB/api/tables/$tableName" -Headers $headers -Body $insertBodyB | Out-Null
  $recordHeaders = @{ Authorization = "Bearer $token" }
  if (-not [string]::IsNullOrWhiteSpace($workspaceId)) {
    $recordHeaders["X-Workspace-Id"] = $workspaceId
  }
  $records = Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:{0}/api/tables/{1}?limit=10&count_mode=auto" -f $ApiPortB, $tableName) -Headers $recordHeaders
  if (@($records.data).Count -lt 2) {
    throw "expected at least two records after node failover validation"
  }

  Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:$ApiPortB/api/collections/$tableName" -Headers $recordHeaders | Out-Null

  Write-Host "==> Two nodes started concurrently against shared pooler"
  Write-Host "==> Redis realtime status and distinct node ids passed"
  Write-Host "==> Cross-node realtime fan-out delivered a single event"
  Write-Host "==> Single-node failover behavior passed"
}
finally {
  Stop-ProcessSafe -Process $sseProc
  Stop-ProcessSafe -Process $apiProcA
  Stop-ProcessSafe -Process $apiProcB
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
