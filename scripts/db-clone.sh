#!/bin/sh
set -eu

# Clone data from one Postgres environment into another.
# Usage:
#   SOURCE_DATABASE_URL='postgresql://...' \
#   TARGET_DATABASE_URL='postgresql://...' \
#   bun run db:clone
#
# Optional:
#   DUMP_FILE=./tmp/db-clone.dump
#   CONFIRM_OVERWRITE=true

SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:-}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:-}"
DUMP_FILE="${DUMP_FILE:-./tmp/db-clone.dump}"
CONFIRM_OVERWRITE="${CONFIRM_OVERWRITE:-false}"

if [ -z "$SOURCE_DATABASE_URL" ]; then
  echo "[db:clone] missing SOURCE_DATABASE_URL"
  exit 1
fi

if [ -z "$TARGET_DATABASE_URL" ]; then
  echo "[db:clone] missing TARGET_DATABASE_URL"
  exit 1
fi

if [ "$SOURCE_DATABASE_URL" = "$TARGET_DATABASE_URL" ]; then
  echo "[db:clone] SOURCE_DATABASE_URL and TARGET_DATABASE_URL cannot be the same"
  exit 1
fi

if [ "$CONFIRM_OVERWRITE" != "true" ]; then
  echo "[db:clone] refusing to continue without explicit confirmation"
  echo "[db:clone] set CONFIRM_OVERWRITE=true to overwrite target database"
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[db:clone] pg_dump not found in PATH"
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "[db:clone] pg_restore not found in PATH"
  exit 1
fi

mkdir -p "$(dirname "$DUMP_FILE")"

echo "[db:clone] creating dump: $DUMP_FILE"
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "$DUMP_FILE"

echo "[db:clone] restoring into target database"
pg_restore \
  --dbname "$TARGET_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$DUMP_FILE"

echo "[db:clone] done"
