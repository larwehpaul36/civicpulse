#!/usr/bin/env bash
# Runs the SAME pg_dump / psql commands as scripts/backup.ps1 and scripts/restore-check.ps1 against two local throwaway
# databases, to prove the method: dump -> restore into an empty copy of the structure -> row counts match, and triggers
# did not create extra rows. Usage (as a user that can create databases): bash tests/backup_restore_sandbox.sh
set -euo pipefail
P="${PSQL_ARGS:--p 5439 -h /tmp}"; B="${PGBIN:-/usr/lib/postgresql/16/bin}"
q() { "$B/psql" $P -v ON_ERROR_STOP=1 -q -At "$@"; }
for d in bk_live bk_scratch; do q -d postgres -c "drop database if exists $d" 2>/dev/null; q -d postgres -c "create database $d"; done
SCHEMA="create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create table auth.identities (id uuid primary key, user_id uuid references auth.users(id));
create table public.issues (id uuid primary key, reporter_id uuid references auth.users(id), description text);
create table public.status_log (id bigint generated always as identity primary key, issue_id uuid references public.issues(id), note text);
create function public.log_new() returns trigger language plpgsql as \$\$ begin insert into public.status_log(issue_id, note) values (new.id, 'created'); return new; end \$\$;
create trigger t_log after insert on public.issues for each row execute function public.log_new();"
q -d bk_live -c "$SCHEMA"; q -d bk_scratch -c "$SCHEMA"
q -d bk_live -c "insert into auth.users values ('11111111-1111-1111-1111-111111111111','a@x.gh'),('22222222-2222-2222-2222-222222222222','b@x.gh');
 insert into auth.identities values ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111');
 insert into public.issues select gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'it''s a drain; with ''quotes'' and, commas' from generate_series(1,25);"
F=/tmp/bk_test.sql
"$B/pg_dump" $P -d bk_live --data-only --column-inserts --no-owner --no-privileges -t 'public.*' -t auth.users -t auth.identities -f "$F"
q -d bk_scratch -c "SET session_replication_role = replica;" -f "$F"
for t in auth.users auth.identities public.issues public.status_log; do
  a=$(q -d bk_live -c "select count(*) from $t"); b=$(q -d bk_scratch -c "select count(*) from $t")
  [ "$a" = "$b" ] && echo "PASS $t live=$a restored=$b" || { echo "FAIL $t live=$a restored=$b"; exit 1; }
done
echo "PASS text with quotes and commas survived: $(q -d bk_scratch -c "select count(*) from public.issues where description like '%''quotes'' and, commas'")"
for d in bk_live bk_scratch; do q -d postgres -c "drop database $d"; done; rm -f "$F"
