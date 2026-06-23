#!/usr/bin/env bash
# Run each test file in its own bun process to avoid mock.module() leaks.
# bun's mock.module() is global and persistent — mocks from one file
# contaminate all subsequent files in the same process.
#
# Usage:
#   bash scripts/run-tests-isolated.sh [--coverage] [--junit <path>]

set -euo pipefail
cd "$(dirname "$0")/.."

COVERAGE_ARGS=""
JUNIT_PATH=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --coverage) COVERAGE_ARGS="--coverage --coverage-reporter=lcov --coverage-dir=../../artifacts/coverage-api"; shift ;;
    --junit) JUNIT_PATH="$2"; shift 2 ;;
    *) shift ;;
  esac
done

FAILED=0
PASSED=0
TOTAL=0
FAIL_FILES=""
TOTAL_PASS=0
TOTAL_FAIL=0

# Only test files within the api src directory (not sibling packages)
TEST_FILES=$(find src -name '*.test.ts' | sort)

for f in $TEST_FILES; do
  TOTAL=$((TOTAL + 1))
  OUTPUT=$(bun test "$f" --pass-with-no-tests $COVERAGE_ARGS 2>&1)
  SUMMARY=$(echo "$OUTPUT" | grep -E "^\s*\d+ (pass|fail)" || true)

  FILE_PASS=$(echo "$SUMMARY" | grep -oE "^\s*[0-9]+ pass" | grep -oE "[0-9]+" || echo "0")
  FILE_FAIL=$(echo "$OUTPUT" | grep -c "(fail)" || true)

  TOTAL_PASS=$((TOTAL_PASS + FILE_PASS))
  TOTAL_FAIL=$((TOTAL_FAIL + FILE_FAIL))

  if [ "$FILE_FAIL" -gt 0 ]; then
    FAILED=$((FAILED + 1))
    FAIL_FILES="$FAIL_FILES\n  $f ($FILE_FAIL failures)"
    echo "FAIL $f"
    echo "$OUTPUT" | grep "(fail)" | head -5
  fi
done

echo ""
echo "=== $TOTAL_PASS pass, $TOTAL_FAIL fail across $TOTAL files ==="

if [ "$TOTAL_FAIL" -gt 0 ]; then
  echo -e "\nFailed files:$FAIL_FILES"
  exit 1
fi
