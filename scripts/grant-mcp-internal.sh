#!/usr/bin/env bash
#
# Grant mcp:internal to an API key (runner) idempotently.
#
# Usage:
#   DATABASE_URL=postgresql://... ./scripts/grant-mcp-internal.sh --list
#   DATABASE_URL=postgresql://... ./scripts/grant-mcp-internal.sh --key-id <uuid>
#   DATABASE_URL=postgresql://... ./scripts/grant-mcp-internal.sh --name runner
#   DATABASE_URL=postgresql://... ./scripts/grant-mcp-internal.sh --prefix alm_k1_
#
# Flags:
#   --list             List candidate API keys (runner/worker/bot) and exit.
#   --key-id <uuid>    Target a specific key by primary-key id.
#   --name <substr>    Match api_keys.name ILIKE '%<substr>%' (must be unique).
#   --prefix <str>     Match api_keys.key_prefix = '<str>' (must be unique).
#   --dry-run          Print the UPDATE statement without executing it.
#   --yes              Skip the confirmation prompt.
#   -h, --help         Show this help.
#
# Behaviour:
#   - Idempotent: if the key already has mcp:internal, nothing is written.
#   - Only modifies a single row (enforced by exact id match).
#   - Prints before/after state so the operator can verify.

set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found in PATH" >&2
  exit 1
fi

DB_URL="${DATABASE_URL:-}"
MODE=""
SELECTOR=""
DRY_RUN=0
ASSUME_YES=0

print_usage() {
  sed -n '1,22p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list)     MODE="list"; shift ;;
    --key-id)   MODE="id";     SELECTOR="${2:?--key-id requires a value}"; shift 2 ;;
    --name)     MODE="name";   SELECTOR="${2:?--name requires a value}";   shift 2 ;;
    --prefix)   MODE="prefix"; SELECTOR="${2:?--prefix requires a value}"; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --yes)      ASSUME_YES=1; shift ;;
    -h|--help)  print_usage; exit 0 ;;
    *)          echo "error: unknown arg '$1'" >&2; print_usage; exit 2 ;;
  esac
done

if [[ -z "$DB_URL" ]]; then
  echo "error: DATABASE_URL env var is required" >&2
  echo "hint: export DATABASE_URL=postgresql://user:pass@host:port/db" >&2
  exit 2
fi

if [[ -z "$MODE" ]]; then
  echo "error: specify one of --list | --key-id | --name | --prefix" >&2
  print_usage
  exit 2
fi

psql_q() {
  PGOPTIONS='--client-min-messages=warning' \
    psql "$DB_URL" --no-psqlrc --quiet --tuples-only --no-align --field-separator='|' -c "$1"
}

psql_table() {
  PGOPTIONS='--client-min-messages=warning' \
    psql "$DB_URL" --no-psqlrc --quiet --expanded -c "$1"
}

if [[ "$MODE" == "list" ]]; then
  echo "Candidate API keys (runner/worker/bot):"
  psql_table "
    SELECT id, name, key_prefix, allowed_issued_permissions, created_at
    FROM api_keys
    WHERE name ILIKE '%runner%'
       OR name ILIKE '%worker%'
       OR name ILIKE '%bot%'
       OR key_prefix ILIKE 'alm_k1_%'
    ORDER BY created_at DESC
    LIMIT 20;
  "
  exit 0
fi

sql_escape() { printf "%s" "$1" | sed "s/'/''/g"; }

ESCAPED="$(sql_escape "$SELECTOR")"
case "$MODE" in
  id)     WHERE_CLAUSE="id = '${ESCAPED}'::uuid" ;;
  name)   WHERE_CLAUSE="name ILIKE '%${ESCAPED}%'" ;;
  prefix) WHERE_CLAUSE="key_prefix = '${ESCAPED}'" ;;
esac

COUNT="$(psql_q "SELECT COUNT(*) FROM api_keys WHERE ${WHERE_CLAUSE};")"
COUNT="${COUNT//[[:space:]]/}"

if [[ "$COUNT" -eq 0 ]]; then
  echo "error: no api_keys row matches selector '${SELECTOR}' (mode=${MODE})" >&2
  exit 1
fi

if [[ "$COUNT" -gt 1 ]]; then
  echo "error: selector '${SELECTOR}' (mode=${MODE}) matches ${COUNT} rows — refine with --key-id" >&2
  echo "matches:" >&2
  psql_table "
    SELECT id, name, key_prefix, allowed_issued_permissions
    FROM api_keys
    WHERE ${WHERE_CLAUSE}
    LIMIT 10;
  " >&2
  exit 1
fi

echo "Target API key (before):"
psql_table "
  SELECT id, name, key_prefix, allowed_issued_permissions
  FROM api_keys
  WHERE ${WHERE_CLAUSE};
"

ALREADY="$(psql_q "SELECT 'mcp:internal' = ANY(allowed_issued_permissions) FROM api_keys WHERE ${WHERE_CLAUSE};")"
ALREADY="${ALREADY//[[:space:]]/}"
if [[ "$ALREADY" == "t" ]]; then
  echo "noop: key already has mcp:internal"
  exit 0
fi

UPDATE_SQL="UPDATE api_keys
SET allowed_issued_permissions = (
  SELECT ARRAY(
    SELECT DISTINCT unnest(
      COALESCE(allowed_issued_permissions, ARRAY['mcp:read','mcp:write']::text[])
      || ARRAY['mcp:internal']::text[]
    )
  )
)
WHERE ${WHERE_CLAUSE};"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "--- dry-run: would execute ---"
  echo "$UPDATE_SQL"
  exit 0
fi

if [[ "$ASSUME_YES" -ne 1 ]]; then
  printf 'proceed with UPDATE? [y/N] '
  read -r ANSWER
  case "$ANSWER" in
    y|Y|yes|YES) ;;
    *) echo "aborted"; exit 1 ;;
  esac
fi

psql_q "BEGIN; ${UPDATE_SQL} COMMIT;" >/dev/null

echo "Target API key (after):"
psql_table "
  SELECT id, name, key_prefix, allowed_issued_permissions
  FROM api_keys
  WHERE ${WHERE_CLAUSE};
"

echo "done: mcp:internal granted"
