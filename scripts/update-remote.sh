#!/usr/bin/env bash
#
# Almirant Self-Hosted — remote update helper
#
# Rebuilds and restarts an Almirant stack on a remote host over SSH.
# Handles:
#   - git pull from the repo's current branch
#   - macOS keychain (osxkeychain) bypass needed for non-interactive SSH
#     docker builds — reverted on exit so your normal `docker login` keeps
#     working
#   - `docker compose build` + `up -d --force-recreate`
#   - health-wait + final status print
#
# Usage:
#   ./scripts/update-remote.sh <ssh-host> [service ...]
#
# Examples:
#   ./scripts/update-remote.sh m1pro                 # rebuild all services
#   ./scripts/update-remote.sh m1pro frontend        # frontend + db-init
#   ./scripts/update-remote.sh m1pro frontend backend # scoped services + db-init
#
# Env overrides:
#   ALMIRANT_REMOTE_DIR   Explicit path to the repo on the remote. If unset,
#                         auto-detects among: ~/projects/almirant,
#                         ~/code/almirant, ~/almirant.
#   ALMIRANT_REMOTE_BRANCH Branch to pull (default: main).
#

set -euo pipefail

HOST="${1:?Usage: $0 <ssh-host> [service ...]}"
shift
SERVICES="$*"

REMOTE_DIR="${ALMIRANT_REMOTE_DIR:-}"
BRANCH="${ALMIRANT_REMOTE_BRANCH:-main}"

# ─── Colours ────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
  C_GREEN=$'\033[32m'; C_BLUE=$'\033[34m'; C_RED=$'\033[31m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_BLUE=''; C_RED=''
fi

printf '%sUpdating Almirant on %s%s (branch=%s, services=%s)\n\n' \
  "$C_BOLD$C_BLUE" "$HOST" "$C_RESET" "$BRANCH" "${SERVICES:-all}"

# ─── Run the remote payload ─────────────────────────────────────────────
# Pass vars through the ssh env, run a self-contained bash -s script. The
# heredoc is single-quoted so nothing gets expanded locally — the remote
# script reads REMOTE_DIR_HINT / SERVICES / BRANCH from its own env.

ssh -o LogLevel=ERROR -o BatchMode=yes "$HOST" \
  "REMOTE_DIR_HINT='$REMOTE_DIR' SERVICES='$SERVICES' BRANCH='$BRANCH' bash -s" <<'REMOTE'
set -euo pipefail

# macOS Docker Desktop binaries live under /usr/local/bin.
export PATH=/usr/local/bin:$PATH

log()  { printf '▸ %s\n' "$*"; }
ok()   { printf '✓ %s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*" >&2; }
die()  { printf '✗ %s\n' "$*" >&2; exit 1; }

# ─── Locate the repo ────────────────────────────────────────────────────
if [ -n "${REMOTE_DIR_HINT:-}" ]; then
  DIR="$REMOTE_DIR_HINT"
  [ -d "$DIR/.git" ] || die "ALMIRANT_REMOTE_DIR='$DIR' is not a git repo"
else
  DIR=""
  for candidate in \
      "$HOME/projects/almirant" \
      "$HOME/code/almirant" \
      "$HOME/almirant"; do
    if [ -d "$candidate/.git" ]; then
      DIR="$candidate"
      break
    fi
  done
  [ -z "$DIR" ] && die "Could not find almirant repo on remote. Set ALMIRANT_REMOTE_DIR."
fi

log "Using repo: $DIR"
cd "$DIR"

# ─── git pull ───────────────────────────────────────────────────────────
log "git pull origin $BRANCH"
git fetch origin "$BRANCH"
git checkout -q "$BRANCH" 2>/dev/null || true
git pull --ff-only origin "$BRANCH"
CURRENT_SHA=$(git rev-parse --short HEAD)
ok "At $CURRENT_SHA"

# ─── env-sync ───────────────────────────────────────────────────────────
# Reconcile .env.production against the schema in .env.production.example.
# This adds any new variables introduced by the upgrade — without it, the
# subsequent `docker compose up` would fail on `${VAR:?…}` interpolation.
# Older clones may not ship the helper; skip silently in that case.
if [ -x "scripts/sync-env.sh" ]; then
  log "Reconciling .env.production with schema"
  if ! scripts/sync-env.sh; then
    die "env-sync failed — see output above"
  fi
else
  warn "scripts/sync-env.sh not present — skipping env reconciliation (older stack)"
fi

# ─── Env URL normalization ──────────────────────────────────────────────
# Older or hand-edited installs can accidentally persist NEXT_PUBLIC_API_URL
# with a duplicated /api suffix. The frontend request client guards this at
# runtime too, but normalizing before rebuild fixes the source.
if [ -f ".env.production" ]; then
  log "Normalizing API URL settings"
  python3 - <<'PY'
from pathlib import Path

path = Path(".env.production")
lines = path.read_text().splitlines()
changed = False

def normalize_api_base(value: str) -> str:
    normalized = value.strip().rstrip("/")
    while normalized.endswith("/api/api"):
        normalized = normalized[:-4]
    return normalized

next_lines = []
for line in lines:
    if line.startswith("NEXT_PUBLIC_API_URL="):
        key, value = line.split("=", 1)
        normalized = normalize_api_base(value)
        if normalized != value:
            changed = True
            line = f"{key}={normalized}"
    next_lines.append(line)

if changed:
    path.write_text("\n".join(next_lines) + "\n")
    print("✓ Normalized NEXT_PUBLIC_API_URL duplicated /api suffix")
else:
    print("✓ API URL settings already canonical")
PY
fi

# ─── macOS keychain bypass ──────────────────────────────────────────────
# Docker's credsStore=osxkeychain fails under ssh non-TTY because the
# keychain is locked. Bypass temporarily and always restore on exit.
NEEDS_BYPASS=0
if [ "$(uname -s)" = "Darwin" ] && [ -f "$HOME/.docker/config.json" ]; then
  if grep -q '"credsStore"' "$HOME/.docker/config.json"; then
    NEEDS_BYPASS=1
  fi
fi

restore_creds() {
  if [ "$NEEDS_BYPASS" = "1" ]; then
    python3 - <<'PY' 2>/dev/null || true
import json, os
p = os.path.expanduser("~/.docker/config.json")
try:
    with open(p) as f:
        cfg = json.load(f)
except Exception:
    raise SystemExit(0)
backup = cfg.pop("_almirant_cred_backup", None)
if backup:
    cfg["credsStore"] = backup
with open(p, "w") as f:
    json.dump(cfg, f, indent="\t")
PY
  fi
}
trap restore_creds EXIT INT TERM

if [ "$NEEDS_BYPASS" = "1" ]; then
  log "Disabling osxkeychain credHelper for this build (restored on exit)"
  python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.docker/config.json")
with open(p) as f:
    cfg = json.load(f)
cfg["_almirant_cred_backup"] = cfg.pop("credsStore", None)
with open(p, "w") as f:
    json.dump(cfg, f, indent=2)
PY
fi

# Scoped upgrades must still run db-init because it owns database migrations
# and registered data backfills. Unscoped upgrades already include every service.
if [ -n "${SERVICES:-}" ]; then
  case " $SERVICES " in
    *" db-init "*) ;;
    *)
      SERVICES="db-init $SERVICES"
      log "Including db-init so migrations and registered data backfills run"
      ;;
  esac
fi

# ─── Build + up ─────────────────────────────────────────────────────────
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

# Inject the current git SHA so the backend reports its build version.
export ALMIRANT_BUILD_SHA
ALMIRANT_BUILD_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

log "Building ${SERVICES:-all services} (revision ${ALMIRANT_BUILD_SHA:0:7})…"
if [ -f "config/shim-images.json" ]; then
  log "Syncing shim image env values with config/shim-images.json"
  python3 - <<'PY'
import json
from pathlib import Path

manifest = json.loads(Path("config/shim-images.json").read_text())
env_path = Path(".env.production")
env_vars = {
    "opencode": "OPENCODE_IMAGE",
    "claude": "CLAUDE_SHIM_IMAGE",
    "codex": "CODEX_SHIM_IMAGE",
}

if not env_path.exists():
    raise SystemExit(0)

lines = env_path.read_text().splitlines()
seen = set()
changed = False
updates = []
skipped = []


def current_value(line):
    if line.lstrip().startswith("#") or "=" not in line:
        return None
    key, value = line.split("=", 1)
    return key, value


def unquoted(value):
    value = value.split("#", 1)[0].strip()
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    return value


def is_managed(value, repository):
    value = unquoted(value)
    return value == "" or value == repository or value.startswith(f"{repository}:")


next_lines = []
for line in lines:
    parsed = current_value(line)
    if parsed is None:
        next_lines.append(line)
        continue

    key, value = parsed
    name = next((n for n, env_var in env_vars.items() if env_var == key), None)
    if name is None:
        next_lines.append(line)
        continue

    entry = manifest[name]
    image = f"{entry['repository']}:{entry['tag']}"
    seen.add(key)
    if unquoted(value) == image:
        next_lines.append(line)
    elif is_managed(value, entry["repository"]):
        next_lines.append(f"{key}={image}")
        updates.append((key, value, image))
        changed = True
    else:
        next_lines.append(line)
        skipped.append((key, value, image))

missing = [name for name, env_var in env_vars.items() if env_var not in seen]
if missing:
    next_lines.extend([
        "",
        "# ─── Managed by almirant upgrade: shim image versions ──────────",
    ])
    for name in missing:
        entry = manifest[name]
        key = env_vars[name]
        image = f"{entry['repository']}:{entry['tag']}"
        next_lines.append(f"{key}={image}")
        updates.append((key, "", image))
        changed = True

if changed:
    env_path.write_text("\n".join(next_lines) + "\n")

for key, old, image in updates:
    if old:
        print(f"✓ Updated {key} from {old} to {image}")
    else:
        print(f"✓ Added {key}={image}")
for key, value, image in skipped:
    print(f"⚠ Keeping custom {key}={value} (manifest expects {image})")
if not updates and not skipped:
    print("✓ Shim image env values already match the manifest")
PY

  mapfile -t SHIM_TARGETS < <(python3 - <<'PY'
import json
from pathlib import Path

manifest = json.loads(Path("config/shim-images.json").read_text())
for name in ("opencode", "claude", "codex"):
    entry = manifest[name]
    print(f"{name}-shim|{entry['repository']}:{entry['tag']}")
PY
  )

  MISSING_SHIM_SERVICES=()
  for target in "${SHIM_TARGETS[@]}"; do
    service="${target%%|*}"
    image="${target#*|}"
    if docker image inspect "$image" >/dev/null 2>&1; then
      log "Shim image already present: $image"
    else
      log "Shim image missing, will build: $image"
      MISSING_SHIM_SERVICES+=("$service")
    fi
  done

  if [ "${#MISSING_SHIM_SERVICES[@]}" -gt 0 ]; then
    "${COMPOSE[@]}" --profile shims build "${MISSING_SHIM_SERVICES[@]}"
    ok "Built shim images: ${MISSING_SHIM_SERVICES[*]}"
  fi
else
  warn "config/shim-images.json not present — skipping shim image prebuild"
fi

if [ -n "${SERVICES:-}" ]; then
  # shellcheck disable=SC2086
  "${COMPOSE[@]}" up -d --build --force-recreate $SERVICES
else
  "${COMPOSE[@]}" up -d --build --force-recreate
fi
ok "Build + up -d complete"

# ─── Health wait ────────────────────────────────────────────────────────
log "Waiting for services to become healthy (up to ~60s)…"
for i in $(seq 1 12); do
  unhealthy=$(
    "${COMPOSE[@]}" ps --format '{{.Service}}:{{.Health}}' 2>/dev/null \
      | awk -F: '$2 != "" && $2 != "healthy" { print $1 }'
  )
  if [ -z "$unhealthy" ]; then
    ok "All services healthy"
    break
  fi
  printf '  attempt %2d/12: still waiting for: %s\n' "$i" "$(echo "$unhealthy" | tr '\n' ' ')"
  sleep 5
done

# ─── Final status ───────────────────────────────────────────────────────
printf '\n=== Final status ===\n'
"${COMPOSE[@]}" ps --format "table {{.Service}}\t{{.Status}}"
printf '\nDone. Revision: %s\n' "$CURRENT_SHA"
REMOTE

EXIT_CODE=$?
printf '\n'
if [ $EXIT_CODE -eq 0 ]; then
  printf '%s✓ Update completed on %s%s\n' "$C_GREEN$C_BOLD" "$HOST" "$C_RESET"
else
  printf '%s✗ Update failed on %s (exit %d)%s\n' "$C_RED$C_BOLD" "$HOST" "$EXIT_CODE" "$C_RESET"
  exit $EXIT_CODE
fi
