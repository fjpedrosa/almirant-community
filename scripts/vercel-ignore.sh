#!/bin/sh
# =============================================================================
# Vercel Ignored Build Step
# =============================================================================
# Usage:
#   bash scripts/vercel-ignore.sh <project-folder>
#
# Examples:
#   bash scripts/vercel-ignore.sh frontend
#
# Exit codes (Vercel convention):
#   0 = Skip build (no relevant changes)
#   1 = Proceed with build (changes detected)
#
# Triggers a build when:
#   - Files changed inside the project folder
#   - Shared root files changed (package.json, tsconfig.json, bun.lock, .github/)
#
# Uses VERCEL_GIT_PREVIOUS_SHA (last successful deploy) as the comparison base.
# Falls back to HEAD^ if not available, and always builds on first deploy.
# =============================================================================

set -e

PROJECT_DIR="$1"

if [ -z "$PROJECT_DIR" ]; then
  echo "Error: project folder argument required"
  echo "Usage: bash scripts/vercel-ignore.sh <project-folder>"
  exit 1
fi

echo "==> Vercel Ignored Build Step for: $PROJECT_DIR"

# Shared root files/dirs that should trigger a rebuild for all projects
SHARED_PATHS="package.json tsconfig.json bun.lock .github"

# Determine the base commit to compare against
if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ]; then
  # Verify the SHA exists in git history (may fail with very shallow clones)
  if git rev-parse "$VERCEL_GIT_PREVIOUS_SHA" >/dev/null 2>&1; then
    BASE_SHA="$VERCEL_GIT_PREVIOUS_SHA"
    echo "==> Comparing against last successful deploy: ${BASE_SHA:0:7}"
  else
    echo "==> VERCEL_GIT_PREVIOUS_SHA ($VERCEL_GIT_PREVIOUS_SHA) not found in history. Need deeper fetch."
    git fetch --deepen=50 >/dev/null 2>&1 || true
    if git rev-parse "$VERCEL_GIT_PREVIOUS_SHA" >/dev/null 2>&1; then
      BASE_SHA="$VERCEL_GIT_PREVIOUS_SHA"
      echo "==> Found after deepening fetch: ${BASE_SHA:0:7}"
    else
      echo "==> Still not found. Building to be safe."
      exit 1
    fi
  fi
elif git rev-parse HEAD^ >/dev/null 2>&1; then
  BASE_SHA="HEAD^"
  echo "==> VERCEL_GIT_PREVIOUS_SHA not set, falling back to HEAD^"
else
  echo "==> No previous commit found (first deploy or shallow clone). Building."
  exit 1
fi

# Check for changes in the project folder
echo "==> Checking for changes in $PROJECT_DIR/ ..."
if ! git diff --quiet "$BASE_SHA" HEAD -- "$PROJECT_DIR/"; then
  echo "==> Changes detected in $PROJECT_DIR/. Building."
  exit 1
fi

# Check for changes in shared root paths
echo "==> Checking for changes in shared root files ..."
for path in $SHARED_PATHS; do
  if ! git diff --quiet "$BASE_SHA" HEAD -- "$path"; then
    echo "==> Changes detected in shared path: $path. Building."
    exit 1
  fi
done

echo "==> No relevant changes detected. Skipping build."
exit 0
