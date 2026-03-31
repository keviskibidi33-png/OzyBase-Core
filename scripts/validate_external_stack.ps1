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
  [int]$Workers = 8,
  [int]$SmallFiles = 20,
  [int]$SmallFileSizeKB = 256,
  [int]$LargeFiles = 2,
  [int]$LargeFileSizeMB = 96,
  [int]$BucketLimitMB = 100,
  [int]$BucketQuotaMB = 220,
  [int]$LifecycleRetentionDays = 1,
  [string]$StorageWorkspaceRoot = "",
  [int]$StorageMaintenanceIntervalMinutes = 60,
  [switch]$RestartDuringMultipart,
  [switch]$ValidateAutoLifecycle,
  [switch]$SkipBenchmark
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

function Start-ValidationAPI {
  param(
    [string]$BinaryPath,
    [string]$WorkingDirectory,
    [string]$StdOutPath,
    [string]$StdErrPath
  )

  return Start-Process -FilePath $BinaryPath -WorkingDirectory $WorkingDirectory -PassThru -RedirectStandardOutput $StdOutPath -RedirectStandardError $StdErrPath
}

function Assert-ExternalAPIReady {
  param(
    [int]$ApiPort,
    [System.Diagnostics.Process]$Process,
    [string]$ApiLogPath
  )

  Wait-HttpHealthy -Url "http://127.0.0.1:$ApiPort/api/health" -Process $Process
  $apiStdout = if (Test-Path $ApiLogPath) { Get-Content $ApiLogPath -Raw } else { "" }
  if ($apiStdout -notmatch "Using S3-compatible storage") {
    throw "API did not report S3-compatible storage startup"
  }
  if ($apiStdout -notmatch "Using Redis PubSub") {
    throw "API did not report Redis PubSub startup"
  }
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

function Start-CurlProcess {
  param(
    [string[]]$Arguments,
    [string]$Label,
    [string[]]$ExpectedStatuses = @()
  )

  $safeLabel = ($Label -replace '[^A-Za-z0-9_.-]', '_')
  $stdout = Join-Path $env:TEMP "$safeLabel.stdout.log"
  $stderr = Join-Path $env:TEMP "$safeLabel.stderr.log"
  $argumentLine = ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }) -join ' '
  $process = Start-Process -FilePath "curl.exe" -ArgumentList $argumentLine -NoNewWindow -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  return [pscustomobject]@{
    Label            = $Label
    Process          = $process
    StdOut           = $stdout
    StdErr           = $stderr
    ExpectedStatuses = $ExpectedStatuses
  }
}

function Write-RandomFile {
  param(
    [string]$Path,
    [long]$SizeBytes,
    [System.Security.Cryptography.RandomNumberGenerator]$Random,
    [int]$ChunkSizeBytes = 8MB
  )

  $stream = [System.IO.File]::Create($Path)
  try {
    $remaining = $SizeBytes
    $buffer = New-Object byte[]($ChunkSizeBytes)
    while ($remaining -gt 0) {
      $writeCount = [int][Math]::Min([long]$buffer.Length, $remaining)
      $Random.GetBytes($buffer)
      $stream.Write($buffer, 0, $writeCount)
      $remaining -= $writeCount
    }
  } finally {
    $stream.Dispose()
  }
}

function Wait-CurlProcesses {
  param([object[]]$Jobs)

  foreach ($job in $Jobs) {
    if ($null -eq $job) {
      continue
    }
    $job.Process.WaitForExit()
    $stdout = if (Test-Path $job.StdOut) { Get-Content $job.StdOut -Raw } else { "" }
    $stderr = if (Test-Path $job.StdErr) { Get-Content $job.StdErr -Raw } else { "" }
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      throw "curl job '$($job.Label)' failed: $stderr"
    }
    $status = if ($null -ne $stdout) { [string]$stdout } else { "" }
    $status = $status.Trim()
    if ($job.ExpectedStatuses.Count -gt 0 -and $status -notin $job.ExpectedStatuses) {
      throw "curl job '$($job.Label)' returned unexpected HTTP status '$status'"
    }
    if ($stdout -match '"error"\s*:') {
      throw "curl job '$($job.Label)' returned API error payload: $stdout"
    }
  }
}

function Get-StatusCodeFromErrorRecord {
  param($Record)

  if ($null -ne $Record.Exception -and $null -ne $Record.Exception.Response) {
    return [int]$Record.Exception.Response.StatusCode.value__
  }
  return $null
}

function New-StorageUploadSession {
  param(
    [int]$ApiPort,
    [string]$Token,
    [string]$WorkspaceId,
    [string]$BucketName,
    [string]$FileName,
    [long]$FileSize,
    [string]$ContentType
  )

  $headers = @{
    Authorization  = "Bearer $Token"
    "X-Workspace-Id" = $WorkspaceId
    "Content-Type" = "application/json"
  }
  $body = @{
    bucket       = $BucketName
    filename     = $FileName
    size         = $FileSize
    content_type = $ContentType
  } | ConvertTo-Json

  return Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/files/uploads/session" -Headers $headers -Body $body
}

function New-MultipartUploadSession {
  param(
    [int]$ApiPort,
    [string]$Token,
    [string]$WorkspaceId,
    [string]$BucketName,
    [string]$FileName,
    [long]$FileSize,
    [string]$ContentType
  )

  $headers = @{
    Authorization    = "Bearer $Token"
    "X-Workspace-Id" = $WorkspaceId
    "Content-Type"   = "application/json"
  }
  $body = @{
    bucket       = $BucketName
    filename     = $FileName
    size         = $FileSize
    content_type = $ContentType
  } | ConvertTo-Json

  return Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/files/uploads/multipart/session" -Headers $headers -Body $body
}

function Get-MultipartUploadSession {
  param(
    [int]$ApiPort,
    [string]$Token,
    [string]$WorkspaceId,
    [string]$SessionId
  )

  return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/files/uploads/multipart/$SessionId" -Headers @{
    Authorization    = "Bearer $Token"
    "X-Workspace-Id" = $WorkspaceId
  }
}

function Invoke-SqlJSON {
  param(
    [int]$ApiPort,
    [string]$Token,
    [string]$WorkspaceId,
    [string]$Query
  )

  return Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/sql" -Headers @{
    Authorization    = "Bearer $Token"
    "X-Workspace-Id" = $WorkspaceId
    "Content-Type"   = "application/json"
  } -Body (@{ query = $Query } | ConvertTo-Json)
}

function Start-StreamingUploadJob {
  param(
    [string]$Label,
    [string]$UploadUrl,
    [string]$UploadToken,
    [string]$FilePath,
    [string]$BearerToken,
    [string]$WorkspaceId
  )

  return Start-CurlProcess -Label $Label -Arguments @(
    "-sS",
    "-o", "NUL",
    "-w", "%{http_code}",
    "-X", "PUT",
    $UploadUrl,
    "-H", "Authorization: Bearer $BearerToken",
    "-H", "X-Workspace-Id: $WorkspaceId",
    "-H", "X-Ozy-Upload-Token: $UploadToken",
    "--data-binary", "@$FilePath"
  ) -ExpectedStatuses @("200", "201")
}

function Upload-MultipartFile {
  param(
    [int]$ApiPort,
    [string]$Token,
    [string]$WorkspaceId,
    [string]$SessionId,
    [string]$FilePath,
    [int]$ChunkSizeBytes,
    [int]$StartPart = 1
  )

  $stream = [System.IO.File]::OpenRead($FilePath)
  try {
    if ($StartPart -gt 1) {
      $offset = [int64]($StartPart - 1) * [int64]$ChunkSizeBytes
      $null = $stream.Seek($offset, [System.IO.SeekOrigin]::Begin)
    }
    $partNumber = $StartPart
    $buffer = New-Object byte[]($ChunkSizeBytes)
    while (($bytesRead = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $chunkPath = Join-Path $env:TEMP ("ozy-multipart-$SessionId-part-$partNumber.bin")
      try {
        if ($bytesRead -eq $buffer.Length) {
          [System.IO.File]::WriteAllBytes($chunkPath, $buffer)
        } else {
          [System.IO.File]::WriteAllBytes($chunkPath, $buffer[0..($bytesRead - 1)])
        }
        $status = (& curl.exe -sS -o NUL -w "%{http_code}" -X PUT "http://127.0.0.1:$ApiPort/api/files/uploads/multipart/$SessionId/parts/$partNumber" `
          -H "Authorization: Bearer $Token" `
          -H "X-Workspace-Id: $WorkspaceId" `
          -H "Content-Type: application/octet-stream" `
          --data-binary "@$chunkPath")
        if ($LASTEXITCODE -ne 0) {
          throw "multipart upload failed for part $partNumber"
        }
        if ([string]$status -notin @("200", "201")) {
          throw "multipart upload returned HTTP status '$status' for part $partNumber"
        }
      } finally {
        if (Test-Path $chunkPath) {
          Remove-Item -Force $chunkPath -ErrorAction SilentlyContinue
        }
      }
      $partNumber++
    }
  } finally {
    $stream.Dispose()
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$storageWorkspace = if ([string]::IsNullOrWhiteSpace($StorageWorkspaceRoot)) { $env:TEMP } else { $StorageWorkspaceRoot }
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
$storageDir = Join-Path $storageWorkspace "ozybase-external-storage-test"
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
  $env:DATABASE_URL = "postgres://${dbUser}:${dbPass}@127.0.0.1:$PgPort/${dbName}?sslmode=disable"
  $env:DB_POOLER_URL = "postgres://${dbUser}:${dbPass}@127.0.0.1:$PoolerPort/${dbName}?sslmode=disable"
  $env:SITE_URL = "http://127.0.0.1:$ApiPort"
  $env:APP_DOMAIN = "localhost"
  $env:ALLOWED_ORIGINS = "http://127.0.0.1:$ApiPort"
  $env:OZY_SKIP_DOTENV = "true"
  $env:DEBUG = "false"
  $env:OZY_STRICT_SECURITY = "false"
  $env:JWT_SECRET = "ozy_validation_jwt_secret_1234567890abcdef"
  $env:ANON_KEY = "ozy_validation_publishable_key_1234567890abcdef"
  $env:SERVICE_ROLE_KEY = "ozy_validation_secret_key_1234567890abcdef"
  $env:OZY_API_KEY_ENCRYPTION_SECRET = "ozy_validation_api_key_encryption_1234567890abcdef"
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
  $env:OZY_STORAGE_MAINTENANCE_INTERVAL_MINUTES = [string]$StorageMaintenanceIntervalMinutes

  $apiProc = Start-ValidationAPI -BinaryPath $apiBinary -WorkingDirectory $repoRoot -StdOutPath $apiLog -StdErrPath $apiErr
  Assert-ExternalAPIReady -ApiPort $ApiPort -Process $apiProc -ApiLogPath $apiLog

  $env:BASE_URL = "http://127.0.0.1:$ApiPort"
  & "C:/Program Files/Git/bin/bash.exe" "$repoRoot/scripts/smoke_api.sh"
  if ($LASTEXITCODE -ne 0) {
    throw "smoke_api.sh failed"
  }
  Write-Host "==> Core smoke passed on external stack"

  New-Item -ItemType Directory -Force -Path $storageDir | Out-Null
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $smallPaths = @()
  $smallBytesLength = $SmallFileSizeKB * 1024
  for ($i = 1; $i -le $SmallFiles; $i++) {
    $path = Join-Path $storageDir ("doc-{0:00}.bin" -f $i)
    Write-RandomFile -Path $path -SizeBytes $smallBytesLength -Random $rng
    $smallPaths += $path
  }
  $largePaths = @()
  $largeBytesLength = $LargeFileSizeMB * 1024 * 1024
  for ($i = 1; $i -le $LargeFiles; $i++) {
    $path = Join-Path $storageDir ("large-doc-{0:00}.bin" -f $i)
    Write-RandomFile -Path $path -SizeBytes $largeBytesLength -Random $rng
    $largePaths += $path
  }
  $mismatchPath = Join-Path $storageDir "declared-size-mismatch-source.bin"
  Write-RandomFile -Path $mismatchPath -SizeBytes (2MB) -Random $rng

  $loginResponse = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/auth/login" -ContentType "application/json" -Body (@{ email = $AdminEmail; password = $AdminPassword } | ConvertTo-Json)
  $token = [string]$loginResponse.token
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "login token missing for external validation"
  }
  $workspaceList = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/workspaces" -Headers @{ Authorization = "Bearer $token" }
  $workspaceId = if ($workspaceList.Count -gt 0) { [string]$workspaceList[0].id } else { "" }
  $headers = @{ Authorization = "Bearer $token"; "X-Workspace-Id" = $workspaceId }

  $bucketName = "s3mass$((Get-Date).ToString('HHmmss'))"
  $bucketLimitBytes = $BucketLimitMB * 1024 * 1024
  $bucketQuotaBytes = $BucketQuotaMB * 1024 * 1024
  $bucketBody = @{
    name                        = $bucketName
    public                      = $false
    rls_enabled                 = $false
    max_file_size_bytes         = $bucketLimitBytes
    max_total_size_bytes        = $bucketQuotaBytes
    lifecycle_delete_after_days = $LifecycleRetentionDays
  } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/files/buckets" -Headers ($headers + @{ "Content-Type" = "application/json" }) -Body $bucketBody | Out-Null

  foreach ($filePath in $smallPaths) {
    $fileName = [IO.Path]::GetFileName($filePath)
    $fileSize = (Get-Item $filePath).Length
    $session = New-StorageUploadSession -ApiPort $ApiPort -Token $token -WorkspaceId $workspaceId -BucketName $bucketName -FileName $fileName -FileSize $fileSize -ContentType "application/octet-stream"
    $uploadUrl = "http://127.0.0.1:$ApiPort$($session.upload_url)"
    & curl.exe -sS -X PUT $uploadUrl -H "Authorization: Bearer $token" -H "X-Workspace-Id: $workspaceId" -H "X-Ozy-Upload-Token: $($session.upload_token)" --data-binary "@$filePath" *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "upload failed for $filePath"
    }
  }

  $multipartLargePath = if ($largePaths.Count -gt 0) { $largePaths[0] } else { $null }
  if ($null -ne $multipartLargePath) {
    $multipartFileName = [IO.Path]::GetFileName($multipartLargePath)
    $multipartFileSize = (Get-Item $multipartLargePath).Length
    $multipartSession = New-MultipartUploadSession -ApiPort $ApiPort -Token $token -WorkspaceId $workspaceId -BucketName $bucketName -FileName $multipartFileName -FileSize $multipartFileSize -ContentType "application/octet-stream"
    $firstChunkPath = Join-Path $storageDir "multipart-first-chunk.bin"
    $firstChunkBytes = New-Object byte[]($multipartSession.chunk_size_bytes)
    $firstChunkStream = [System.IO.File]::OpenRead($multipartLargePath)
    try {
      $bytesRead = $firstChunkStream.Read($firstChunkBytes, 0, $firstChunkBytes.Length)
      if ($bytesRead -lt 1) {
        throw "failed to read the first multipart chunk"
      }
      if ($bytesRead -eq $firstChunkBytes.Length) {
        [System.IO.File]::WriteAllBytes($firstChunkPath, $firstChunkBytes)
      } else {
        [System.IO.File]::WriteAllBytes($firstChunkPath, $firstChunkBytes[0..($bytesRead - 1)])
      }
    } finally {
      $firstChunkStream.Dispose()
    }
    try {
      $firstPartStatus = (& curl.exe -sS -o NUL -w "%{http_code}" -X PUT "http://127.0.0.1:$ApiPort/api/files/uploads/multipart/$($multipartSession.session_id)/parts/1" `
        -H "Authorization: Bearer $token" `
        -H "X-Workspace-Id: $workspaceId" `
        -H "Content-Type: application/octet-stream" `
        --data-binary "@$firstChunkPath")
      if ($LASTEXITCODE -ne 0) {
        throw "failed to upload the first multipart chunk"
      }
      if ([string]$firstPartStatus -notin @("200", "201")) {
        throw "failed to upload the first multipart chunk, HTTP status '$firstPartStatus'"
      }
    } finally {
      if (Test-Path $firstChunkPath) {
        Remove-Item -Force $firstChunkPath -ErrorAction SilentlyContinue
      }
    }

    $multipartStatus = Get-MultipartUploadSession -ApiPort $ApiPort -Token $token -WorkspaceId $workspaceId -SessionId $multipartSession.session_id
    if ($multipartStatus.uploaded_parts.Count -lt 1) {
      throw "multipart status did not report the uploaded first chunk"
    }

    if ($RestartDuringMultipart) {
      Stop-ProcessSafe -Process $apiProc
      Start-Sleep -Seconds 2
      $apiProc = Start-ValidationAPI -BinaryPath $apiBinary -WorkingDirectory $repoRoot -StdOutPath $apiLog -StdErrPath $apiErr
      Assert-ExternalAPIReady -ApiPort $ApiPort -Process $apiProc -ApiLogPath $apiLog
      $multipartStatusAfterRestart = Get-MultipartUploadSession -ApiPort $ApiPort -Token $token -WorkspaceId $workspaceId -SessionId $multipartSession.session_id
      if ($multipartStatusAfterRestart.uploaded_parts.Count -lt 1) {
        throw "multipart upload session did not preserve uploaded parts after API restart"
      }
    }

    Upload-MultipartFile -ApiPort $ApiPort -Token $token -WorkspaceId $workspaceId -SessionId $multipartSession.session_id -FilePath $multipartLargePath -ChunkSizeBytes $multipartSession.chunk_size_bytes -StartPart 2
    $completeResponse = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/files/uploads/multipart/$($multipartSession.session_id)/complete" -Headers ($headers + @{ "Content-Type" = "application/json" }) -Body "{}"
    if ($null -eq $completeResponse -or [string]::IsNullOrWhiteSpace([string]$completeResponse.name)) {
      throw "multipart completion did not return the stored object payload"
    }
  }

  $largeUploadJobs = @()
  foreach ($filePath in $largePaths | Select-Object -Skip 1) {
    $fileName = [IO.Path]::GetFileName($filePath)
    $fileSize = (Get-Item $filePath).Length
    $session = New-StorageUploadSession -ApiPort $ApiPort -Token $token -WorkspaceId $workspaceId -BucketName $bucketName -FileName $fileName -FileSize $fileSize -ContentType "application/octet-stream"
    $uploadUrl = "http://127.0.0.1:$ApiPort$($session.upload_url)"
    $label = "ozybase-upload-$([IO.Path]::GetFileNameWithoutExtension($filePath))"
    $largeUploadJobs += Start-StreamingUploadJob -Label $label -UploadUrl $uploadUrl -UploadToken $session.upload_token -FilePath $filePath -BearerToken $token -WorkspaceId $workspaceId
  }
  Wait-CurlProcesses -Jobs $largeUploadJobs

  $uploadedBytes = [long](($smallPaths | ForEach-Object { (Get-Item $_).Length } | Measure-Object -Sum).Sum + ($largePaths | ForEach-Object { (Get-Item $_).Length } | Measure-Object -Sum).Sum)

  $oversizeBody = @{
    bucket       = $bucketName
    filename     = "oversize-check.bin"
    size         = ($bucketLimitBytes + 1MB)
    content_type = "application/octet-stream"
  } | ConvertTo-Json
  try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/files/uploads/session" -Headers ($headers + @{ "Content-Type" = "application/json" }) -Body $oversizeBody | Out-Null
    throw "oversize upload session should have been rejected"
  } catch {
    $statusCode = Get-StatusCodeFromErrorRecord -Record $_
    if ($null -eq $statusCode) {
      throw
    }
    if ($statusCode -ne 413) {
      throw "expected oversize session rejection 413, got $statusCode"
    }
  }

  $remainingQuotaBytes = [Math]::Max([long]0, $bucketQuotaBytes - $uploadedBytes)
  $quotaProbeBytes = [Math]::Max([long](16MB), $remainingQuotaBytes + 1MB)
  $quotaBody = @{
    bucket       = $bucketName
    filename     = "quota-check.bin"
    size         = $quotaProbeBytes
    content_type = "application/octet-stream"
  } | ConvertTo-Json
  try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/files/uploads/session" -Headers ($headers + @{ "Content-Type" = "application/json" }) -Body $quotaBody | Out-Null
    throw "bucket quota should have been rejected"
  } catch {
    $statusCode = Get-StatusCodeFromErrorRecord -Record $_
    if ($null -eq $statusCode) {
      throw
    }
    if ($statusCode -ne 413) {
      throw "expected bucket quota rejection 413, got $statusCode"
    }
  }

  $mismatchSession = New-StorageUploadSession -ApiPort $ApiPort -Token $token -WorkspaceId $workspaceId -BucketName $bucketName -FileName "declared-size-mismatch.bin" -FileSize (1MB) -ContentType "application/octet-stream"
  $mismatchStatus = (& curl.exe -sS -o NUL -w "%{http_code}" -X PUT "http://127.0.0.1:$ApiPort$($mismatchSession.upload_url)" `
    -H "Authorization: Bearer $token" `
    -H "X-Workspace-Id: $workspaceId" `
    -H "X-Ozy-Upload-Token: $($mismatchSession.upload_token)" `
    --data-binary "@$mismatchPath")
  if ($LASTEXITCODE -ne 0) {
    throw "upload size mismatch check failed"
  }
  $mismatchStatus = ([string]$mismatchStatus).Trim()
  if ($mismatchStatus -ne "400") {
    throw "expected upload size mismatch to return 400, got '$mismatchStatus'"
  }

  $filesResForLifecycle = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/files?bucket=$bucketName" -Headers $headers
  $lifecycleCandidate = @($filesResForLifecycle | Where-Object { $_.name -like "doc-*.bin" } | Select-Object -First 1)
  if ($lifecycleCandidate.Count -lt 1) {
    throw "expected a small storage object for lifecycle validation"
  }
  $lifecycleName = [string]$lifecycleCandidate[0].name
  Invoke-SqlJSON -ApiPort $ApiPort -Token $token -WorkspaceId $workspaceId -Query @"
UPDATE _v_storage_objects
SET created_at = NOW() - INTERVAL '2 days'
WHERE bucket_id IN (SELECT id FROM _v_buckets WHERE name = '$bucketName')
  AND name = '$lifecycleName'
"@ | Out-Null
  if ($ValidateAutoLifecycle) {
    Wait-Check -Label "automatic lifecycle sweep" -Attempts 45 -DelaySeconds 2 -Check {
      $remaining = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/files?bucket=$bucketName" -Headers $headers
      $matches = @($remaining | Where-Object { $_.name -eq $lifecycleName })
      if ($matches.Count -gt 0) {
        throw "lifecycle candidate still present"
      }
    }
  } else {
    $lifecycleSweep = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$ApiPort/api/files/buckets/$bucketName/lifecycle/sweep" -Headers ($headers + @{ "Content-Type" = "application/json" }) -Body "{}"
    if ([int]$lifecycleSweep.deleted_objects -lt 1) {
      throw "expected lifecycle sweep to delete at least one object"
    }
  }

  $files = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/files?bucket=$bucketName" -Headers $headers
  $expectedFileCount = $SmallFiles + $LargeFiles
  if ($files.Count -lt ($expectedFileCount - 1)) {
    throw "expected at least $expectedFileCount files in bucket, got $($files.Count)"
  }
  $largeEntries = @($files | Where-Object { $_.name -like "large-doc-*.bin" })
  if ($largeEntries.Count -lt $LargeFiles) {
    throw "expected $LargeFiles large storage objects, got $($largeEntries.Count)"
  }

  $downloadJobs = @()
  foreach ($entry in $largeEntries) {
    $target = Join-Path $storageDir ("download-" + $entry.name)
    $downloadJobs += Start-CurlProcess -Label ("ozybase-download-" + $entry.name) -Arguments @(
      "-sS",
      "-o", $target,
      "-w", "%{http_code}",
      "-H", "Authorization: Bearer $token",
      "-H", "X-Workspace-Id: $workspaceId",
      "http://127.0.0.1:$ApiPort$($entry.path)"
    ) -ExpectedStatuses @("200")
  }
  Wait-CurlProcesses -Jobs $downloadJobs

  foreach ($entry in $largeEntries) {
    $target = Join-Path $storageDir ("download-" + $entry.name)
    $source = Join-Path $storageDir $entry.name
    if (-not (Test-Path $target)) {
      throw "downloaded file missing: $target"
    }
    if ((Get-Item $target).Length -ne (Get-Item $source).Length) {
      throw "downloaded large object size mismatch for $($entry.name)"
    }
  }
  $deleteBucket = Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:$ApiPort/api/files/buckets/$bucketName" -Headers $headers
  if ([int]$deleteBucket.deleted_files -lt ($expectedFileCount - 1)) {
    throw "bucket cleanup removed fewer objects than expected: $($deleteBucket.deleted_files) < $($expectedFileCount - 1)"
  }
  Write-Host "==> S3-compatible storage upload/list/multipart/quota/lifecycle passed"

  $realtimeStatus = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$ApiPort/api/project/realtime/status" -Headers $headers
  if ([string]$realtimeStatus.mode -ne "redis") {
    throw "expected realtime mode redis, got $($realtimeStatus.mode)"
  }
  Write-Host "==> Redis realtime status passed"

  if (-not $SkipBenchmark) {
    go run ./cmd/ozybase-bench -base-url "http://127.0.0.1:$ApiPort" -email $AdminEmail -password $AdminPassword -rows $Rows -iterations $Iterations -workers $Workers
  }
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
