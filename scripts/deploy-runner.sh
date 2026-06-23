#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <user@host> [repo_path=/opt/almirant/repo] [git_ref=origin/main]"
  exit 1
fi

TARGET="$1"
REPO_PATH="${2:-/opt/almirant/repo}"
DEPLOY_REF="${3:-origin/main}"

ssh "$TARGET" bash -s "$REPO_PATH" "$DEPLOY_REF" <<'REMOTE'
  set -euo pipefail
  cd "$1"
  git fetch --all --prune
  git checkout -f "$2"
  git reset --hard "$2"
  cd services/runner
  docker compose -f docker-compose.prod.yml build
  docker compose -f docker-compose.prod.yml up -d
  echo "Waiting for runner to start..."
  for i in 1 2 3 4 5 6; do
    sleep 5
    if curl -fsS http://127.0.0.1:3002/health >/dev/null 2>&1; then
      echo "Runner is healthy"
      exit 0
    fi
    echo "  attempt $i/6 - not ready yet"
  done
  echo "Runner failed to start within 30s"
  docker compose -f docker-compose.prod.yml logs --tail=20 runner
  exit 1
REMOTE

echo "runner deploy completed"
