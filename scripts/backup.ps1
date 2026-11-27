# CivicPulse backup. Run from PowerShell. Needs the PostgreSQL command-line tools (pg_dump, psql) installed.
#   $env:CIVICPULSE_DB_URL = "postgresql://postgres.xxxx:PASSWORD@aws-0-xx.pooler.supabase.com:5432/postgres"
#   .\scripts\backup.ps1
# Use the SESSION pooler / direct connection string from Supabase: Project settings > Database > Connection string.
# The file it makes holds people's emails: keep it private (never in GitHub, never in a shared folder).
param(
  [string]$DbUrl = $env:CIVICPULSE_DB_URL,
  [string]$OutDir = (Join-Path $HOME "CivicPulse-backups")
)
$ErrorActionPreference = "Stop"
if (-not $DbUrl) { throw "Set CIVICPULSE_DB_URL first (see the top of this file)." }
foreach ($tool in "pg_dump", "psql") { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool was not found. Install the PostgreSQL command-line tools first." } }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$file = Join-Path $OutDir ("civicpulse-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".sql")

# Data only (the structure comes from supabase/setup_all.sql). All of the public tables, plus the sign-in accounts that reports point at.
& pg_dump $DbUrl --data-only --column-inserts --no-owner --no-privileges -t "public.*" -t "auth.users" -t "auth.identities" -f $file
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed. Check the connection string and password." }

$size = [math]::Round((Get-Item $file).Length / 1KB)
$inserts = (Select-String -Path $file -Pattern "^INSERT INTO " -SimpleMatch:$false).Count
Write-Host "Backup written: $file ($size KB, $inserts rows)"
Write-Host "A backup is only proven when it has been restored. Run .\scripts\restore-check.ps1 on it (see docs/backup-restore.md)."
