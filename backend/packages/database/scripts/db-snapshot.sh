#!/bin/sh
set -eu

# Creates a sanitized SQL snapshot from the PRODUCTION database for local dev use.
#
# Workflow:
#   1. Dumps production DB with pg_dump
#   2. Restores into a temporary database (crm_db_sanitize)
#   3. Runs sanitization SQL (truncate ephemeral tables, mask PII, null secrets)
#   4. Dumps the sanitized temp DB to file
#   5. Drops the temp database
#
# Usage:
#   PRODUCTION_DATABASE_URL="postgresql://..." bun run db:snapshot
#
# Environment:
#   PRODUCTION_DATABASE_URL  (required) Connection string for the production database.
#   LOCAL_DATABASE_URL       (optional) Local PostgreSQL for the temp sanitize DB.
#                            Defaults to postgresql://crm_user:crm_password@localhost:5432/postgres

# ─── Dependency check ────────────────────────────────────────────────────────

check_deps() {
  MISSING=""
  for cmd in pg_dump psql createdb dropdb; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      MISSING="$MISSING $cmd"
    fi
  done
  if [ -n "$MISSING" ]; then
    echo "[db:snapshot] ERROR: Missing required commands:$MISSING"
    echo "[db:snapshot] Install PostgreSQL client tools or add them to your PATH."
    exit 1
  fi
}

check_deps

# ─── Configuration ───────────────────────────────────────────────────────────

if [ -z "${PRODUCTION_DATABASE_URL:-}" ]; then
  echo "[db:snapshot] ERROR: PRODUCTION_DATABASE_URL is required."
  echo "[db:snapshot] Usage: PRODUCTION_DATABASE_URL=\"postgresql://...\" bun run db:snapshot"
  exit 1
fi

# Local PostgreSQL connection for creating the temp sanitize database.
# We connect to the "postgres" maintenance DB to issue CREATE/DROP DATABASE.
DEFAULT_LOCAL_URL="postgresql://crm_user:crm_password@localhost:5432/postgres"
LOCAL_MAINTENANCE_URL="${LOCAL_DATABASE_URL:-$DEFAULT_LOCAL_URL}"

TEMP_DB="crm_db_sanitize"
TEMP_DB_URL="$(echo "$LOCAL_MAINTENANCE_URL" | sed "s|/[^/]*$|/$TEMP_DB|")"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SNAPSHOTS_DIR="$SCRIPT_DIR/../snapshots"
mkdir -p "$SNAPSHOTS_DIR"

DATE_STAMP="$(date +%Y-%m-%d)"
FILENAME="almirant-dev-${DATE_STAMP}.sql"
SNAPSHOT_PATH="$SNAPSHOTS_DIR/$FILENAME"

# Temporary file for the raw production dump
RAW_DUMP="$(mktemp /tmp/almirant-raw-dump-XXXXXX.sql)"

# ─── Cleanup on exit ─────────────────────────────────────────────────────────

cleanup() {
  echo "[db:snapshot] Cleaning up..."
  rm -f "$RAW_DUMP"
  # Drop the temp database (ignore errors if it doesn't exist)
  dropdb --if-exists --maintenance-db="$LOCAL_MAINTENANCE_URL" "$TEMP_DB" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ─── Step 1: Dump production ─────────────────────────────────────────────────

echo "[db:snapshot] Step 1/5: Dumping production database..."
echo "[db:snapshot]   Source: ${PRODUCTION_DATABASE_URL%%@*}@***"

pg_dump "$PRODUCTION_DATABASE_URL" \
  --format=plain \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --no-comments \
  --file "$RAW_DUMP"

RAW_SIZE=$(wc -c < "$RAW_DUMP" | tr -d ' ')
RAW_SIZE_MB=$((RAW_SIZE / 1024 / 1024))
echo "[db:snapshot]   Raw dump size: ${RAW_SIZE_MB} MB"

# ─── Step 2: Create temp database and restore ────────────────────────────────

echo "[db:snapshot] Step 2/5: Creating temporary database '$TEMP_DB'..."

# Drop if leftover from a previous failed run
dropdb --if-exists --maintenance-db="$LOCAL_MAINTENANCE_URL" "$TEMP_DB" 2>/dev/null || true
createdb --maintenance-db="$LOCAL_MAINTENANCE_URL" "$TEMP_DB"

echo "[db:snapshot]   Restoring production dump into temp database..."
psql "$TEMP_DB_URL" \
  --quiet \
  --file "$RAW_DUMP" \
  2>&1 | grep -v "^ERROR:.*does not exist" | grep -v "^DROP" || true

# ─── Step 3: Sanitize ────────────────────────────────────────────────────────

echo "[db:snapshot] Step 3/5: Sanitizing data..."

psql "$TEMP_DB_URL" --quiet --set ON_ERROR_STOP=0 <<'SANITIZE_SQL'

-- ============================================================================
-- TRUNCATE EPHEMERAL TABLES
-- Tables that hold transient/session data with no value for development.
-- ============================================================================

TRUNCATE TABLE "session" CASCADE;
TRUNCATE TABLE "verification" CASCADE;
TRUNCATE TABLE "oauth_states" CASCADE;
TRUNCATE TABLE "telegram_link_codes" CASCADE;
TRUNCATE TABLE "waitlist_email_tokens" CASCADE;
TRUNCATE TABLE "notification_queue" CASCADE;
TRUNCATE TABLE "webhook_logs" CASCADE;

-- ============================================================================
-- TIER 1: AUTH SECRETS
-- Null out OAuth tokens and set passwords to a known bcrypt hash.
-- Hash = bcrypt('dev-password-123') with cost 10
-- ============================================================================

UPDATE "account"
SET
  access_token = NULL,
  refresh_token = NULL,
  id_token = NULL,
  password = CASE
    WHEN password IS NOT NULL
    THEN '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
    ELSE NULL
  END;

-- ============================================================================
-- TIER 2: APPLICATION SECRETS
-- API keys, encrypted credentials, webhook URLs, etc.
-- ============================================================================

-- api_keys: replace hash with a placeholder, keep prefix for identification
UPDATE "api_keys"
SET key_hash = 'sanitized-placeholder-hash-for-dev-' || id::text;

-- provider_connections: null out encrypted credentials and related fields
UPDATE "provider_connections"
SET
  encrypted_credentials = NULL,
  credentials_iv = NULL,
  credentials_auth_tag = NULL;

-- webhooks: replace URLs with httpbin and clear headers
UPDATE "webhooks"
SET
  url = 'https://httpbin.org/post',
  headers = '{}';

-- ============================================================================
-- TIER 3: PERSONALLY IDENTIFIABLE INFORMATION (PII)
-- Anonymize user data, leads, and companies.
-- ============================================================================

-- user: anonymize email, name, and image
UPDATE "user"
SET
  name = 'Dev User ' || SUBSTRING(id, 1, 8),
  email = 'user-' || SUBSTRING(id, 1, 8) || '@dev.local',
  image = NULL;

-- leads: anonymize contact info
UPDATE "leads"
SET
  email = CASE WHEN email IS NOT NULL THEN 'lead-' || SUBSTRING(id::text, 1, 8) || '@dev.local' ELSE NULL END,
  phone = CASE WHEN phone IS NOT NULL THEN '+0000000' || SUBSTRING(id::text, 1, 4) ELSE NULL END;

-- companies: anonymize contact info
UPDATE "companies"
SET
  email = CASE WHEN email IS NOT NULL THEN 'company-' || SUBSTRING(id::text, 1, 8) || '@dev.local' ELSE NULL END,
  phone = CASE WHEN phone IS NOT NULL THEN '+0000000' || SUBSTRING(id::text, 1, 4) ELSE NULL END;

-- waitlist_users: anonymize email and name
UPDATE "waitlist_users"
SET
  email = 'waitlist-' || SUBSTRING(id::text, 1, 8) || '@dev.local',
  email_normalized = 'waitlist-' || SUBSTRING(id::text, 1, 8) || '@dev.local',
  name = CASE WHEN name IS NOT NULL THEN 'Waitlist User ' || SUBSTRING(id::text, 1, 8) ELSE NULL END;

-- telegram_accounts: anonymize usernames and names
UPDATE "telegram_accounts"
SET
  username = CASE WHEN username IS NOT NULL THEN 'dev_user_' || SUBSTRING(id::text, 1, 8) ELSE NULL END,
  first_name = CASE WHEN first_name IS NOT NULL THEN 'Dev' ELSE NULL END,
  last_name = CASE WHEN last_name IS NOT NULL THEN SUBSTRING(id::text, 1, 8) ELSE NULL END;

-- telegram_users: anonymize usernames and names
UPDATE "telegram_users"
SET
  username = CASE WHEN username IS NOT NULL THEN 'dev_user_' || SUBSTRING(id::text, 1, 8) ELSE NULL END,
  first_name = CASE WHEN first_name IS NOT NULL THEN 'Dev' ELSE NULL END,
  last_name = CASE WHEN last_name IS NOT NULL THEN SUBSTRING(id::text, 1, 8) ELSE NULL END;

SANITIZE_SQL

echo "[db:snapshot]   Sanitization complete."

# ─── Step 4: Dump sanitized database ─────────────────────────────────────────

echo "[db:snapshot] Step 4/5: Dumping sanitized database to file..."

pg_dump "$TEMP_DB_URL" \
  --format=plain \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --no-comments \
  --file "$SNAPSHOT_PATH"

# Strip connection-specific SET statements that cause issues across environments
if [ "$(uname)" = "Darwin" ]; then
  sed -i '' \
    -e '/^SET idle_in_transaction_session_timeout/d' \
    -e '/^SET lock_timeout/d' \
    -e '/^SET statement_timeout/d' \
    -e '/^SET row_security/d' \
    -e '/^SET xmloption/d' \
    "$SNAPSHOT_PATH"
else
  sed -i \
    -e '/^SET idle_in_transaction_session_timeout/d' \
    -e '/^SET lock_timeout/d' \
    -e '/^SET statement_timeout/d' \
    -e '/^SET row_security/d' \
    -e '/^SET xmloption/d' \
    "$SNAPSHOT_PATH"
fi

# ─── Step 5: Cleanup (handled by trap) ───────────────────────────────────────

echo "[db:snapshot] Step 5/5: Dropping temporary database..."
# (cleanup trap will handle this)

FILESIZE=$(wc -c < "$SNAPSHOT_PATH" | tr -d ' ')
FILESIZE_MB=$((FILESIZE / 1024 / 1024))
FILESIZE_KB=$((FILESIZE / 1024))

echo ""
echo "[db:snapshot] ✓ Snapshot saved: $SNAPSHOT_PATH"
if [ "$FILESIZE_MB" -gt 0 ]; then
  echo "[db:snapshot]   Size: ${FILESIZE_MB} MB"
else
  echo "[db:snapshot]   Size: ${FILESIZE_KB} KB"
fi
echo "[db:snapshot]   Ephemeral tables truncated: session, verification, oauth_states,"
echo "[db:snapshot]     telegram_link_codes, waitlist_email_tokens, notification_queue, webhook_logs"
echo "[db:snapshot]   Auth tokens: nulled"
echo "[db:snapshot]   Passwords: replaced with known hash (dev-password-123)"
echo "[db:snapshot]   API keys: placeholder hashes"
echo "[db:snapshot]   Provider credentials: nulled"
echo "[db:snapshot]   Webhook URLs: httpbin.org"
echo "[db:snapshot]   PII (users, leads, companies): anonymized"
echo "[db:snapshot] Done."
