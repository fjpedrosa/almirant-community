#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_usage() {
  cat <<'EOF'
Usage:
  bun deploy:agent -- <user@host> [repo_path]

Or configure environment variables for no-args usage:
  AGENT_DEPLOY_TARGET=user@host
  AGENT_DEPLOY_REPO_PATH=/opt/almirant/repo
  AGENT_DEPLOY_REF=origin/main

Optional auto-discovery (if hcloud CLI is installed):
  AGENT_DEPLOY_SERVER_NAME=almirant-runner-1
  AGENT_DEPLOY_USER=almirant
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  print_usage
  exit 0
fi

TARGET="${1:-${AGENT_DEPLOY_TARGET:-}}"
REPO_PATH="${2:-${AGENT_DEPLOY_REPO_PATH:-/opt/almirant/repo}}"
SERVER_NAME="${AGENT_DEPLOY_SERVER_NAME:-almirant-runner-1}"
SERVER_USER="${AGENT_DEPLOY_USER:-almirant}"
DEPLOY_REF="${AGENT_DEPLOY_REF:-origin/main}"

if [[ -z "$TARGET" ]] && command -v hcloud >/dev/null 2>&1; then
  if SERVER_IP="$(hcloud server ip "$SERVER_NAME" 2>/dev/null)"; then
    TARGET="${SERVER_USER}@${SERVER_IP}"
    echo "[deploy:agent] Target resolved via hcloud: ${TARGET}"
  fi
fi

if [[ -z "$TARGET" ]]; then
  print_usage
  exit 1
fi

if git rev-parse --show-toplevel >/dev/null 2>&1; then
  if [[ -z "${AGENT_DEPLOY_REF:-}" ]] && [[ -n "$(git status --short)" ]]; then
    cat >&2 <<EOF
[deploy:agent] Refusing deploy with uncommitted changes.
[deploy:agent] This script deploys git ref '${DEPLOY_REF}' on the remote host and will ignore dirty local edits.
[deploy:agent] Commit/push the change first, or set AGENT_DEPLOY_REF to an explicit pushed ref.
EOF
    exit 1
  fi
fi

echo "[deploy:agent] Deploying remote-agent runner to ${TARGET} (repo: ${REPO_PATH}, ref: ${DEPLOY_REF})"
exec "${SCRIPT_DIR}/deploy-runner.sh" "$TARGET" "$REPO_PATH" "$DEPLOY_REF"
