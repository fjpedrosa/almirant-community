#!/usr/bin/env bash
#
# Almirant — env-sync helper (bash counterpart of internal/envfile.Sync)
#
# Reads .env.production.example, finds variables missing from
# .env.production, materialises them using the directives in the schema,
# and appends them. Existing values are never overwritten. A timestamped
# backup is written before any change.
#
# Used by:
#   - scripts/update-remote.sh (over SSH, where the Go CLI binary is not
#     available on the remote host)
#   - admins running an upgrade by hand without `almirant upgrade`
#
# Usage:
#   ./scripts/sync-env.sh                   # mutate .env.production
#   ./scripts/sync-env.sh --check           # dry-run, exit 0 if no work
#   ./scripts/sync-env.sh --schema FILE     # custom schema path
#   ./scripts/sync-env.sh --env FILE        # custom env path
#   ./scripts/sync-env.sh --stack-dir DIR   # override @derive:stack-dir
#
# Exit codes:
#   0  no work, or work completed
#   1  blocked by unresolvable @required entries (printed to stderr)
#   2  invalid arguments / schema parse error
#

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCHEMA="$REPO_DIR/.env.production.example"
ENV_FILE="$REPO_DIR/.env.production"
STACK_DIR="$REPO_DIR"
DRY_RUN=0

# ─── Args ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --check|--dry-run)
      DRY_RUN=1; shift ;;
    --schema)
      SCHEMA="$2"; shift 2 ;;
    --env)
      ENV_FILE="$2"; shift 2 ;;
    --stack-dir)
      STACK_DIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *)
      printf '✗ Unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

[ -f "$SCHEMA" ] || { printf '✗ Schema not found: %s\n' "$SCHEMA" >&2; exit 2; }

# ─── Logging ─────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BLUE=''
fi
log()  { printf '%s▸ %s%s\n' "$C_BLUE" "$*" "$C_RESET"; }
ok()   { printf '%s✓ %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s⚠ %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; }
die()  { printf '%s✗ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; exit 1; }

# ─── Generators ──────────────────────────────────────────────────────────
gen_rand_hex() {
  local n="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$n"
  elif [ -r /dev/urandom ]; then
    head -c "$n" /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    die "Cannot generate random hex (no openssl, no /dev/urandom)"
  fi
}

gen_rand_password() {
  local n="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 $((n * 2)) | tr -d '/+=' | head -c "$n"
  elif [ -r /dev/urandom ]; then
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$n"
  else
    die "Cannot generate password"
  fi
}

gen_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-Z' 'a-z'
  elif [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import uuid; print(uuid.uuid4())'
  else
    die "Cannot generate UUID (install uuidgen)"
  fi
}

# ─── Schema parsing (line-oriented) ──────────────────────────────────────
# Pre-load existing env keys (left side of the first = on each non-comment line).
declare -A EXISTING=()
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    key="${line%%=*}"
    EXISTING["$key"]=1
  done < "$ENV_FILE"
fi

# Pending state per entry.
PENDING_DIRECTIVES=()
PENDING_COMMENTS=()
ADDED_NAMES=()
ADDED_VALUES=()
ADDED_SOURCES=()
ADDED_COMMENTS=()
MISSING_REQUIRED=()

reset_pending() { PENDING_DIRECTIVES=(); PENDING_COMMENTS=(); }

# resolve_entry NAME → echoes "value\tsource", or returns 1 if unresolved.
# Reads PENDING_DIRECTIVES and the schema-line literal default ($1=name, $2=literal).
resolve_entry() {
  local name="$1"
  local literal="$2"
  local required=0

  # Recipe loop, in declaration order.
  local d
  for d in "${PENDING_DIRECTIVES[@]}"; do
    # Strip leading "# " then iterate space-separated tokens, honouring "..." quoting.
    local body="${d#\# }"
    body="${body# }"
    # shellcheck disable=SC2206
    local tokens=()
    local cur="" in_quote=0 i char
    for (( i=0; i<${#body}; i++ )); do
      char="${body:$i:1}"
      if [ "$char" = '"' ]; then
        in_quote=$((1 - in_quote))
        cur+="$char"
      elif [ "$char" = ' ' ] && [ $in_quote -eq 0 ]; then
        [ -n "$cur" ] && tokens+=("$cur")
        cur=""
      else
        cur+="$char"
      fi
    done
    [ -n "$cur" ] && tokens+=("$cur")

    local tok
    for tok in "${tokens[@]}"; do
      case "$tok" in
        @required) required=1 ;;
        @optional) ;;
        @generate:rand-hex:*)
          printf '%s\t%s' "$(gen_rand_hex "${tok#@generate:rand-hex:}")" "generated"
          return 0 ;;
        @generate:rand-password:*)
          printf '%s\t%s' "$(gen_rand_password "${tok#@generate:rand-password:}")" "generated"
          return 0 ;;
        @generate:uuid)
          printf '%s\t%s' "$(gen_uuid)" "generated"
          return 0 ;;
        @generate:prefix-rand-hex:*)
          # body = prefix:N (last : separates them)
          local prnh="${tok#@generate:prefix-rand-hex:}"
          local prefix="${prnh%:*}"
          local nbytes="${prnh##*:}"
          printf '%s\t%s' "${prefix}$(gen_rand_hex "$nbytes")" "generated"
          return 0 ;;
        @derive:stack-dir)
          printf '%s\t%s' "$STACK_DIR" "derived"
          return 0 ;;
        @derive:stack-dir:*)
          printf '%s\t%s' "$STACK_DIR/${tok#@derive:stack-dir:}" "derived"
          return 0 ;;
        @derive:same-as:*)
          local refvar="${tok#@derive:same-as:}"
          # Use the value already in EXISTING (set during preload OR
          # appended in this run via record_added).
          if [ -n "${EXISTING_VALUES[$refvar]:-}" ]; then
            printf '%s\t%s' "${EXISTING_VALUES[$refvar]}" "derived"
            return 0
          fi
          # Fall through to next recipe.
          ;;
        @default:*)
          printf '%s\t%s' "${tok#@default:}" "default"
          return 0 ;;
        @prompt:*)
          # Non-interactive: skip and try next recipe.
          ;;
        *)
          die "Unknown directive: $tok"
          ;;
      esac
    done
  done

  # Fallback to the literal value on the schema line itself, if any.
  if [ -n "$literal" ]; then
    printf '%s\t%s' "$literal" "default"
    return 0
  fi

  if [ $required -eq 1 ]; then
    MISSING_REQUIRED+=("$name")
    return 1
  fi
  # Optional, no recipe, no literal → empty.
  printf '%s\t%s' "" "empty"
  return 0
}

# To support derive:same-as we keep a parallel value map across this run.
declare -A EXISTING_VALUES=()
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    EXISTING_VALUES["$key"]="$val"
  done < "$ENV_FILE"
fi

# ─── Walk the schema ─────────────────────────────────────────────────────
while IFS= read -r line || [ -n "$line" ]; do
  trimmed="${line#"${line%%[![:space:]]*}"}"   # leading-whitespace strip
  if [ -z "$trimmed" ]; then
    # Blank line is a hard separator: any pending directives/comments
    # belong to the file header (or to a finished entry), not to the
    # next VAR=. Drop them.
    reset_pending
    continue
  fi
  case "$trimmed" in
    \#\ @*|\#@*)
      PENDING_DIRECTIVES+=("$trimmed")
      continue ;;
    \#*)
      PENDING_COMMENTS+=("$line")
      continue ;;
  esac
  # VAR=...
  name="${trimmed%%=*}"
  literal="${trimmed#*=}"

  if [ "${EXISTING[$name]:-0}" = "1" ]; then
    reset_pending
    continue
  fi

  result=$(resolve_entry "$name" "$literal" || true)
  if [ -z "$result" ] && [ "${MISSING_REQUIRED[*]: -1}" = "$name" ]; then
    reset_pending
    continue
  fi
  value="${result%%	*}"
  source="${result##*	}"

  ADDED_NAMES+=("$name")
  ADDED_VALUES+=("$value")
  ADDED_SOURCES+=("$source")
  # Capture the comments that were pending right above this entry.
  ADDED_COMMENTS+=("$(printf '%s\n' "${PENDING_COMMENTS[@]:-}")")

  EXISTING["$name"]=1
  EXISTING_VALUES["$name"]="$value"
  reset_pending
done < "$SCHEMA"

# ─── Report ──────────────────────────────────────────────────────────────
ADDED=${#ADDED_NAMES[@]}
MISSING=${#MISSING_REQUIRED[@]}

if [ "$MISSING" -gt 0 ]; then
  warn "Cannot synchronise ${ENV_FILE} — these required variables are missing and have no recipe:"
  for n in "${MISSING_REQUIRED[@]}"; do
    printf '    - %s\n' "$n" >&2
  done
  printf '  Set them manually in %s and re-run.\n' "$ENV_FILE" >&2
  exit 1
fi

if [ "$ADDED" -eq 0 ]; then
  ok "$ENV_FILE is already in sync with the schema"
  exit 0
fi

if [ $DRY_RUN -eq 1 ]; then
  log "Would add $ADDED variable(s) to $ENV_FILE:"
  for ((i=0; i<ADDED; i++)); do
    printf '    + %s  (%s)\n' "${ADDED_NAMES[$i]}" "${ADDED_SOURCES[$i]}"
  done
  exit 0
fi

# Backup and append.
if [ -f "$ENV_FILE" ]; then
  BACKUP="${ENV_FILE}.bak.$(date -u +%s)"
  cp "$ENV_FILE" "$BACKUP"
  log "Backup written to $BACKUP"
fi

{
  printf '\n# ─── Added by scripts/sync-env.sh on %s ──────────\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for ((i=0; i<ADDED; i++)); do
    # Print captured comments verbatim (one comment per line).
    if [ -n "${ADDED_COMMENTS[$i]}" ]; then
      printf '%s\n' "${ADDED_COMMENTS[$i]}"
    fi
    printf '%s=%s\n' "${ADDED_NAMES[$i]}" "${ADDED_VALUES[$i]}"
  done
} >> "$ENV_FILE"

ok "Added $ADDED variable(s) to $ENV_FILE:"
for ((i=0; i<ADDED; i++)); do
  printf '    + %s  (%s)\n' "${ADDED_NAMES[$i]}" "${ADDED_SOURCES[$i]}"
done
