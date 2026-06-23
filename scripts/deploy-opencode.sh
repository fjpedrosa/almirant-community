#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "Usage: $0 <user@host> [repo_path=/opt/almirant/repo] [opencode_image=almirant-opencode:latest]"
  exit 1
fi

TARGET="$1"
REPO_PATH="${2:-/opt/almirant/repo}"
OPENCODE_IMAGE="${3:-almirant-opencode:latest}"

ssh "$TARGET" bash -s "$REPO_PATH" "$OPENCODE_IMAGE" <<'REMOTE'
  set -euo pipefail

  REPO_PATH="$1"
  OPENCODE_IMAGE="$2"

  cd "$REPO_PATH"
  git fetch origin main
  git checkout -f main
  git reset --hard origin/main

  echo "Building OpenCode image: $OPENCODE_IMAGE"
  docker build -f services/runner/docker/Dockerfile.opencode -t "$OPENCODE_IMAGE" .

  cd services/runner
  if [[ ! -f .env ]]; then
    echo "Missing services/runner/.env on server"
    exit 1
  fi

  if grep -q '^OPENCODE_IMAGE=' .env; then
    sed -i "s|^OPENCODE_IMAGE=.*|OPENCODE_IMAGE=$OPENCODE_IMAGE|" .env
  else
    printf '\nOPENCODE_IMAGE=%s\n' "$OPENCODE_IMAGE" >> .env
  fi

  docker compose -f docker-compose.prod.yml up -d --build runner

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

echo "opencode deploy completed"
