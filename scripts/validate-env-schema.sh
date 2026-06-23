#!/usr/bin/env bash
#
# Almirant — env schema coherence guard
#
# Fails CI when:
#   1. docker-compose.prod.yml interpolates ${VAR:?…} (strictly required)
#      but VAR is not declared with @required in .env.production.example
#   2. scripts/install.sh emits a VAR= line in .env.production but VAR is
#      not declared in the schema at all
#
# Run from the repo root:
#   ./scripts/validate-env-schema.sh
#
# Used by .github/workflows/env-schema-check.yml.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$REPO_DIR/docker-compose.prod.yml"
SCHEMA="$REPO_DIR/.env.production.example"
INSTALL="$REPO_DIR/scripts/install.sh"

[ -f "$COMPOSE" ] || { printf '✗ Missing %s\n' "$COMPOSE" >&2; exit 2; }
[ -f "$SCHEMA"  ] || { printf '✗ Missing %s\n' "$SCHEMA"  >&2; exit 2; }
[ -f "$INSTALL" ] || { printf '✗ Missing %s\n' "$INSTALL" >&2; exit 2; }

# ─── Extract ${VAR:?...} from compose (strictly required) ───────────────
# Matches: ${VAR:?...} or "${VAR:?...}"  — captures VAR.
# We intentionally exclude `${VAR-…}` and `${VAR:-…}` (they are optional).
mapfile -t COMPOSE_REQUIRED < <(
  grep -oE '\$\{[A-Z_][A-Z0-9_]*:\?[^}]*\}' "$COMPOSE" \
    | sed -E 's/\$\{([A-Z_][A-Z0-9_]*):\?.*/\1/' \
    | sort -u
)

# ─── Extract VAR= names from the schema ─────────────────────────────────
mapfile -t SCHEMA_VARS < <(
  grep -oE '^[A-Z_][A-Z0-9_]*=' "$SCHEMA" | tr -d '=' | sort -u
)

# ─── Extract @required entries from the schema ──────────────────────────
# A var is required if any preceding contiguous # @ line carries @required.
declare -A REQUIRED_IN_SCHEMA=()
pending_required=0
while IFS= read -r line || [ -n "$line" ]; do
  trimmed="${line#"${line%%[![:space:]]*}"}"
  if [ -z "$trimmed" ]; then
    pending_required=0
    continue
  fi
  case "$trimmed" in
    \#\ @*|\#@*)
      if [[ "$trimmed" == *"@required"* ]]; then
        pending_required=1
      fi
      continue ;;
    \#*)
      continue ;;
  esac
  name="${trimmed%%=*}"
  if [ "$pending_required" = "1" ]; then
    REQUIRED_IN_SCHEMA["$name"]=1
  fi
  pending_required=0
done < "$SCHEMA"

# ─── Extract VARs install.sh writes to the env file ─────────────────────
# Look for the heredoc content `cat > "$env_path" <<ENV ... ENV` and grab
# `VAR=` lines from inside it.
mapfile -t INSTALL_VARS < <(
  awk '
    /cat > "\$env_path" <<ENV/ {inblock=1; next}
    inblock && /^ENV[[:space:]]*$/ {inblock=0; next}
    inblock && /^[A-Z_][A-Z0-9_]*=/ {
      sub(/=.*$/, "");
      print
    }
  ' "$INSTALL" | sort -u
)

# ─── Check 1: every compose ${VAR:?...} is @required in the schema ─────
errors=0
for var in "${COMPOSE_REQUIRED[@]}"; do
  if [ -z "${REQUIRED_IN_SCHEMA[$var]:-}" ]; then
    printf '✗ %s is `${%s:?...}` in docker-compose.prod.yml but not @required (or missing) in .env.production.example\n' "$var" "$var" >&2
    errors=$((errors + 1))
  fi
done

# ─── Check 2: every install.sh-emitted VAR is declared in the schema ───
declare -A SCHEMA_SET=()
for v in "${SCHEMA_VARS[@]}"; do SCHEMA_SET["$v"]=1; done

for var in "${INSTALL_VARS[@]}"; do
  if [ -z "${SCHEMA_SET[$var]:-}" ]; then
    printf '✗ scripts/install.sh writes %s= but the variable is missing from .env.production.example\n' "$var" >&2
    errors=$((errors + 1))
  fi
done

# ─── Check 3: no @default: with unquoted spaces ─────────────────────────
# Both the Go parser (cmd/upgrade.go envfile) and the bash parser
# (scripts/sync-env.sh) tokenise directives by space. A bare
# `@default:foo bar` becomes two tokens — the Go parser errors with
# "unknown directive 'bar'" and the bash one silently truncates to "foo".
# Defaults with spaces MUST be quoted: `@default:"foo bar"`.
while IFS= read -r line; do
  case "$line" in
    *'@default:"'*) continue ;;            # quoted, fine
    *'@default:'*\ *)                      # unquoted with a space after the value
      offending=$(printf '%s' "$line" | sed -E 's/.*(@default:[^@]*).*/\1/')
      printf '✗ unquoted space in directive: %s\n' "$offending" >&2
      printf '  Wrap the value in quotes, e.g. @default:"%s"\n' \
        "$(printf '%s' "$offending" | sed 's/@default://; s/  *$//')" >&2
      errors=$((errors + 1)) ;;
  esac
# Match only real directive lines: `# @...` with no extra leading spaces
# inside the comment body. Documentation lines look like `#   @default:…`.
done < <(grep -E '^# @[^ ]' "$SCHEMA" | grep -F '@default:')

if [ "$errors" -gt 0 ]; then
  printf '\n✗ env schema validation failed with %d error(s).\n' "$errors" >&2
  printf '  Update .env.production.example so it covers every required compose variable\n' >&2
  printf '  and every variable install.sh writes. The schema is the single source of truth.\n' >&2
  exit 1
fi

printf '✓ .env.production.example is coherent with docker-compose.prod.yml and scripts/install.sh\n'
