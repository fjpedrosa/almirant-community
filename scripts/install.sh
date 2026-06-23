#!/usr/bin/env bash
#
# Almirant Self-Hosted — source installer
#
# Run from inside a freshly cloned repo:
#
#   git clone https://github.com/almirant-ai/almirant.git
#   cd almirant
#   ./scripts/install.sh
#
# What it does:
#   1. Verifies Docker + Docker Compose v2.
#   2. Generates .env.production with random secrets (kept if it exists).
#   3. Builds the production images locally (docker compose build).
#   4. Starts the stack (docker compose up -d).
#   5. Waits for health and prints the app URL.
#
# Env overrides (all optional):
#   ALMIRANT_NONINTERACTIVE=1    Skip prompts (use defaults).
#   ALMIRANT_DOMAIN=...          Domain for the built-in public Caddy proxy.
#   ALMIRANT_PROXY_MODE=...      none|caddy|external|local (default: auto).
#   ALMIRANT_BIND_ADDRESS=...    Direct host bind address (default: 127.0.0.1).
#   RUNNER_RAM_RESERVED_MB=...    RAM kept free for host/builds (default: 2048).
#   RUNNER_RAM_BUDGET_ENABLED=... true|false RAM-aware agent scheduling (default: true).
#   MAX_CONCURRENT=...            Runner slot cap; RAM budgeting adds a dynamic memory bound on top.
#   ALMIRANT_WITH_PROXY=1        Legacy: enable the localhost-only Caddy profile.
#   ALMIRANT_WITH_DISCORD=1      Enable the Discord bridge profile.
#   ALMIRANT_PUBLIC_URL=...      Public URL (default: http://localhost:8080).
#

set -euo pipefail

# ─── Colours and logging helpers ────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_BLUE=$'\033[34m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BLUE=''
fi

log()  { printf '%s%s%s\n' "$C_BLUE" "▸ $*" "$C_RESET"; }
ok()   { printf '%s%s%s\n' "$C_GREEN" "✓ $*" "$C_RESET"; }
warn() { printf '%s%s%s\n' "$C_YELLOW" "⚠ $*" "$C_RESET"; }
die()  { printf '%s%s%s\n' "$C_RED" "✗ $*" "$C_RESET" >&2; exit 1; }

# ─── Configuration ──────────────────────────────────────────────────────
ALMIRANT_NONINTERACTIVE="${ALMIRANT_NONINTERACTIVE:-0}"
ALMIRANT_WITH_PROXY="${ALMIRANT_WITH_PROXY:-0}"
ALMIRANT_WITH_DISCORD="${ALMIRANT_WITH_DISCORD:-0}"
ALMIRANT_PUBLIC_URL="${ALMIRANT_PUBLIC_URL:-}"
ALMIRANT_DOMAIN="${ALMIRANT_DOMAIN:-}"
ALMIRANT_PROXY_MODE="${ALMIRANT_PROXY_MODE:-}"
ALMIRANT_BIND_ADDRESS="${ALMIRANT_BIND_ADDRESS:-127.0.0.1}"
RUNNER_RAM_BUDGET_ENABLED="${RUNNER_RAM_BUDGET_ENABLED:-true}"
RUNNER_RAM_RESERVED_MB="${RUNNER_RAM_RESERVED_MB:-2048}"
MAX_CONCURRENT="${MAX_CONCURRENT:-4}"

# Resolve the repo root (the script sits at <repo>/scripts/install.sh).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

# ─── Preflight checks ───────────────────────────────────────────────────
preflight() {
  log "Checking requirements…"

  if [ ! -f "$REPO_DIR/$COMPOSE_FILE" ]; then
    die "$COMPOSE_FILE not found in $REPO_DIR. Run this script from inside a cloned Almirant repo."
  fi

  command -v docker >/dev/null 2>&1 || die "Docker is not installed or not in PATH."

  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon is not running (or current user lacks access). Start Docker Desktop or add your user to the 'docker' group."
  fi

  if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose v2 is required. Update Docker Desktop or install 'docker-compose-plugin'."
  fi

  local docker_version
  docker_version="$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  ok "Docker $docker_version + Compose v2 detected"
}

# ─── Secret generation ──────────────────────────────────────────────────
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    die "Cannot generate secure random secret (no openssl and no /dev/urandom)."
  fi
}

gen_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr -d '/+=' | head -c 24
  elif [ -r /dev/urandom ]; then
    head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 24
  else
    die "Cannot generate password."
  fi
}

# ─── Interactive prompts ────────────────────────────────────────────────
prompt_with_default() {
  local label="$1"
  local default="$2"
  local reply

  if [ "$ALMIRANT_NONINTERACTIVE" = "1" ]; then
    printf '%s\n' "$default"
    return
  fi

  if [ -t 0 ]; then
    read -r -p "$label [$default]: " reply || reply=""
  elif [ -r /dev/tty ]; then
    read -r -p "$label [$default]: " reply </dev/tty || reply=""
  else
    reply=""
  fi

  if [ -z "$reply" ]; then
    printf '%s\n' "$default"
  else
    printf '%s\n' "$reply"
  fi
}

normalize_public_url() {
  local value="${1%/}"

  while [ "${value%/api}" != "$value" ]; do
    value="${value%/api}"
    value="${value%/}"
  done

  printf '%s\n' "$value"
}

extract_hostname() {
  local value="$1"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%%:*}"
  printf '%s\n' "$value"
}

resolve_proxy_mode() {
  local site_domain="$1"
  local mode="$ALMIRANT_PROXY_MODE"

  if [ -z "$mode" ]; then
    if [ -n "$ALMIRANT_DOMAIN" ]; then
      mode="caddy"
    elif [ "$ALMIRANT_WITH_PROXY" = "1" ]; then
      mode="local"
    elif [ "$ALMIRANT_BIND_ADDRESS" != "127.0.0.1" ]; then
      mode="none"
    elif [ "$site_domain" != "localhost" ] && [ "$site_domain" != "127.0.0.1" ]; then
      mode="external"
    else
      mode="none"
    fi
  fi

  case "$mode" in
    none|caddy|external|local)
      printf '%s\n' "$mode"
      ;;
    tailnet)
      printf '%s\n' "local"
      ;;
    *)
      die "Invalid ALMIRANT_PROXY_MODE='$mode' (expected: none, caddy, external, local)."
      ;;
  esac
}

# ─── Install steps ──────────────────────────────────────────────────────
write_env() {
  local env_path="$REPO_DIR/$ENV_FILE"

  if [ -f "$env_path" ]; then
    warn "$ENV_FILE already exists — keeping existing values"
    return
  fi

  log "Generating $ENV_FILE with random secrets"

  local default_url="http://localhost:8080"
  local site_url
  if [ -n "$ALMIRANT_PUBLIC_URL" ]; then
    site_url="$ALMIRANT_PUBLIC_URL"
  else
    printf '\n'
    printf '  This URL must match what users type in the browser. Examples:\n'
    printf '    http://localhost:8080                         (local-only)\n'
    printf '    https://almirant.example.com                  (custom domain)\n'
    printf '    https://<host>.<tailnet>.ts.net               (Tailscale serve)\n'
    printf '  Changing this later requires a frontend rebuild.\n\n'
    site_url=$(prompt_with_default "Public URL where Almirant will be served (no trailing slash)" "$default_url")
  fi

  local raw_site_url="$site_url"
  site_url=$(normalize_public_url "$site_url")
  if [ "$site_url" != "$raw_site_url" ]; then
    warn "Public URL must be the app origin, not the API base. Normalized '$raw_site_url' → '$site_url'"
  fi

  local site_domain proxy_mode
  site_domain="${ALMIRANT_DOMAIN:-$(extract_hostname "$site_url")}"
  proxy_mode="$(resolve_proxy_mode "$site_domain")"
  ALMIRANT_DOMAIN="$site_domain"
  ALMIRANT_PROXY_MODE="$proxy_mode"

  local postgres_password encryption_key better_auth_secret email_api_secret api_key updater_token
  postgres_password=$(gen_password)
  encryption_key=$(gen_secret)
  better_auth_secret=$(gen_secret)
  email_api_secret=$(gen_secret)
  # ALMIRANT_API_KEY must be shaped as `alm_sa_<hex>` — preview-seed.ts
  # validates the prefix and rejects keys without it.
  api_key="alm_sa_$(gen_secret)"
  # Shared between backend ↔ updater sidecar for click-to-update.
  updater_token=$(gen_secret)

  cat > "$env_path" <<ENV
# Generated by scripts/install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# Edit any value and re-run \`docker compose -f $COMPOSE_FILE --env-file $ENV_FILE up -d\` to apply.

# ─── Postgres (data persists in the postgres_prod_data docker volume) ──
POSTGRES_USER=almirant
POSTGRES_PASSWORD=${postgres_password}
POSTGRES_DB=almirant

# ─── Public URL ─────────────────────────────────────────────────────────
# Must match the URL your users will type in the browser. Better Auth
# validates cookies and CORS against these values on every request.
#
# IMPORTANT: NEXT_PUBLIC_SITE_URL is baked into the frontend bundle at
# build time. If you change any of these four URLs later, you must
# rebuild the frontend:
#   docker compose -f docker-compose.prod.yml --env-file .env.production \\
#     up -d --build --force-recreate frontend backend
NEXT_PUBLIC_SITE_URL=${site_url}
ALMIRANT_DOMAIN=${site_domain}
ALMIRANT_PROXY_MODE=${proxy_mode}
BETTER_AUTH_URL=${site_url}
BETTER_AUTH_TRUSTED_ORIGINS=${site_url}
CORS_ORIGIN=${site_url}
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_WS_URL=

# ─── Secrets — DO NOT share or commit. Regenerating invalidates all ─────
# ─── existing sessions and encrypted values. ────────────────────────────
ENCRYPTION_KEY=${encryption_key}
BETTER_AUTH_SECRET=${better_auth_secret}
INTERNAL_EMAIL_API_SECRET=${email_api_secret}
ALMIRANT_API_KEY=${api_key}
# Shared backend ↔ updater sidecar for the click-to-update banner.
UPDATER_INTERNAL_TOKEN=${updater_token}

# ─── Click-to-update sidecar ────────────────────────────────────────────
# Path to this clone on the host — bind-mounted into the updater so it can
# git pull + docker compose up -d --build against the same files
# install.sh just used. Required by docker-compose.prod.yml.
ALMIRANT_REPO_PATH=${REPO_DIR}

# ─── Host ports (bound to 127.0.0.1 — put a reverse proxy to expose) ───
ALMIRANT_BIND_ADDRESS=${ALMIRANT_BIND_ADDRESS}
FRONTEND_HOST_PORT=8080
BACKEND_HOST_PORT=8081
PROXY_PORT=8080
HTTP_PORT=80
HTTPS_PORT=443

# ─── Host path for agent repo workspaces (sibling-container mounts) ────
REPOS_HOST_PATH=${REPO_DIR}/data/repos

# ─── Logging ────────────────────────────────────────────────────────────
LOG_LEVEL=info

# ─── Runner capacity ────────────────────────────────────────────────────
# RUNNER_RAM_RESERVED_MB is kept free for the host and frontend/backend image
# builds during upgrades. RUNNER_RAM_BUDGET_ENABLED lets the runner claim jobs
# based on actual available RAM instead of a static slot count.
RUNNER_RAM_BUDGET_ENABLED=${RUNNER_RAM_BUDGET_ENABLED}
RUNNER_RAM_RESERVED_MB=${RUNNER_RAM_RESERVED_MB}
# CPU/operational safety cap; RAM budgeting adds a dynamic memory bound on top.
MAX_CONCURRENT=${MAX_CONCURRENT}

# Discord bridge (only used when ALMIRANT_WITH_DISCORD=1)
# DISCORD_BOT_TOKEN=
# DISCORD_CHANNEL_ID=

# Runner extras
ENABLE_BROWSER=false
NIGHTLY_ENABLED=false
WEB_OUTPUT_ENABLED=true
ENV

  chmod 600 "$env_path"
  mkdir -p "$REPO_DIR/data/repos"
  ok "Wrote $env_path"
  if [ "$proxy_mode" = "caddy" ]; then
    ok "Configured built-in public Caddy proxy for ${site_domain}"
  elif [ "$proxy_mode" = "external" ]; then
    warn "Proxy mode is external — route ${site_url}, /api, /mcp and /ws to this stack from your reverse proxy."
  fi
}

selected_proxy_mode() {
  local mode="$ALMIRANT_PROXY_MODE"
  if [ -z "$mode" ] && [ -f "$REPO_DIR/$ENV_FILE" ]; then
    mode="$(grep -E '^ALMIRANT_PROXY_MODE=' "$REPO_DIR/$ENV_FILE" | head -n1 | cut -d'=' -f2- || true)"
  fi
  if [ -z "$mode" ] && [ "$ALMIRANT_WITH_PROXY" = "1" ]; then
    mode="local"
  fi
  case "$mode" in
    caddy|public)
      printf '%s\n' "caddy" ;;
    local|tailnet)
      printf '%s\n' "local" ;;
    external|none|"")
      printf '%s\n' "$mode" ;;
    *)
      die "Invalid ALMIRANT_PROXY_MODE='$mode' (expected: none, caddy, external, local)." ;;
  esac
}

build_compose_args() {
  # Helper: emits the profile flags for the selected opt-in services.
  local args=("-f" "$COMPOSE_FILE" "--env-file" "$ENV_FILE")
  case "$(selected_proxy_mode)" in
    caddy) args+=("--profile" "public-proxy") ;;
    local) args+=("--profile" "with-proxy") ;;
  esac
  [ "$ALMIRANT_WITH_DISCORD" = "1" ] && args+=("--profile" "discord-bridge")
  # Shim images are always built so the runner can launch agents. The shim
  # services themselves never start — the `shims` profile is build-only.
  args+=("--profile" "shims")
  printf '%s\n' "${args[@]}"
}

build_stack() {
  log "Building images from source (first run takes ~10-20 minutes)"
  local args
  mapfile -t args < <(build_compose_args)
  cd "$REPO_DIR"
  # Inject current git SHA so the running backend can report its version.
  export ALMIRANT_BUILD_SHA
  ALMIRANT_BUILD_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  docker compose "${args[@]}" build
  ok "Images built (revision: ${ALMIRANT_BUILD_SHA:0:7})"
}

start_stack() {
  log "Starting the stack"
  local args=("-f" "$COMPOSE_FILE" "--env-file" "$ENV_FILE")
  case "$(selected_proxy_mode)" in
    caddy) args+=("--profile" "public-proxy") ;;
    local) args+=("--profile" "with-proxy") ;;
  esac
  [ "$ALMIRANT_WITH_DISCORD" = "1" ] && args+=("--profile" "discord-bridge")
  cd "$REPO_DIR"
  docker compose "${args[@]}" up -d
  ok "Containers started"
}

wait_for_health() {
  log "Waiting for services to become healthy (up to ~3 minutes)…"
  local attempts=0
  local max_attempts=36
  cd "$REPO_DIR"
  while [ $attempts -lt $max_attempts ]; do
    local frontend_state
    frontend_state=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps frontend --format '{{.Health}}' 2>/dev/null || echo "")
    if [ "$frontend_state" = "healthy" ]; then
      ok "Frontend is healthy"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  warn "Frontend did not become healthy within the window. Inspect logs: (cd $REPO_DIR && docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs -f frontend backend)"
  return 1
}

print_summary() {
  local site_url
  site_url=$(grep -E '^NEXT_PUBLIC_SITE_URL=' "$REPO_DIR/$ENV_FILE" | head -n1 | cut -d'=' -f2-)
  [ -z "$site_url" ] && site_url="http://localhost:8080"
  local proxy_mode
  proxy_mode=$(grep -E '^ALMIRANT_PROXY_MODE=' "$REPO_DIR/$ENV_FILE" | head -n1 | cut -d'=' -f2-)
  [ -z "$proxy_mode" ] && proxy_mode="none"

  printf '\n'
  printf '%s%s─── Almirant is up ───────────────────────────────%s\n' "$C_BOLD" "$C_GREEN" "$C_RESET"
  printf '  URL:        %s\n' "$site_url"
  printf '  Proxy mode: %s\n' "$proxy_mode"
  local ram_reserved ram_budget
  ram_budget=$(grep -E '^RUNNER_RAM_BUDGET_ENABLED=' "$REPO_DIR/$ENV_FILE" | head -n1 | cut -d'=' -f2- || true)
  ram_reserved=$(grep -E '^RUNNER_RAM_RESERVED_MB=' "$REPO_DIR/$ENV_FILE" | head -n1 | cut -d'=' -f2- || true)
  [ -z "$ram_budget" ] && ram_budget="true"
  [ -z "$ram_reserved" ] && ram_reserved="2048"
  printf '  Runner RAM: budget=%s, reserved=%s MB\n' "$ram_budget" "$ram_reserved"
  printf '  Repo dir:   %s\n' "$REPO_DIR"
  printf '  Env file:   %s/%s\n' "$REPO_DIR" "$ENV_FILE"
  printf '\n'
  printf 'Next steps:\n'
  printf '  1. Open %s and complete the onboarding wizard (create admin, set public URL).\n' "$site_url"
  printf '  2. Day-2 ops (from %s):\n' "$REPO_DIR"
  printf '       docker compose -f %s --env-file %s logs -f\n' "$COMPOSE_FILE" "$ENV_FILE"
  printf '       docker compose -f %s --env-file %s ps\n' "$COMPOSE_FILE" "$ENV_FILE"
  printf '       # Before upgrades on busy instances, drain/pause agent work so frontend builds keep RAM headroom.\n'
  printf '       almirant upgrade   # preferred; also builds missing shim images\n'
  printf '       docker compose -f %s --env-file %s --profile shims build   # manual shim image rebuild\n' "$COMPOSE_FILE" "$ENV_FILE"
  printf '       docker compose -f %s --env-file %s down   # stop (data persists)\n' "$COMPOSE_FILE" "$ENV_FILE"
  printf '  3. Backups: postgres data lives in the %s docker volume. See docs/self-hosting/backups.md.\n' "postgres_prod_data"
  printf '%s──────────────────────────────────────────────────%s\n\n' "$C_GREEN" "$C_RESET"
}

# ─── Main ───────────────────────────────────────────────────────────────
main() {
  printf '%s%sAlmirant self-hosted installer (from source)%s\n' "$C_BOLD" "$C_BLUE" "$C_RESET"
  printf '  Repo: %s\n\n' "$REPO_DIR"

  preflight
  write_env
  build_stack
  start_stack
  wait_for_health || true
  print_summary
}

main "$@"
