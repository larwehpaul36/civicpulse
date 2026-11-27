# Backups and a tested restore (build 13)

A backup nobody has restored is a hope, not a backup. This is the free way. The Supabase free plan does not give you downloadable backups, so you make your own.

## What is and is not covered
- **Covered:** every table (reports, confirmations, replies, moderators, offices...) and the sign-in accounts those reports point to.
- **Not covered:** the **photos** (they live in Supabase Storage, not in the database). See "Photos" below.
- The backup file contains **emails**. Keep it private: not in GitHub, not in a shared folder. An encrypted USB stick or private drive is fine.

## One-time setup
1. Install the PostgreSQL command-line tools on your computer (the PostgreSQL installer from postgresql.org; tick "Command Line Tools"; add its `bin` folder to PATH). Check: `pg_dump --version` in a new PowerShell.
2. Supabase → Project settings → Database → Connection string → copy the **Session pooler** URI and put your database password in it.
3. In PowerShell: `$env:CIVICPULSE_DB_URL = "postgresql://postgres.xxxx:PASSWORD@....pooler.supabase.com:5432/postgres"` (this lasts for that window only; do not save it in a file in the repo).

## Make a backup
`.\scripts\backup.ps1`
It writes `civicpulse-YYYYMMDD-HHMM.sql` into `Documents-or-home\CivicPulse-backups` and says how many rows it holds. Do it **weekly**, and **before every migration**.

## Prove it restores (do this once now, then every 3 months)
1. Make a **new, empty, free Supabase project** called `civicpulse-restore-test` (it never goes live).
2. In its SQL editor run `supabase/setup_all.sql` (this builds the empty structure).
3. Copy its connection string (session pooler) the same way.
4. `.\scripts\restore-check.ps1 -BackupFile "C:\...\civicpulse-20261125-2100.sql" -TargetUrl "postgresql://...restore-test..."`
5. It prints each table: live rows against restored rows. "same" everywhere is a pass. A few extra live rows made since the backup is normal. A table with **0 restored** that has rows live is a failure: tell me the table.
6. Write the date and result at the bottom of this file. Then pause or delete the test project.
The script refuses to run if the target is the live project.

## If the real thing is ever lost
1. New Supabase project, run `supabase/setup_all.sql`, then `restore-check.ps1` (it is also the restore) with your newest backup.
2. Point Vercel's `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at the new project and redeploy; re-add the moderators; re-set the sign-in email and captcha settings (docs/email-signin-setup.md, docs/turnstile-setup.md).
3. People who signed in with email keep their accounts (users were restored); anonymous accounts on phones will work as before only if their sessions were backed up, otherwise they report as new people.

## Photos
Supabase → Project settings → Storage → S3 connection gives access keys. With the AWS command line installed: `aws s3 sync s3://issue-photos .\CivicPulse-photos --endpoint-url <the S3 endpoint shown there>` (set the keys with `aws configure`). Run it monthly. I have not tested this part against your project; try it once and tell me what you see.

## Restore tests log
| Date | Backup file | Result |
|------|-------------|--------|
| (not yet done) | | |

## How I tested this here
The same `pg_dump` and `psql` commands run in `tests/backup_restore_sandbox.sh` on two throwaway databases: dump, restore into an empty copy of the structure, compare counts, check that triggers did not make duplicate history rows, and that text with quotes and commas survives. The PowerShell wrappers are straight translations that I could not run on Windows.
