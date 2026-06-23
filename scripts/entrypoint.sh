#!/bin/sh
# Almirant Self-Hosted - Container entrypoint
# Responsibilities:
#   1. Generate BETTER_AUTH_SECRET if not set and persist to /data/secrets/auth.secret
#   2. Wait for Postgres to be ready
#   3. Run database migrations (fail-fast on error)
#   4. Exec the main process (passed as $@)

set -e

SECRETS_DIR="/data/secrets"
AUTH_SECRET_FILE="$SECRETS_DIR/auth.secret"

# --- Step 1: Ensure BETTER_AUTH_SECRET ---
if [ -z "$BETTER_AUTH_SECRET" ]; then
  mkdir -p "$SECRETS_DIR"
  if [ ! -f "$AUTH_SECRET_FILE" ]; then
    echo "[entrypoint] Generating new BETTER_AUTH_SECRET..."
    openssl rand -hex 24 > "$AUTH_SECRET_FILE"
    chmod 600 "$AUTH_SECRET_FILE"
  fi
  export BETTER_AUTH_SECRET="$(cat "$AUTH_SECRET_FILE")"
  echo "[entrypoint] Using persisted BETTER_AUTH_SECRET from $AUTH_SECRET_FILE"
else
  echo "[entrypoint] Using BETTER_AUTH_SECRET from environment"
fi

# --- Step 2: Wait for Postgres ---
if [ -n "$DATABASE_URL" ]; then
  echo "[entrypoint] Waiting for Postgres to be ready..."
  MAX_ATTEMPTS=30
  ATTEMPT=0
  until pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; do
    ATTEMPT=$((ATTEMPT + 1))
    if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
      echo "[entrypoint] ERROR: Postgres not ready after $MAX_ATTEMPTS attempts"
      exit 1
    fi
    sleep 1
  done
  echo "[entrypoint] Postgres is ready"
fi

# --- Step 3: Run migrations (fail-fast) ---
if [ -f "/app/backend/packages/database/package.json" ]; then
  echo "[entrypoint] Running database migrations..."
  cd /app/backend/packages/database
  if ! bun run db:migrate:prod; then
    echo "[entrypoint] ERROR: Migration failed. Container will not start."
    echo "[entrypoint] This is intentional — starting with an inconsistent DB can corrupt data."
    echo "[entrypoint] Check logs above, restore from backup if needed, and file an issue."
    exit 1
  fi
  echo "[entrypoint] Migrations applied successfully"
  cd /app
fi

# --- Step 4: Exec main process ---
echo "[entrypoint] Starting Almirant..."
exec "$@"
