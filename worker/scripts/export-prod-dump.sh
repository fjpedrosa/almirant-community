#!/bin/sh
set -eu

# Export a production Postgres dump for local worker seeding.
# Usage:
#   PROD_DATABASE_URL='postgresql://...' ./worker/scripts/export-prod-dump.sh
# Optional:
#   DUMP_FORMAT=custom|plain (default: custom)
#   OUTPUT_FILE=worker/seeds/production.dump or worker/seeds/production.sql

PROD_DATABASE_URL="${PROD_DATABASE_URL:-}"
if [ -z "$PROD_DATABASE_URL" ]; then
  echo "[export-prod-dump] missing PROD_DATABASE_URL"
  exit 1
fi

DUMP_FORMAT="${DUMP_FORMAT:-custom}"
OUTPUT_FILE="${OUTPUT_FILE:-}"

mkdir -p worker/seeds

if [ -z "$OUTPUT_FILE" ]; then
  if [ "$DUMP_FORMAT" = "plain" ]; then
    OUTPUT_FILE="worker/seeds/production.sql"
  else
    OUTPUT_FILE="worker/seeds/production.dump"
  fi
fi

if [ "$DUMP_FORMAT" = "plain" ]; then
  echo "[export-prod-dump] exporting plain SQL to $OUTPUT_FILE"
  pg_dump "$PROD_DATABASE_URL" --no-owner --no-privileges --file "$OUTPUT_FILE"
else
  echo "[export-prod-dump] exporting custom dump to $OUTPUT_FILE"
  pg_dump "$PROD_DATABASE_URL" --format=custom --no-owner --no-privileges --file "$OUTPUT_FILE"
fi

echo "[export-prod-dump] done"
