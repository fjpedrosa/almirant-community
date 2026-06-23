# Upgrades

There are three ways to upgrade a self-hosted Almirant. They all converge
on the same final state — pick whichever matches your operational style.

| Path | When to use | Touches `.env.production`? |
|------|-------------|----------------------------|
| Click-to-update (UI) | Day-to-day, single admin | No |
| `almirant upgrade` (CLI) | Scripted upgrades, fleet | Yes — auto-syncs missing variables |
| `scripts/update-remote.sh` (manual) | No CLI installed, raw SSH | Yes — same auto-sync via `scripts/sync-env.sh` |

## Env reconciliation (auto)

Every upgrade path runs `.env.production` through the same reconciler
**before** invoking `docker compose up`. The reconciler reads
`.env.production.example` (the schema) and **adds any missing variables**
using the recipes declared inline. Existing values are never overwritten,
and a timestamped backup is written next to the file before any change.

This is what fixed the case where introducing `UPDATER_INTERNAL_TOKEN`
broke older instances on upgrade — the schema declares the variable as
`@required @generate:rand-hex:32`, so the upgrader generates and inserts
it for you.

### Schema directives

`.env.production.example` is the single source of truth for every
variable consumed by `docker-compose.prod.yml` and `scripts/install.sh`.
A CI guard (`scripts/validate-env-schema.sh`) blocks any PR that adds a
required compose variable without declaring it here.

| Directive | Behaviour |
|-----------|-----------|
| `@required` | MUST be present in `.env.production`. Blocks the upgrade if no recipe can materialise it. |
| `@optional` | May be missing or empty. Default. |
| `@generate:rand-hex:N` | Cryptographically random hex of `N` bytes. |
| `@generate:rand-password:N` | `N`-char alphanumeric password. |
| `@generate:uuid` | Random UUID v4. |
| `@generate:prefix-rand-hex:p:N` | `<p><N-byte hex>` (e.g. `alm_sa_…`). |
| `@derive:stack-dir` | Absolute path to the cloned repo. |
| `@derive:stack-dir:<sub>` | `stack-dir` joined with `<sub>`. |
| `@derive:same-as:VAR` | Copy the value of another variable. |
| `@default:<value>` | Literal fallback. |
| `@prompt:"<msg>"` | Interactive prompt (install.sh only). |

Directives stack on consecutive `# @` lines immediately above a `VAR=`.

### Inspecting before applying

```bash
almirant upgrade --check-env          # report what would be added; exit 0
bash scripts/sync-env.sh --check      # bash equivalent (no CLI required)
```

### Disabling

```bash
almirant upgrade --no-env-sync        # skip reconciliation (advanced)
```

You become responsible for keeping `.env.production` in sync. Recommended
only when you manage env via your own tooling (Ansible, sealed secrets…).

### Recovering from a bad sync

Each run writes `.env.production.bak.<unix-timestamp>` next to the file
before mutating. Restore with:

```bash
cp .env.production.bak.<ts> .env.production
```

Backups are not pruned automatically — they are plain text and small.

---

## Database maintenance and data backfills

Every upgrade path recreates the production stack through Docker Compose. The
`db-init` service runs before `backend` and is the single automatic hook for
database maintenance:

1. ensure required extensions exist,
2. apply Drizzle schema migrations,
3. run registered data backfills recorded in the `data_backfills` ledger,
4. seed self-hosted platform defaults.

Backfills are idempotent: each registered backfill has a stable key and
checksum. Once a checksum succeeds, future upgrades skip it; changing the
checksum reruns that backfill intentionally. Non-critical historical repair
backfills can fail without blocking startup and will be retried by the next
upgrade; schema-critical backfills can be marked fatal.

Scoped CLI/manual upgrades include `db-init` automatically, so commands like
`almirant upgrade runner` or `scripts/update-remote.sh <host> runner` still run
migrations and registered backfills during the same upgrade. When `backend` is
recreated, Compose waits for `db-init` to finish successfully.
Click-to-update already rebuilds every service except `updater`, so it includes
`db-init` by default.

---

# Click-to-update (in-stack updater)

A self-hosted Almirant can apply its own updates from the dashboard. An
admin sees a banner when `main` is ahead of the running build, presses
**Update now**, and the stack rebuilds itself in place.

The flow is driven by a sidecar service called `updater` that ships with
`docker-compose.prod.yml`. The backend cannot rebuild itself (it runs
inside a container without Docker, git, or the source tree), so it
proxies all update requests to the sidecar.

## Architecture

```
                Dashboard (admin)
                       │
                       ▼
              POST /api/instance/update
                       │
              ┌────────┴────────┐
              │ backend         │   ← admin-gated, no Docker access
              └────────┬────────┘
                       │  X-Updater-Token  (internal docker network)
                       ▼
              ┌─────────────────┐
              │ updater         │   ← bind-mounts ${ALMIRANT_REPO_PATH}
              │                 │     bind-mounts /var/run/docker.sock
              └────────┬────────┘
                       │
   git fetch + git pull --ff-only origin main
   docker compose build <services excluding updater>
   build missing shim images declared in config/shim-images.json
   docker compose up -d --force-recreate <services excluding updater>
   wait for healthchecks
                       │
                       ▼
              backend reconnects, banner re-evaluates
```

The `updater` is excluded from `--force-recreate` so it survives the
rebuild it triggers. Job state lives in the updater's memory and is
queryable for ~1 hour after completion.

## What gets rebuilt

`docker compose config --services` is queried at update time and any
service NOT in `UPDATER_EXCLUDE_SERVICES` (default: `updater`) is
recreated with the new image. New services added to your compose file
are picked up automatically.

Agent shims are different: they are image-only services behind the
`shims` Compose profile and are never started by `up`. Before recreating
the runner, the updater reads `config/shim-images.json`, aligns the
managed shim image variables in `.env.production` when they still point
to previous local `almirant-*-shim:*` tags, checks whether each declared
image tag already exists locally, and runs
`docker compose --profile shims build <missing-shim-services>` only for
missing tags. This keeps `almirant upgrade` aligned with the initial
`almirant install` behaviour without starting long-running shim services.
Custom shim image values are preserved and logged instead of overwritten.

## Security model

- The updater listens on port 9999 on the internal compose network only
  — never published to the host.
- All `/jobs*` endpoints require a shared token (`UPDATER_INTERNAL_TOKEN`)
  passed via `X-Updater-Token`. Backend ↔ updater is the only caller.
- Backend routes are admin-only (`requireAdmin` middleware). Non-admins
  see the read-only banner with the "Copy command" fallback.
- Subcommands invoked by the updater are whitelisted: only
  `git fetch|pull|rev-parse`, `docker image inspect`, and
  `docker compose build|up|ps|config`.
  Branch and service names are validated against tight regexes before
  reaching `Bun.spawn`.

## Configuration

Generated automatically by `scripts/install.sh` on first run. To enable
on an existing install, append to `.env.production`:

```bash
# Shared backend ↔ updater secret
UPDATER_INTERNAL_TOKEN=<openssl rand -hex 32>

# Path to this clone on the host (where install.sh ran)
ALMIRANT_REPO_PATH=/absolute/path/to/almirant

# Optional overrides
UPDATER_BRANCH=main                 # branch to pull
UPDATER_EXCLUDE_SERVICES=updater    # comma-separated, never recreated
```

Then bring the new service up:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  up -d --build updater
```

The banner will start showing **Update now** within 60 seconds (the
backend caches the availability probe).

## Disabling

Two ways:

1. **Drop the sidecar from compose.** Comment out the `updater:` service
   block in `docker-compose.prod.yml` and `docker compose up -d`. The
   backend's `/instance/update/available` will return false and the banner
   falls back to the existing **Copy command** UX.

2. **Keep the sidecar but unset the token.** Remove `UPDATER_INTERNAL_TOKEN`
   from `.env.production` — the backend skips the proxy entirely when the
   token is missing. Same fallback behaviour.

## Troubleshooting

```bash
# Tail the updater
docker compose -f docker-compose.prod.yml --env-file .env.production \
  logs -f updater

# Active job state
curl -s -H "X-Updater-Token: $UPDATER_INTERNAL_TOKEN" \
  http://<host>/api/instance/update/active

# Manual fallback (always works)
./scripts/update-remote.sh <ssh-host>
```

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Banner shows "Copy command" instead of "Update now" | Updater unreachable from backend | Check `docker compose ps updater`. Backend caches availability for 60s. |
| `POST /jobs` returns 409 mid-update | Concurrent click | UI auto-recovers — it polls `/jobs/active` and hydrates the existing job. |
| Build step hangs on first run | First-time layer pull | Pull is bounded to 30 min. Watch `docker compose logs -f` from the host. |
| Modal stuck on "Restarting…" past 5 min | Rebuild failed silently | Updater times out and reports `failed`. Check `docker compose ps` and service logs. |
| `docker compose config --services` errors | Wrong `COMPOSE_FILE` / `ENV_FILE` env in updater service | Both must point to files visible inside the bind-mounted `/repo`. |

## Out of scope (for now)

- Selecting individual services to update (the UI rebuilds everything
  except the excluded list).
- Automatic rollback if the rebuild leaves the stack unhealthy.
- Pre-rebuild migration/backfill validation (Drizzle migrations and registered
  data backfills still run in `db-init` at boot — a broken fatal migration or
  fatal backfill in the new build will block startup, and the banner will
  surface the failed health check).

For those, fall back to the manual flow:

```bash
./scripts/update-remote.sh <ssh-host>
# or, equivalently, from a developer machine:
almirant upgrade --host <ssh-host>
```
