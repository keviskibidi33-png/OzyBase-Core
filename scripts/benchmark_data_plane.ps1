param(
  [string]$BaseUrl = "http://127.0.0.1:8090",
  [string]$Email = "admin@ozybase.local",
  [string]$Password = "OzyBase123!",
  [int]$Rows = 100000,
  [int]$Iterations = 12,
  [int]$Workers = 4
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

go run ./cmd/ozybase-bench `
  -base-url $BaseUrl `
  -email $Email `
  -password $Password `
  -rows $Rows `
  -iterations $Iterations `
  -workers $Workers
