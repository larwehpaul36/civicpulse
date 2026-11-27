# Proves a backup works: loads it into a SCRATCH database and compares the row counts with the live one.
# Never point -TargetUrl at the live project. Use a new, empty free Supabase project (or a local Postgres) where
# supabase/setup_all.sql has already been run.
#   .\scripts\restore-check.ps1 -BackupFile C:\path\civicpulse-20261125-2100.sql -TargetUrl "postgresql://...scratch..." -SourceUrl $env:CIVICPULSE_DB_URL
param(
  [Parameter(Mandatory = $true)][string]$BackupFile,
  [Parameter(Mandatory = $true)][string]$TargetUrl,
  [string]$SourceUrl = $env:CIVICPULSE_DB_URL
)
$ErrorActionPreference = "Stop"
if ($SourceUrl -and $SourceUrl -eq $TargetUrl) { throw "Target and live are the same database. Stopping: use a scratch project." }
if (-not (Test-Path $BackupFile)) { throw "Backup file not found: $BackupFile" }

# session_replication_role = replica switches off triggers for this session only, so loading old rows does not make new history rows.
& psql $TargetUrl -v ON_ERROR_STOP=1 -q -c "SET session_replication_role = replica;" -f $BackupFile
if ($LASTEXITCODE -ne 0) { throw "The restore failed. The backup, or the scratch database's structure, is wrong." }

$tables = @("auth.users", "auth.identities") + (& psql $TargetUrl -At -c "select 'public.' || tablename from pg_tables where schemaname = 'public' order by 1")
$bad = 0
foreach ($t in $tables) {
  $restored = (& psql $TargetUrl -At -c "select count(*) from $t").Trim()
  if ($SourceUrl) {
    $live = (& psql $SourceUrl -At -c "select count(*) from $t").Trim()
    $note = if ($live -eq $restored) { "same" } else { "differs (live changed since the backup, or something is missing)"; $bad++ }
    "{0,-40} live {1,7}   restored {2,7}   {3}" -f $t, $live, $restored, $note
  } else {
    "{0,-40} restored {1,7}" -f $t, $restored
  }
}
if ($bad -gt 0) { Write-Warning "$bad table(s) differ. A few new rows since the backup is normal; a table with 0 restored is not." }
else { Write-Host "Restore check finished. Record the date in docs/backup-restore.md." }
