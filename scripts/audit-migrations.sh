#!/usr/bin/env bash
#
# Almirant — migrations chain auditor
#
# Reports the health of backend/packages/database/migrations against
# the Drizzle journal. Used by .github/workflows/migrations-audit.yml
# to block PRs that introduce new orphan SQL files.
#
# Checks (BLOCKING — exit 1 on failure):
#   1. Every .sql file is referenced by an entry in _journal.json
#   2. Every entry in _journal.json has a matching .sql file
#   3. No two journal entries share the same idx
#   4. The latest journal `when` timestamp is strictly after the previous one
#      (runtime migrations block the same condition before touching the DB.)
#
# Checks (WARNING — printed but exit 0):
#   5. Historical journal `when` timestamps are strictly increasing
#      (Drizzle uses `when`, not `idx`, to decide what to apply.
#      Historical disorder cannot be repaired without a coordinated
#      reset across all live instances — tracked separately.)
#
# Pass --strict to escalate WARNINGs to errors.
#
# Exit codes:
#   0  clean (or only warnings without --strict)
#   1  blocking issue found, or warning found with --strict
#

set -euo pipefail

STRICT=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) printf '✗ Unknown argument: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_DIR="$REPO_DIR/backend/packages/database/migrations"
JOURNAL="$MIG_DIR/meta/_journal.json"

[ -f "$JOURNAL" ] || { printf '✗ Journal not found: %s\n' "$JOURNAL" >&2; exit 1; }

STRICT="$STRICT" python3 - "$MIG_DIR" "$JOURNAL" <<'PY'
import json, sys, os
from pathlib import Path
from collections import Counter

mig_dir = Path(sys.argv[1])
journal = json.load(open(sys.argv[2]))
entries = journal['entries']
strict = os.environ.get('STRICT', '0') == '1'

journal_tags = {e['tag'] for e in entries}
sql_files = {p.stem for p in mig_dir.glob('*.sql')}

blocking = []
warnings = []

# 1. Orphan .sql files (BLOCKING).
for tag in sorted(sql_files - journal_tags):
    blocking.append(f"orphan .sql file (not in journal): {tag}.sql")

# 2. Missing .sql files (BLOCKING).
for tag in sorted(journal_tags - sql_files):
    blocking.append(f"missing .sql file (referenced by journal): {tag}.sql")

# 3. Duplicate idx in journal (BLOCKING).
idx_counts = Counter(e['idx'] for e in entries)
for idx, c in idx_counts.items():
    if c > 1:
        tags = [e['tag'] for e in entries if e['idx'] == idx]
        blocking.append(f"duplicate idx {idx} in journal: {', '.join(tags)}")

# 4. Latest `when` timestamp must be safe for the runtime migrator (BLOCKING).
if len(entries) >= 2:
    previous = entries[-2]
    latest = entries[-1]
    if latest['when'] <= previous['when']:
        blocking.append(
            f"latest migration has non-increasing when: {latest['tag']} ({latest['when']}) "
            f"<= previous {previous['tag']} ({previous['when']})"
        )

# 5. Historical monotonic `when` timestamps (WARNING).
last_when = -1
last_tag = None
for index, e in enumerate(entries):
    if e['when'] <= last_when:
        message = (
            f"non-increasing when: {e['tag']} ({e['when']}) "
            f"<= previous {last_tag} ({last_when})"
        )
        # The latest entry is already reported as blocking above, matching the
        # runtime guard in migrate-with-validation.ts. Keep this section focused
        # on historical debt that cannot be repaired unilaterally.
        if index < len(entries) - 1:
            warnings.append(message)
    last_when = e['when']
    last_tag = e['tag']

if blocking:
    print(f"✗ {len(blocking)} blocking issue(s):", file=sys.stderr)
    for err in blocking:
        print(f"  - {err}", file=sys.stderr)

if warnings:
    stream = sys.stderr if strict else sys.stdout
    label = "✗" if strict else "⚠"
    noun = "blocking" if strict else "warning"
    print(f"{label} {len(warnings)} timestamp {noun}(s) (historical, see docs/internal/migration-audit-2026-04-25.md):", file=stream)
    for w in warnings:
        print(f"  - {w}", file=stream)

if blocking or (strict and warnings):
    sys.exit(1)

print(f"✓ migrations chain is healthy ({len(entries)} entries, {len(sql_files)} .sql files)")
PY
