#!/usr/bin/env bash
# =============================================================================
# Almirant Production Deployment Script
# =============================================================================
# Usage:
#   ./scripts/deploy.sh              # Deploy all services
#   ./scripts/deploy.sh backend      # Deploy only backend
#   ./scripts/deploy.sh frontend     # Deploy only frontend
#   ./scripts/deploy.sh --rollback   # Rollback to previous image
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - .env.production configured at the repo root
#   - Git remote 'origin' configured

set -euo pipefail

# -- Config ------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$REPO_DIR/docker-compose.prod.yml"
ENV_FILE="$REPO_DIR/.env.production"
SERVICE="${1:-}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/almirant-deploy-$TIMESTAMP.log"

# -- Colors ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

# -- Checks ------------------------------------------------------------------
check_prerequisites() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed"
  command -v docker compose >/dev/null 2>&1 || fail "Docker Compose is not installed"

  [ -f "$COMPOSE_FILE" ] || fail "docker-compose.prod.yml not found at $COMPOSE_FILE"
  [ -f "$ENV_FILE" ] || fail ".env.production not found at $ENV_FILE. Copy from .env.production.example"
}

# -- Git Pull ----------------------------------------------------------------
pull_latest() {
  log "Pulling latest code from git..."
  cd "$REPO_DIR"
  git fetch origin main
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/main)

  if [ "$LOCAL" = "$REMOTE" ]; then
    warn "Already up to date ($(git rev-parse --short HEAD))"
  else
    git pull origin main
    log "Updated to $(git rev-parse --short HEAD)"
  fi
}

# -- Build & Deploy ----------------------------------------------------------
deploy_services() {
  local target="${1:-}"

  if [ -z "$target" ]; then
    log "Building and deploying all services..."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build 2>&1 | tee -a "$LOG_FILE"
  else
    log "Building and deploying service: $target"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build "$target" 2>&1 | tee -a "$LOG_FILE"
  fi
}

# -- Health Check ------------------------------------------------------------
wait_for_healthy() {
  local service="${1:-backend}"
  local max_attempts=30
  local attempt=0

  log "Waiting for $service to be healthy..."
  while [ $attempt -lt $max_attempts ]; do
    status=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --format json "$service" 2>/dev/null | \
      python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('Health','unknown'))" 2>/dev/null || echo "unknown")

    if [ "$status" = "healthy" ]; then
      log "$service is healthy"
      return 0
    fi

    attempt=$((attempt + 1))
    echo -n "."
    sleep 2
  done

  echo ""
  warn "$service did not become healthy within 60s"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=20 "$service"
  return 1
}

# -- Verify deployment -------------------------------------------------------
verify_deployment() {
  log "Verifying deployment..."

  PROXY_PORT=$(grep -m1 "^PROXY_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "8080")
  LOCAL_PROXY_URL="http://127.0.0.1:${PROXY_PORT}"

  if curl -sf "$LOCAL_PROXY_URL/mcp/health" >/dev/null 2>&1; then
    log "Backend MCP health check passed through the local proxy"
  else
    warn "Proxy/MCP health check failed - check logs: docker compose --env-file .env.production -f docker-compose.prod.yml logs"
  fi

  echo ""
  log "Service status:"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
}

# -- Rollback ----------------------------------------------------------------
rollback() {
  warn "Rolling back to previous git commit..."
  cd "$REPO_DIR"
  git log --oneline -5
  echo ""
  read -r -p "Enter the commit hash to rollback to: " COMMIT
  git checkout "$COMMIT"
  deploy_services
  verify_deployment
}

# -- Main --------------------------------------------------------------------
main() {
  echo "================================================"
  echo " Almirant Production Deployment"
  echo " $(date)"
  echo "================================================"
  echo ""

  check_prerequisites

  if [ "$SERVICE" = "--rollback" ]; then
    rollback
    exit 0
  fi

  pull_latest
  deploy_services "$SERVICE"

  if [ -z "$SERVICE" ] || [ "$SERVICE" = "backend" ]; then
    wait_for_healthy "backend" || true
  fi
  if [ -z "$SERVICE" ] || [ "$SERVICE" = "frontend" ]; then
    wait_for_healthy "frontend" || true
  fi

  verify_deployment

  echo ""
  log "Deployment complete! Log saved to: $LOG_FILE"
  echo ""
  echo "Useful commands:"
  echo "  View logs:    docker compose --env-file .env.production -f docker-compose.prod.yml logs -f"
  echo "  Stop all:     docker compose --env-file .env.production -f docker-compose.prod.yml down"
  echo "  Restart:      docker compose --env-file .env.production -f docker-compose.prod.yml restart"
}

main "$@"
