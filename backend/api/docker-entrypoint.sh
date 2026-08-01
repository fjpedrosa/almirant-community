#!/bin/sh

set -eu

DATABASE_MIGRATIONS_DIR="${DATABASE_MIGRATIONS_DIR:-/app/backend/packages/database}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[api-entrypoint] ERROR: DATABASE_URL is required to run migrations." >&2
  exit 1
fi

echo "[api-entrypoint] Running validated database migrations..."
migration_pid=""

forward_signal() {
  signal="$1"
  if [ -n "$migration_pid" ]; then
    kill -"$signal" "$migration_pid" 2>/dev/null || true
  fi
}

trap 'forward_signal TERM' TERM
trap 'forward_signal INT' INT

(
  cd "$DATABASE_MIGRATIONS_DIR"
  exec env NODE_ENV=production bun run src/scripts/migrate-with-validation.ts
) &
migration_pid=$!

set +e
wait "$migration_pid"
migration_status=$?
set -e

migration_pid=""
trap - TERM INT

if [ "$migration_status" -ne 0 ]; then
  echo "[api-entrypoint] ERROR: Database migration failed with exit code $migration_status." >&2
  exit "$migration_status"
fi

echo "[api-entrypoint] Database migrations completed."

exec "$@"
