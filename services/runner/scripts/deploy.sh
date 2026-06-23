#!/usr/bin/env bash
# deploy.sh - Deploy the Almirant runner to a VPS
#
# Usage:
#   ./scripts/deploy.sh                    # Deploy to default host (almirant-runner-1)
#   ./scripts/deploy.sh my-server          # Deploy to a custom host
#   ./scripts/deploy.sh user@1.2.3.4       # Deploy to an IP address
#
# Prerequisites:
#   - SSH access to the target host (key-based auth recommended)
#   - Docker and Docker Compose installed on the target
#   - Git repo cloned at /opt/almirant/repo on the target
#   - .env file configured at /opt/almirant/repo/services/runner/.env

set -euo pipefail

readonly DEFAULT_HOST="almirant-runner-1"
readonly REMOTE_REPO_PATH="/opt/almirant/repo"
readonly RUNNER_PATH="${REMOTE_REPO_PATH}/services/runner"
readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly HEALTH_ENDPOINT="http://127.0.0.1:3002/health"
readonly HEALTH_RETRIES=15
readonly HEALTH_INTERVAL=4

# Colors for output (disabled if not a terminal)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  GREEN='' RED='' YELLOW='' CYAN='' NC=''
fi

log()   { echo -e "${CYAN}[deploy]${NC} $*"; }
ok()    { echo -e "${GREEN}[  ok  ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[ warn ]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL  ]${NC} $*" >&2; exit 1; }

TARGET_HOST="${1:-$DEFAULT_HOST}"

log "Target host: ${TARGET_HOST}"
log "Remote path: ${RUNNER_PATH}"
echo ""

# --------------------------------------------------------------------------- #
# 1. Verify SSH connectivity
# --------------------------------------------------------------------------- #
log "Verifying SSH connectivity..."
if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "${TARGET_HOST}" "echo ok" >/dev/null 2>&1; then
  fail "Cannot connect to ${TARGET_HOST} via SSH. Check your SSH config and keys."
fi
ok "SSH connection established."

# --------------------------------------------------------------------------- #
# 2. Pull latest code
# --------------------------------------------------------------------------- #
log "Pulling latest code on remote..."
ssh "${TARGET_HOST}" bash -s <<'REMOTE_PULL'
  set -euo pipefail
  cd /opt/almirant/repo

  # Stash any local changes to avoid conflicts
  git stash --quiet 2>/dev/null || true

  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  echo "Branch: ${CURRENT_BRANCH}"

  git fetch --prune --quiet
  git pull --ff-only origin "${CURRENT_BRANCH}" || {
    echo "Fast-forward pull failed; attempting rebase..."
    git pull --rebase origin "${CURRENT_BRANCH}"
  }

  COMMIT=$(git log -1 --format='%h %s')
  echo "Latest commit: ${COMMIT}"
REMOTE_PULL
ok "Code updated on remote."

# --------------------------------------------------------------------------- #
# 3. Build shim images (if profiles exist)
# --------------------------------------------------------------------------- #
log "Building shim images (claude-shim, codex-shim, opencode-shim)..."
ssh "${TARGET_HOST}" RUNNER_PATH="${RUNNER_PATH}" COMPOSE_FILE="${COMPOSE_FILE}" bash -s <<'REMOTE_SHIMS'
  set -euo pipefail
  cd "${RUNNER_PATH}"

  # Build shim images if their Dockerfiles exist. Keep this list in sync with
  # services/runner/docker-compose.prod.yml so runtime selection never falls
  # back to pulling private GHCR images in self-hosted installs.
  if [ -f ../runner-claude/Dockerfile ]; then
    docker compose -f "${COMPOSE_FILE}" --profile shims build claude-shim 2>&1 | tail -3
  fi
  if [ -f docker/Dockerfile.codex ]; then
    docker compose -f "${COMPOSE_FILE}" --profile shims build codex-shim 2>&1 | tail -3
  fi
  if [ -f docker/Dockerfile.opencode ]; then
    docker compose -f "${COMPOSE_FILE}" --profile shims build opencode-shim 2>&1 | tail -3
  fi
REMOTE_SHIMS
ok "Shim images built."

# --------------------------------------------------------------------------- #
# 4. Build runner image
# --------------------------------------------------------------------------- #
log "Building runner image..."
ssh "${TARGET_HOST}" RUNNER_PATH="${RUNNER_PATH}" COMPOSE_FILE="${COMPOSE_FILE}" bash -s <<'REMOTE_BUILD'
  set -euo pipefail
  cd "${RUNNER_PATH}"
  docker compose -f "${COMPOSE_FILE}" build runner 2>&1 | tail -5
REMOTE_BUILD
ok "Runner image built."

# --------------------------------------------------------------------------- #
# 5. Restart services
# --------------------------------------------------------------------------- #
log "Restarting runner services..."
ssh "${TARGET_HOST}" RUNNER_PATH="${RUNNER_PATH}" COMPOSE_FILE="${COMPOSE_FILE}" bash -s <<'REMOTE_UP'
  set -euo pipefail
  cd "${RUNNER_PATH}"
  docker compose -f "${COMPOSE_FILE}" up -d runner 2>&1
REMOTE_UP
ok "Runner services started."

# --------------------------------------------------------------------------- #
# 6. Health check
# --------------------------------------------------------------------------- #
log "Waiting for runner health check (up to $((HEALTH_RETRIES * HEALTH_INTERVAL))s)..."

HEALTHY=false
for _ in $(seq 1 "${HEALTH_RETRIES}"); do
  if ssh "${TARGET_HOST}" HEALTH_ENDPOINT="${HEALTH_ENDPOINT}" 'curl -fsS "${HEALTH_ENDPOINT}"' >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  echo -n "."
  sleep "${HEALTH_INTERVAL}"
done
echo ""

if [ "${HEALTHY}" = true ]; then
  ok "Runner is healthy!"
else
  warn "Runner health check failed after $((HEALTH_RETRIES * HEALTH_INTERVAL))s."
  warn "Check logs: ssh ${TARGET_HOST} 'cd ${RUNNER_PATH} && docker compose -f ${COMPOSE_FILE} logs --tail 50 runner'"
  exit 1
fi

# --------------------------------------------------------------------------- #
# 7. Print status
# --------------------------------------------------------------------------- #
echo ""
log "Deployment summary:"
ssh "${TARGET_HOST}" RUNNER_PATH="${RUNNER_PATH}" COMPOSE_FILE="${COMPOSE_FILE}" HEALTH_ENDPOINT="${HEALTH_ENDPOINT}" bash -s <<'REMOTE_STATUS'
  set -euo pipefail
  cd "${RUNNER_PATH}"

  echo "--- Container status ---"
  docker compose -f "${COMPOSE_FILE}" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || \
    docker compose -f "${COMPOSE_FILE}" ps

  echo ""
  echo "--- Latest commit ---"
  cd /opt/almirant/repo
  git log -1 --format='%H %ai %s'

  echo ""
  echo "--- Health ---"
  curl -fsS "${HEALTH_ENDPOINT}" 2>/dev/null || echo "(health endpoint not reachable)"
REMOTE_STATUS

echo ""
ok "Deployment complete."
