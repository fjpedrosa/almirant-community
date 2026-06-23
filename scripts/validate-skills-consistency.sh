#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ERRORS=0

echo "Validating skills consistency..."

if rg -n "^user-invocable:\\s*" .agents .claude --glob "**/SKILL.md" >/tmp/skill-user-invocable.txt; then
  echo "ERROR: 'user-invocable' is not allowed in SKILL.md files:"
  cat /tmp/skill-user-invocable.txt
  ERRORS=1
fi

AGENTS_IMPLEMENT=".agents/skills/implement/SKILL.md"
CLAUDE_IMPLEMENT=".claude/skills/implement/SKILL.md"

if ! cmp -s "$AGENTS_IMPLEMENT" "$CLAUDE_IMPLEMENT"; then
  echo "ERROR: implement skill differs between .agents and .claude"
  diff -u "$AGENTS_IMPLEMENT" "$CLAUDE_IMPLEMENT" | sed -n "1,160p"
  ERRORS=1
fi

REQUIRED_MARKERS=(
  "## Non-Negotiable Execution Order (hard-stop)"
  "Never edit files before gates 1-3 are completed."
  "### 4a. Ensure assignee for each valid task"
  "### 4b. Ensure dependency graph is persisted"
  "#### 8a. Move wave tasks to In Progress"
)

for marker in "${REQUIRED_MARKERS[@]}"; do
  if ! rg -F -q "$marker" "$AGENTS_IMPLEMENT"; then
    echo "ERROR: Missing required marker in implement skill: $marker"
    ERRORS=1
  fi
done

if [ "$ERRORS" -ne 0 ]; then
  echo "Skills consistency validation failed."
  exit 1
fi

echo "Skills consistency validation passed."
