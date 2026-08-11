#!/usr/bin/env bash

set -euo pipefail

SOURCE_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/audit-migrations.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/almirant-migration-audit.XXXXXX")"
OUTPUT_FILE="$TEST_ROOT/last-output"
trap 'rm -rf "$TEST_ROOT"' EXIT

pass_count=0

new_repo() {
  local name="$1"
  local repo="$TEST_ROOT/$name"

  mkdir -p "$repo/scripts"
  cp "$SOURCE_SCRIPT" "$repo/scripts/audit-migrations.sh"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name "Migration audit contract"
  printf '%s\n' "$repo"
}

write_chain() {
  local repo="$1"
  shift

  python3 - "$repo" "$@" <<'PY'
import json
import sys
from pathlib import Path

repo = Path(sys.argv[1])
tags = sys.argv[2:]
migrations = repo / "backend/packages/database/migrations"
(migrations / "meta").mkdir(parents=True, exist_ok=True)
for sql_file in migrations.glob("*.sql"):
    sql_file.unlink()
for index, tag in enumerate(tags):
    (migrations / f"{tag}.sql").write_text(f"-- {tag}\n", encoding="utf-8")
journal = {
    "version": "7",
    "dialect": "postgresql",
    "entries": [
        {
            "idx": index,
            "version": "7",
            "when": 1_000 + index,
            "tag": tag,
            "breakpoints": True,
        }
        for index, tag in enumerate(tags)
    ],
}
(migrations / "meta/_journal.json").write_text(
    json.dumps(journal, indent=2) + "\n", encoding="utf-8"
)
PY
}

commit_repo() {
  local repo="$1"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m fixture
  git -C "$repo" rev-parse HEAD
}

run_audit() {
  local repo="$1"
  local base_ref="${2:-}"
  shift "$(( $# > 1 ? 2 : 1 ))"

  if [ -n "$base_ref" ]; then
    MIGRATIONS_BASE_REF="$base_ref" /bin/bash "$repo/scripts/audit-migrations.sh" "$@"
  else
    env -u MIGRATIONS_BASE_REF /bin/bash "$repo/scripts/audit-migrations.sh" "$@"
  fi
}

expect_pass() {
  local label="$1"
  shift
  local output

  if ! "$@" >"$OUTPUT_FILE" 2>&1; then
    output=$(<"$OUTPUT_FILE")
    printf 'not ok - %s\n%s\n' "$label" "$output" >&2
    exit 1
  fi
  pass_count=$((pass_count + 1))
  printf 'ok - %s\n' "$label"
}

expect_pass_contains() {
  local label="$1"
  local expected="$2"
  shift 2
  local output

  if ! "$@" >"$OUTPUT_FILE" 2>&1; then
    output=$(<"$OUTPUT_FILE")
    printf 'not ok - %s\n%s\n' "$label" "$output" >&2
    exit 1
  fi
  output=$(<"$OUTPUT_FILE")
  if [[ "$output" != *"$expected"* ]]; then
    printf 'not ok - %s (missing %q)\n%s\n' "$label" "$expected" "$output" >&2
    exit 1
  fi
  pass_count=$((pass_count + 1))
  printf 'ok - %s\n' "$label"
}

expect_fail() {
  local label="$1"
  local expected="$2"
  shift 2
  local output

  if "$@" >"$OUTPUT_FILE" 2>&1; then
    output=$(<"$OUTPUT_FILE")
    printf 'not ok - %s (unexpected success)\n%s\n' "$label" "$output" >&2
    exit 1
  fi
  output=$(<"$OUTPUT_FILE")
  if [[ "$output" != *"$expected"* ]]; then
    printf 'not ok - %s (missing %q)\n%s\n' "$label" "$expected" "$output" >&2
    exit 1
  fi
  pass_count=$((pass_count + 1))
  printf 'ok - %s\n' "$label"
}

repo=$(new_repo migration-count)
write_chain "$repo" 0000_seed 0001_users 0002_workspaces 0003_sessions 0004_jobs
base_sha=$(commit_repo "$repo")

expect_pass "zero new journal tags pass" run_audit "$repo" "$base_sha"
write_chain "$repo" 0000_seed 0001_users 0002_workspaces 0003_sessions 0004_jobs 0005_events
expect_pass "one new journal tag passes" run_audit "$repo" "$base_sha"
write_chain "$repo" 0000_seed 0001_users 0002_workspaces 0003_sessions 0004_jobs 0005_events 0006_alerts
expect_fail "two new journal tags fail" "introduces 2 migration journal tags; at most 1 is allowed" run_audit "$repo" "$base_sha"

write_chain "$repo" 0000_seed 0001_users 0002_rewritten 0003_sessions 0004_jobs
expect_fail "rewritten base tag fails closed" "current journal does not preserve base tag history" run_audit "$repo" "$base_sha"
expect_fail "invalid base ref is actionable" "MIGRATIONS_BASE_REF must be a full commit SHA" run_audit "$repo" not-a-sha
expect_fail "missing base commit is actionable" "base commit is unavailable locally" run_audit "$repo" 0000000000000000000000000000000000000000

write_chain "$repo" 0000_seed 0001_users 0002_workspaces 0003_sessions 0004_jobs 0005_events 0006_alerts
expect_pass_contains "no-base mode keeps ledger-only audit safe" \
  "default-branch ledger audit only" run_audit "$repo"

historical_repo=$(new_repo historical-base)
set --
for index in $(seq 0 24); do
  set -- "$@" "$(printf '%04d_historical' "$index")"
done
write_chain "$historical_repo" "$@"
historical_base_sha=$(commit_repo "$historical_repo")
write_chain "$historical_repo" "$@" 0025_new
expect_pass "many-entry historical base permits one new tag" \
  run_audit "$historical_repo" "$historical_base_sha"

integrity_repo=$(new_repo ledger-integrity)
write_chain "$integrity_repo" 0000_seed 0001_users
printf '%s\n' '-- orphan' > "$integrity_repo/backend/packages/database/migrations/0002_orphan.sql"
expect_fail "orphan SQL remains blocking" "orphan .sql file" run_audit "$integrity_repo"

write_chain "$integrity_repo" 0000_seed 0001_users
rm "$integrity_repo/backend/packages/database/migrations/0001_users.sql"
expect_fail "missing SQL remains blocking" "missing .sql file" run_audit "$integrity_repo"

write_chain "$integrity_repo" 0000_seed 0001_users
python3 - "$integrity_repo" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1]) / "backend/packages/database/migrations/meta/_journal.json"
journal = json.loads(path.read_text(encoding="utf-8"))
journal["entries"][1]["idx"] = journal["entries"][0]["idx"]
path.write_text(json.dumps(journal, indent=2) + "\n", encoding="utf-8")
PY
expect_fail "duplicate journal idx remains blocking" "duplicate idx" run_audit "$integrity_repo"

write_chain "$integrity_repo" 0000_seed 0001_users
python3 - "$integrity_repo" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1]) / "backend/packages/database/migrations/meta/_journal.json"
journal = json.loads(path.read_text(encoding="utf-8"))
journal["entries"][1]["when"] = journal["entries"][0]["when"]
path.write_text(json.dumps(journal, indent=2) + "\n", encoding="utf-8")
PY
expect_fail "latest timestamp regression remains blocking" "latest migration has non-increasing when" run_audit "$integrity_repo"

write_chain "$integrity_repo" 0000_seed 0001_users 0002_workspaces
python3 - "$integrity_repo" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1]) / "backend/packages/database/migrations/meta/_journal.json"
journal = json.loads(path.read_text(encoding="utf-8"))
journal["entries"][1]["when"] = journal["entries"][0]["when"] - 1
path.write_text(json.dumps(journal, indent=2) + "\n", encoding="utf-8")
PY
expect_pass "historical timestamp disorder remains a warning" run_audit "$integrity_repo"
expect_fail "strict mode still escalates historical warnings" "timestamp blocking" run_audit "$integrity_repo" "" --strict

printf '1..%d\n' "$pass_count"
