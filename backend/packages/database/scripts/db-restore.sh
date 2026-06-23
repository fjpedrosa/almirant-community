#!/bin/sh
set -eu

# Restores a sanitized snapshot into the local development database.
#
# Usage:
#   bun run db:restore                           # Restores the latest almirant-dev-*.sql snapshot
#   bun run db:restore path/to/snapshot.sql       # Restores a specific snapshot file
#
# Environment:
#   DATABASE_URL   Override the default local dev connection string.
#   SKIP_CONFIRM   Set to "true" to skip the confirmation prompt.

# ─── Dependency check ────────────────────────────────────────────────────────

for cmd in psql createdb; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[db:restore] ERROR: $cmd not found in PATH"
    echo "[db:restore] Install PostgreSQL client tools or add them to your PATH."
    exit 1
  fi
done

# ─── Configuration ───────────────────────────────────────────────────────────

DEFAULT_DATABASE_URL="postgresql://crm_user:crm_password@localhost:5432/crm_db"
DATABASE_URL="${DATABASE_URL:-$DEFAULT_DATABASE_URL}"
SKIP_CONFIRM="${SKIP_CONFIRM:-false}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SNAPSHOTS_DIR="$SCRIPT_DIR/../snapshots"

SNAPSHOT_FILE="${1:-}"

# ─── Resolve snapshot file ───────────────────────────────────────────────────

if [ -z "$SNAPSHOT_FILE" ]; then
  if [ ! -d "$SNAPSHOTS_DIR" ]; then
    echo "[db:restore] No snapshots directory found at: $SNAPSHOTS_DIR"
    exit 1
  fi

  # Find the most recent almirant-dev-*.sql snapshot
  SNAPSHOT_FILE=$(ls -t "$SNAPSHOTS_DIR"/almirant-dev-*.sql 2>/dev/null | head -n 1)

  # Fallback to legacy snapshot_*.sql naming
  if [ -z "$SNAPSHOT_FILE" ]; then
    SNAPSHOT_FILE=$(ls -t "$SNAPSHOTS_DIR"/snapshot_*.sql 2>/dev/null | head -n 1)
  fi

  if [ -z "$SNAPSHOT_FILE" ]; then
    echo "[db:restore] No snapshots found in: $SNAPSHOTS_DIR"
    echo "[db:restore] Run 'bun run db:snapshot' first to create one."
    exit 1
  fi

  echo "[db:restore] Latest snapshot: $(basename "$SNAPSHOT_FILE")"
fi

if [ ! -f "$SNAPSHOT_FILE" ]; then
  echo "[db:restore] File not found: $SNAPSHOT_FILE"
  exit 1
fi

# ─── Confirmation ────────────────────────────────────────────────────────────

FILESIZE=$(wc -c < "$SNAPSHOT_FILE" | tr -d ' ')
FILESIZE_KB=$((FILESIZE / 1024))
FILESIZE_MB=$((FILESIZE / 1024 / 1024))

echo "[db:restore] File: $SNAPSHOT_FILE"
if [ "$FILESIZE_MB" -gt 0 ]; then
  echo "[db:restore] Size: ${FILESIZE_MB} MB"
else
  echo "[db:restore] Size: ${FILESIZE_KB} KB"
fi
echo "[db:restore] Target: ${DATABASE_URL%%@*}@***"
echo ""
echo "[db:restore] WARNING: This will DROP and recreate all tables in the target database."

if [ "$SKIP_CONFIRM" != "true" ]; then
  printf "[db:restore] Continue? (y/N) "
  read -r REPLY
  case "$REPLY" in
    [yY]|[yY][eE][sS]) ;;
    *)
      echo "[db:restore] Aborted."
      exit 0
      ;;
  esac
fi

# ─── Restore ─────────────────────────────────────────────────────────────────

echo "[db:restore] Ensuring target database exists..."
createdb "$DATABASE_URL" 2>/dev/null || true

echo "[db:restore] Restoring database..."

psql "$DATABASE_URL" \
  --quiet \
  --set ON_ERROR_STOP=1 \
  --file "$SNAPSHOT_FILE"

echo "[db:restore] Done. Database restored from snapshot."
