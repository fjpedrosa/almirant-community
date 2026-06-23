#!/bin/sh
set -eu

DB_URL="${DATABASE_URL:-postgresql://worker_user:worker_password@postgres:5432/worker_db}"

until pg_isready -d "$DB_URL" >/dev/null 2>&1; do
  sleep 1
done

table_count="$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d '[:space:]')"
if [ "${table_count:-0}" != "0" ]; then
  echo "[db-seed] public schema is not empty, skipping seed"
  exit 0
fi

if [ -f /seed/production.sql ]; then
  echo "[db-seed] applying /seed/production.sql"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f /seed/production.sql
  exit 0
fi

if [ -f /seed/production.dump ]; then
  echo "[db-seed] restoring /seed/production.dump"
  pg_restore --no-owner --no-privileges --clean --if-exists -d "$DB_URL" /seed/production.dump
  exit 0
fi

echo "[db-seed] no /seed/production.sql or /seed/production.dump found, skipping"
