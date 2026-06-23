#!/bin/bash
# Generates a GitHub App installation token.
#
# Usage:
#   GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem \
#   GITHUB_APP_ID=123456 \
#   GITHUB_APP_INSTALLATION_ID=12345678 \
#   TOKEN=$(bash scripts/github-app-token.sh)

PK_PATH="${GITHUB_APP_PRIVATE_KEY_PATH:-}"
APP_ID="${GITHUB_APP_ID:-}"
INSTALLATION_ID="${GITHUB_APP_INSTALLATION_ID:-}"

if [ -z "$PK_PATH" ] || [ -z "$APP_ID" ] || [ -z "$INSTALLATION_ID" ]; then
  echo "Missing GITHUB_APP_PRIVATE_KEY_PATH, GITHUB_APP_ID, or GITHUB_APP_INSTALLATION_ID" >&2
  exit 1
fi

JWT=$(node -e "
const fs = require('fs');
const crypto = require('crypto');
const pk = fs.readFileSync('$PK_PATH', 'utf8');
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({iat: now-60, exp: now+600, iss: '$APP_ID'})).toString('base64url');
const sig = crypto.createSign('RSA-SHA256').update(header+'.'+payload).sign(pk,'base64url');
console.log(header+'.'+payload+'.'+sig);
")

curl -s -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])"
