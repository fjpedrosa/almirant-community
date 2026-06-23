#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <server-name> <ssh-key-name> <repo-url> [location]"
  echo "  location: Hetzner datacenter (default: fsn1). Options: fsn1, nbg1, hel1, ash, hil"
  exit 1
fi

SERVER_NAME="$1"
SSH_KEY_NAME="$2"
REPO_URL="$3"
LOCATION="${4:-nbg1}"

if ! command -v hcloud >/dev/null 2>&1; then
  echo "hcloud CLI is required"
  exit 1
fi

TMP_CLOUD_INIT=$(mktemp)
sed "s|\${REPO_URL}|$REPO_URL|g" services/runner/cloud-init.yml > "$TMP_CLOUD_INIT"

hcloud server create \
  --name "$SERVER_NAME" \
  --type cpx42 \
  --image ubuntu-24.04 \
  --location "$LOCATION" \
  --ssh-key "$SSH_KEY_NAME" \
  --user-data-from-file "$TMP_CLOUD_INIT"

rm -f "$TMP_CLOUD_INIT"

echo "server provisioning requested. Wait ~2 minutes, then verify runner health."
