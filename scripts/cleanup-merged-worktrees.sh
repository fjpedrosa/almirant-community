#!/bin/sh
set -eu

BASE_REF="${BASE_REF:-origin/main}"
DO_FETCH=true
DRY_RUN=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --base)
      if [ "$#" -lt 2 ]; then
        echo "[worktree:cleanup] missing value for --base"
        exit 1
      fi
      BASE_REF="$2"
      shift 2
      ;;
    --no-fetch)
      DO_FETCH=false
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "[worktree:cleanup] unknown argument: $1"
      echo "Usage: ./scripts/cleanup-merged-worktrees.sh [--base <ref>] [--no-fetch] [--dry-run]"
      exit 1
      ;;
  esac
done

if [ "$DO_FETCH" = "true" ]; then
  echo "[worktree:cleanup] fetching origin..."
  git fetch origin --prune
fi

if ! git rev-parse --verify --quiet "${BASE_REF}^{commit}" >/dev/null; then
  echo "[worktree:cleanup] base ref not found: $BASE_REF"
  exit 1
fi

echo "[worktree:cleanup] pruning stale worktree metadata..."
if ! git worktree prune >/dev/null 2>&1; then
  echo "[worktree:cleanup] warning: could not fully prune stale metadata; continuing"
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_NAME="$(basename "$REPO_ROOT")"
CURRENT_WORKTREE="$(pwd -P)"
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  CURRENT_WORKTREE="$(git rev-parse --show-toplevel)"
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT INT TERM
git worktree list --porcelain > "$TMP_FILE"

total_candidates=0
cleaned_worktrees=0
deleted_branches=0
skipped_root=0
skipped_current=0
skipped_detached=0
skipped_not_merged=0
skipped_unmanaged_path=0

current_path=""
current_branch=""

process_entry() {
  if [ -z "$current_path" ]; then
    return
  fi

  if [ "$current_path" = "$REPO_ROOT" ]; then
    skipped_root=$((skipped_root + 1))
    return
  fi

  if [ "$current_path" = "$CURRENT_WORKTREE" ]; then
    skipped_current=$((skipped_current + 1))
    return
  fi

  if [ -z "$current_branch" ]; then
    echo "[worktree:cleanup] skip detached worktree: $current_path"
    skipped_detached=$((skipped_detached + 1))
    return
  fi

  if [ "${current_path#"$REPO_ROOT/.worktrees/"}" = "$current_path" ]; then
    path_name="$(basename "$current_path")"
    case "$path_name" in
      "$REPO_NAME"-*)
        :
        ;;
      *)
        echo "[worktree:cleanup] skip unmanaged path: $current_path"
        skipped_unmanaged_path=$((skipped_unmanaged_path + 1))
        return
        ;;
    esac
  fi

  case "$current_branch" in
    main|master)
      echo "[worktree:cleanup] skip protected branch '$current_branch' at $current_path"
      return
      ;;
  esac

  total_candidates=$((total_candidates + 1))

  if git merge-base --is-ancestor "$current_branch" "$BASE_REF"; then
    if [ "$DRY_RUN" = "true" ]; then
      echo "[worktree:cleanup] [dry-run] would remove worktree: $current_path (branch: $current_branch)"
      echo "[worktree:cleanup] [dry-run] would delete branch: $current_branch"
      return
    fi

    echo "[worktree:cleanup] removing worktree: $current_path (branch: $current_branch)"
    git worktree remove "$current_path" --force
    cleaned_worktrees=$((cleaned_worktrees + 1))

    if git show-ref --verify --quiet "refs/heads/$current_branch"; then
      if git branch -d "$current_branch" >/dev/null 2>&1; then
        echo "[worktree:cleanup] deleted branch: $current_branch"
        deleted_branches=$((deleted_branches + 1))
      else
        echo "[worktree:cleanup] branch not deleted (not merged locally): $current_branch"
      fi
    fi
  else
    echo "[worktree:cleanup] keep worktree (not merged in $BASE_REF): $current_path (branch: $current_branch)"
    skipped_not_merged=$((skipped_not_merged + 1))
  fi
}

while IFS= read -r line || [ -n "$line" ]; do
  if [ -z "$line" ]; then
    process_entry
    current_path=""
    current_branch=""
    continue
  fi

  case "$line" in
    worktree\ *)
      current_path="${line#worktree }"
      ;;
    branch\ refs/heads/*)
      current_branch="${line#branch refs/heads/}"
      ;;
  esac
done < "$TMP_FILE"

process_entry

echo "[worktree:cleanup] summary:"
echo "  base ref: $BASE_REF"
echo "  candidates checked: $total_candidates"
echo "  cleaned worktrees: $cleaned_worktrees"
echo "  deleted branches: $deleted_branches"
echo "  skipped repo root: $skipped_root"
echo "  skipped current worktree: $skipped_current"
echo "  skipped detached: $skipped_detached"
echo "  skipped not merged: $skipped_not_merged"
echo "  skipped unmanaged path: $skipped_unmanaged_path"
