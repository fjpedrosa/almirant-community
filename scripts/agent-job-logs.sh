#!/usr/bin/env bash
set -euo pipefail

JOB_ID="${1:-}"
TARGET_HOST="${AGENT_LOGS_HOST:-almirant-runner-1}"

if [[ -z "$JOB_ID" ]]; then
  cat >&2 <<'EOF'
Usage:
  bun run agent:job-logs -- <job-id>

Optional:
  AGENT_LOGS_HOST=almirant-runner-1
EOF
  exit 1
fi

ssh "$TARGET_HOST" bash -s "$JOB_ID" <<'REMOTE'
set -euo pipefail

JOB_ID="$1"
CONTAINER_ID="$(docker ps -aq --filter "label=job-id=${JOB_ID}" | head -n1)"

if [[ -z "$CONTAINER_ID" ]]; then
  echo "No container found for job-id: ${JOB_ID}" >&2
  echo >&2
  echo "Recent runner job containers:" >&2
  docker ps -a \
    --filter label=almirant-runner=true \
    --format 'table {{.ID}}\t{{.Label "job-id"}}\t{{.Status}}\t{{.Names}}' >&2
  exit 1
fi

echo "container=${CONTAINER_ID}"
docker logs -f --timestamps "$CONTAINER_ID"
REMOTE
