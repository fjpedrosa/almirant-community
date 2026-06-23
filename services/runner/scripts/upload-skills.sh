#!/usr/bin/env bash
# upload-skills.sh
#
# Creates a tarball from .claude/skills/ and .agents/skills/ directories
# (relative to the repository root) and uploads it to S3 at:
#   skills/platform/latest/skills.tar.gz
#
# Requirements:
#   - AWS CLI configured (aws s3 cp) or S3-compatible endpoint
#   - Environment variables:
#       S3_BUCKET          - Target S3 bucket name
#       S3_ENDPOINT        - (Optional) Custom S3 endpoint URL
#       AWS_ACCESS_KEY_ID  - (Optional if using IAM roles / instance profile)
#       AWS_SECRET_ACCESS_KEY

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

S3_KEY="skills/platform/latest/skills.tar.gz"
TARBALL_NAME="skills.tar.gz"
TMPDIR="${TMPDIR:-/tmp}"
TARBALL_PATH="$TMPDIR/$TARBALL_NAME"

# ---------------------------------------------------------------------------
# Validate environment
# ---------------------------------------------------------------------------

if [ -z "${S3_BUCKET:-}" ]; then
  echo "ERROR: S3_BUCKET environment variable is required" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Collect skill directories
# ---------------------------------------------------------------------------

DIRS_TO_TAR=()

if [ -d "$REPO_ROOT/.claude/skills" ]; then
  DIRS_TO_TAR+=(".claude/skills")
  echo "Found: $REPO_ROOT/.claude/skills"
else
  echo "Skipping: .claude/skills (not found)"
fi

if [ -d "$REPO_ROOT/.agents/skills" ]; then
  DIRS_TO_TAR+=(".agents/skills")
  echo "Found: $REPO_ROOT/.agents/skills"
else
  echo "Skipping: .agents/skills (not found)"
fi

if [ ${#DIRS_TO_TAR[@]} -eq 0 ]; then
  echo "ERROR: No skill directories found. Expected .claude/skills/ or .agents/skills/ in $REPO_ROOT" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Create tarball
# ---------------------------------------------------------------------------

echo "Creating tarball from: ${DIRS_TO_TAR[*]}"
tar -czf "$TARBALL_PATH" -C "$REPO_ROOT" "${DIRS_TO_TAR[@]}"

TARBALL_SIZE=$(stat -f%z "$TARBALL_PATH" 2>/dev/null || stat -c%s "$TARBALL_PATH" 2>/dev/null || echo "unknown")
echo "Tarball created: $TARBALL_PATH ($TARBALL_SIZE bytes)"

# ---------------------------------------------------------------------------
# Upload to S3
# ---------------------------------------------------------------------------

S3_URI="s3://$S3_BUCKET/$S3_KEY"
AWS_ARGS=()

if [ -n "${S3_ENDPOINT:-}" ]; then
  AWS_ARGS+=("--endpoint-url" "$S3_ENDPOINT")
fi

echo "Uploading to $S3_URI ..."
aws s3 cp "$TARBALL_PATH" "$S3_URI" \
  --content-type "application/gzip" \
  "${AWS_ARGS[@]}"

echo "Upload complete: $S3_URI"

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

rm -f "$TARBALL_PATH"
echo "Temporary tarball removed."
