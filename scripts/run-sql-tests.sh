#!/usr/bin/env bash
# Runs every self-contained SQL test (the *_stub_test.sql files) against a Postgres you point it at.
# Each test gets its own throwaway database, and the cluster-wide roles the tests create (anon, authenticated, service_role)
# are dropped afterwards, so the tests cannot collide with one another.
#   Local:  PGHOST=localhost PGUSER=postgres bash scripts/run-sql-tests.sh        (needs a Postgres you do not mind using)
#   CI:     see .github/workflows/ci.yml (job "sql")
# NEVER point this at your real Supabase database: it creates and drops roles and databases.
# Not included: tests/schema_smoke_test.sql (it needs PostGIS and prints results instead of failing).
set -u
cd "$(dirname "$0")/.."
case "${PGHOST:-}" in *supabase*) echo "Refusing to run against a Supabase host."; exit 2;; esac
fail=0
for f in tests/*_stub_test.sql; do
  db="sqltest_$(basename "$f" .sql | tr -c 'a-zA-Z0-9\n' '_')"
  dropdb --if-exists "$db" >/dev/null 2>&1
  createdb "$db" || { echo "FAIL  $f (could not create database)"; fail=1; continue; }
  if out=$(psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$f" 2>&1); then
    n=$(printf '%s\n' "$out" | grep -c 'PASS'); echo "PASS  $f${n:+  ($n checks printed)}" | sed 's/  (0 checks printed)//'
  else
    echo "FAIL  $f"; printf '%s\n' "$out" | grep -E "FAIL|ERROR" | head -5; fail=1
  fi
  dropdb --if-exists "$db" >/dev/null 2>&1
  for r in anon authenticated service_role; do psql -q -d postgres -c "drop role if exists $r" >/dev/null 2>&1; done
done
exit $fail
