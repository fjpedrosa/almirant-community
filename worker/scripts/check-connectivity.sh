#!/usr/bin/env bash
# check-connectivity.sh - Validate worker connectivity to backend
# Usage: bash worker/scripts/check-connectivity.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Almirant Worker Connectivity Check ==="
echo ""

# 1. Load .env if present
if [ -f "$WORKER_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$WORKER_DIR/.env"
  set +a
  echo "[OK] .env file found"
else
  echo "[WARN] No .env file found in $WORKER_DIR"
fi

# 2. Check MC_API_URL
if [ -z "${MC_API_URL:-}" ]; then
  echo "[FAIL] MC_API_URL is not set"
  exit 1
fi
echo "[OK] MC_API_URL = $MC_API_URL"

# 3. Check MC_API_KEY
if [ -z "${MC_API_KEY:-}" ]; then
  echo "[FAIL] MC_API_KEY is not set"
  exit 1
fi
echo "[OK] MC_API_KEY is set"

# 4. Check backend health endpoint
echo ""
echo "Checking backend health..."
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${MC_API_URL%/}/health" 2>/dev/null || echo "000")
if [ "$HEALTH_STATUS" = "200" ]; then
  echo "[OK] Backend is healthy (HTTP 200)"
else
  echo "[FAIL] Backend health check failed (HTTP $HEALTH_STATUS) — is the backend running?"
  exit 1
fi

# 5. Check queue adapter selection
echo ""
if [ -z "${REDIS_URL:-}" ]; then
  echo "[OK] REDIS_URL not set -> PostgreSQL adapter will be used (correct for local dev)"
else
  echo "[WARN] REDIS_URL is set ($REDIS_URL) -> BullMQ adapter will be used"
  echo "       Unset REDIS_URL if you want to use the PostgreSQL adapter instead"
fi

# 6. Run built-in validate (full check: git, repo path, disk space, provider keys)
echo ""
echo "Running built-in worker validation..."
cd "$WORKER_DIR"
bun run src/index.ts validate

echo ""
echo "=== Connectivity check complete ==="
