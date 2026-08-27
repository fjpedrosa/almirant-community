# Environment Variables Reference

These are the variables that matter for the self-hosted Docker stacks.

- Local/source stack: `.env` + `docker-compose.yml`
- Compiled production/tailnet stack: `.env.production` + `docker-compose.prod.yml`

> **Schema-driven**: `.env.production.example` is the single source of
> truth for every variable consumed in production. Both
> `scripts/install.sh` (initial install) and `almirant upgrade` (running
> stack) reconcile your `.env.production` against it — adding any missing
> variables with auto-generated secrets or derived values, never
> overwriting what is already there. See
> [upgrades.md → Env reconciliation](./upgrades.md#env-reconciliation-auto)
> for the directive grammar.

## Core database / cache

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_DB` | `almirant` | Database name |
| `POSTGRES_USER` | `almirant` | Database user |
| `POSTGRES_PASSWORD` | `almirant_dev_password` | Database password |
| `POSTGRES_PORT` | `5432` | Host port mapped to Postgres |
| `REDIS_PORT` | `6379` | Host port mapped to Redis |
| `DATABASE_URL` | `postgresql://almirant:...@postgres:5432/almirant` | Shared DB connection string |
| `MIGRATION_DATABASE_URL` | _(falls back to `DATABASE_URL`)_ | Direct or session-pooled connection used only by the schema migrator. Required when `DATABASE_URL` uses transaction-pooled PgBouncer. |
| `MIGRATION_LOCK_TIMEOUT_MS` | `60000` | Maximum time the migrator polls for its PostgreSQL advisory lock before failing startup. |

## Service ports

| Variable | Default |
|---|---|
| `WEB_PORT` | `3000` |
| `API_PORT` | `3001` |
| `RUNNER_PORT` | `3002` |
| `DISCORD_BRIDGE_PORT` | `3003` |
| `WEB_BRIDGE_PORT` | `3004` |

## Production / tailnet ingress

| Variable | Default | Purpose |
|---|---|---|
| `PROXY_PORT` | `8080` | Host-local HTTP port published by the reverse proxy; expose this port through Tailscale Serve |
| `ALMIRANT_DOMAIN` | empty | Domain consumed by the built-in public Caddy proxy |
| `ALMIRANT_PROXY_MODE` | `none` | Reverse proxy mode: `none`, `caddy`, `external`, or `local` |
| `ALMIRANT_BIND_ADDRESS` | `127.0.0.1` | Direct host bind address. Keep loopback for host-only access; use `0.0.0.0` or a LAN IP for LAN-only access |
| `HTTP_PORT` | `80` | Host HTTP port for the built-in public Caddy proxy |
| `HTTPS_PORT` | `443` | Host HTTPS port for the built-in public Caddy proxy |
| `NEXT_PUBLIC_SITE_URL` | none | Public HTTPS URL of the instance on your tailnet |
| `NEXT_PUBLIC_API_URL` | `/api` | Browser API base URL for the compiled frontend |
| `NEXT_PUBLIC_WS_URL` | empty | Optional explicit WS URL; leave empty to derive `wss://<same-host>/ws` |
| `BETTER_AUTH_URL` | none | Better Auth base URL; should match the tailnet HTTPS URL (optional in self-hosted: filled in by the wizard) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | none | Trusted frontend origins for auth callbacks and server actions (optional in self-hosted: filled in by the wizard) |
| `CORS_ORIGIN` | none | Backend-allowed browser origin; normally the same tailnet HTTPS URL (optional in self-hosted: filled in by the wizard) |

> **Self-hosted note**: `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` and
> `CORS_ORIGIN` are derived from the public URL configured in the
> `/onboarding` wizard (or `/settings/instance`). You only need to set them
> manually if you skip the wizard or run a setup that should not depend on
> the database for these values.

## Frontend / auth

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Public app URL |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api` | Browser API base URL |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:3001/ws` | Browser websocket URL |
| `BACKEND_URL` | injected by compose | Internal server-side frontend → backend URL |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Better Auth base URL |
| `BETTER_AUTH_SECRET` | local dev default | Session signing secret |
| `INTERNAL_EMAIL_API_SECRET` | local dev default | Shared frontend/backend secret for delegated email actions |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed frontend origin for the backend |

## Production-only backend requirements

| Variable | Default | Purpose |
|---|---|---|
| `ALMIRANT_PROJECT_ID` | none | Required UUID when the backend boots with `NODE_ENV=production` |
| `ENCRYPTION_KEY` | none | 64-char hex secret used for encrypted connection credentials and scoped session tokens |
| `MCP_INTERNAL_ENABLED` | `false` | Keeps `/mcp/internal` disabled by default in production |
| `PI_CODING_AGENT_ADMISSION_ENABLED` | `true` | Pi admission switch. Set explicitly to `false` during rollout or rollback; active Pi jobs continue while the runner drains. |
| `ALMIRANT_API_KEY` | empty | Optional infrastructure/runner key for embedded automation on the same host |

## Runner / agent services

| Variable | Default | Purpose |
|---|---|---|
| `ALMIRANT_API_KEY` | seeded local key | Auth for `runner` and `web-bridge` against the backend |
| `ENABLE_BROWSER` | `false` | Enables browser tooling inside agent containers |
| `WEB_OUTPUT_ENABLED` | `true` | Publishes structured web output events |
| `RUNNER_RAM_BUDGET_ENABLED` | `true` | Enables RAM-aware job claiming based on current available memory and job forecasts |
| `RUNNER_RAM_RESERVED_MB` | `2048` | RAM kept outside the runner budget for the host and upgrade/build spikes |
| `MAX_CONCURRENT` | `4` | Runner slot cap; RAM budgeting adds a dynamic memory bound on top |
| `OPENCODE_IMAGE` | `almirant-opencode-shim:1.18.4` | Local image name for OpenCode jobs |
| `CLAUDE_SHIM_IMAGE` | `almirant-claude-shim:2.1.218` | Local image name for Claude jobs |
| `CODEX_SHIM_IMAGE` | `almirant-codex-shim:0.145.0` | Local image name for Codex jobs |
| `PI_SHIM_IMAGE` | `almirant-pi-shim:0.84.2` (local only) | Pi image. Production Compose requires `DOCKERHUB_USERNAME/almirant-pi-shim@sha256:<digest>`. |

## Pi runtime controls and image

Pi admits only `pi/zai/glm-5.3/api_key`, with no optional capabilities. OpenAI subscription access is disabled. `provider=zipu` remains the infrastructure lane while `aiProvider=zai` selects the exact `https://api.z.ai/api/coding/paas/v4` endpoint.

Enter the Z.AI API key through **Settings → Integrations**, never through a deployment variable or terminal command. For production, set `PI_SHIM_IMAGE` to the immutable Docker Hub manifest emitted by the X64 `publish-docker.yml` workflow:

```text
PI_SHIM_IMAGE=DOCKERHUB_USERNAME/almirant-pi-shim@sha256:<digest>
```

A local Docker `sha256:` image ID is not a registry manifest digest. See the [Pi operator runbook](../operations/pi-coding-agent.md) for publication, terminal/usage authority, sanitized diagnosis, rollout, and rollback.

> **Upgrade/build headroom**: frontend image builds can consume several GB of
> memory independently from active agent containers. For 16-32 GB VPS hosts,
> prefer `RUNNER_RAM_RESERVED_MB=4096` and drain/pause agent work before
> upgrades if the instance is busy.

## Scheduled agent dispatch authority

Two authorities can dispatch `scheduled_agent_configs` (nightly validation,
backlog drain, DoD review/remediation, release integration, and plain
scheduled agents): the **backend**, in-process, on a timer; or the
**runner**, polling the backend over HTTP on its own timer. Exactly one
should be active per installation — running both duplicates jobs for the
deterministic modes (backlog drain, DoD review, release integration), which
create jobs directly without the idempotency guard that only protects the
standalone "scheduled" job type. A pair of unique database indexes acts as a
safety net against that race, not as a substitute for keeping one authority
active.

| Variable | Service | Default | Purpose |
|---|---|---|---|
| `SCHEDULED_AGENT_DISPATCHER_ENABLED` | `backend` | `true` | Backend-native dispatcher. `true` = the backend dispatches; `false` = the runner's own scheduler is the only dispatcher (pre-2026-08-02 behavior). |
| `RUNNER_SCHEDULER_ENABLED` | `runner` | _derived_ | Runner-side scheduler loop. Unset: defaults to the OPPOSITE of `SCHEDULED_AGENT_DISPATCHER_ENABLED` — `false` when the backend flag is unset/`true` (backend owns dispatch), `true` when the backend flag is explicitly `false` (runner owns dispatch). Set explicitly to override either direction. |

**Fresh installs** dispatch from the backend by default — no configuration
needed.

**To go back to the pre-2026-08-02 runner-only behavior** (e.g. you scaled
runners independently of the backend and want the runner to keep deciding
when to dispatch), set in `.env` / `.env.production`:

```
SCHEDULED_AGENT_DISPATCHER_ENABLED=false
```

Because both the `backend` and `runner` services read the same env file,
the runner picks this up automatically and keeps dispatching — you do not
need to also set `RUNNER_SCHEDULER_ENABLED`. Set it explicitly only if you
want a configuration that the derived default does not cover (e.g. both
authorities on at once, for a supervised migration window).

> **Not part of the `.env.production.example` reconciliation manifest**:
> unlike most variables in this reference, `almirant upgrade` never writes
> either of these into your `.env.production` file. This is deliberate —
> materializing a literal `RUNNER_SCHEDULER_ENABLED` value on every upgrade
> would permanently pin it and defeat the derived default described above.
> Only set these two variables by hand if you need to deviate from the
> default for your installation.

## Optional providers / integrations

These are only needed if you enable the corresponding feature:

- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
  (**optional in self-hosted**: the `/onboarding` wizard creates the GitHub
  App via manifest and stores the credentials in the database. Set these env
  vars only if you want to bypass the UI flow or share one app across
  multiple instances. See
  [Connecting GitHub](./integrations/github.md).)
- `SMTP_*`, `RESEND_API_KEY`, `EMAIL_FROM`
- `S3_*`
- `SENTRY_*`, `POSTHOG_*`

## Initial admin setup

The compose stack does not create any human user automatically.
On first boot, open the app and create the initial administrator account from `/signup`.

For external MCP agents on your tailnet, do NOT rely on the optional
`ALMIRANT_API_KEY` unless you are specifically wiring internal runner services.
After the first admin signs in, go to `/settings/api-keys`, rotate a workspace
service-account key, and use that key for external MCP clients.
