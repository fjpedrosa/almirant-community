# Getting Started with Almirant Self-Hosted

Two paths, pick one:

- **[Production install](#production-install-from-source)** — clones the repo, builds production images locally, generates secrets, starts the `docker-compose.prod.yml` stack. For self-hosters.
- **[Developer dev stack](#developer-dev-stack)** — the default `docker-compose.yml` with hot-reload and seed data. For contributors.

## Requirements

- Docker 24+
- Docker Compose v2
- 4 GB RAM minimum; 8+ GB recommended for agent workloads
- ~10 GB free disk for images, dependencies and Postgres data
- First build takes ~10-20 min; subsequent builds are fast thanks to Docker layer cache
- Upgrades rebuild the frontend image; keep RAM headroom for Next.js builds

## Production install (from source)

### 1. Clone the repo

```bash
git clone https://github.com/almirant-ai/almirant.git
cd almirant
```

### 2. Run the installer

```bash
./scripts/install.sh
```

The installer:

1. Verifies Docker + Compose v2.
2. Generates `.env.production` with random secrets (kept as-is on re-runs).
3. Prompts for the public URL (default: `http://localhost:8080`).
4. Builds images (`docker compose build`).
5. Starts the stack (`docker compose up -d`).
6. Waits for the frontend to become healthy.
7. Prints the app URL + day-2 ops commands.

Env overrides (all optional):

| Variable | Default | Description |
|----------|---------|-------------|
| `ALMIRANT_NONINTERACTIVE` | `0` | Set to `1` to skip prompts |
| `ALMIRANT_PUBLIC_URL` | *prompt* | Public URL if non-interactive |
| `ALMIRANT_DOMAIN` | empty | Public domain for the built-in Caddy proxy; derives `https://<domain>` |
| `ALMIRANT_PROXY_MODE` | auto | `none`, `caddy`, `external`, or `local` |
| `ALMIRANT_BIND_ADDRESS` | `127.0.0.1` | Direct host bind address; use `0.0.0.0` or a LAN IP for LAN-only installs |
| `RUNNER_RAM_BUDGET_ENABLED` | `true` | Claim agent jobs based on available RAM and per-job forecasts |
| `RUNNER_RAM_RESERVED_MB` | `2048` | RAM kept free for the host and upgrade/build spikes |
| `MAX_CONCURRENT` | `4` | Runner slot cap; RAM budgeting adds a dynamic memory bound on top |
| `ALMIRANT_WITH_PROXY` | `0` | Legacy: enable the localhost-only Caddy reverse proxy profile |
| `ALMIRANT_WITH_DISCORD` | `0` | Enable the Discord bridge profile |

Example — public VPS install with built-in Caddy TLS:

```bash
ALMIRANT_DOMAIN=almirant.example.com ./scripts/install.sh
```

Example — LAN-only install reachable from other devices on your private network:

```bash
ALMIRANT_BIND_ADDRESS=0.0.0.0 \
ALMIRANT_PROXY_MODE=none \
ALMIRANT_PUBLIC_URL=http://192.168.1.50:8080 \
./scripts/install.sh
```

This does not publish Almirant to the Internet unless your router/firewall forwards the port.

Example — larger VPS install with extra upgrade/build headroom:

```bash
RUNNER_RAM_BUDGET_ENABLED=true \
RUNNER_RAM_RESERVED_MB=4096 \
ALMIRANT_DOMAIN=almirant.example.com \
./scripts/install.sh
```

This keeps 4 GB outside the runner budget so frontend builds during upgrades,
Postgres, Redis, Docker and the OS have breathing room. On busy instances,
drain or pause agent jobs before running `docker compose build`.

Example — unattended install pinned to a specific git commit:

```bash
git clone https://github.com/almirant-ai/almirant.git
cd almirant
git checkout v1.2.3
ALMIRANT_NONINTERACTIVE=1 ALMIRANT_PUBLIC_URL=https://almirant.example.com ./scripts/install.sh
```

### 3. Day-2 ops

All commands run from the cloned repo dir:

```bash
# Tail logs
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f

# Status
docker compose -f docker-compose.prod.yml --env-file .env.production ps

# Upgrade (pull latest code, rebuild, restart)
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Stop (data persists)
docker compose -f docker-compose.prod.yml --env-file .env.production down

# Stop AND delete volumes (destructive — removes all app data)
docker compose -f docker-compose.prod.yml --env-file .env.production down -v
```

Secrets live in `.env.production` (chmod 600). Back it up; regenerating them
invalidates all sessions and encrypted values.

Skip to [Create the first admin](#5-create-the-first-admin).

---

## Developer dev stack

This path is the live-reload dev stack (default `docker-compose.yml`, with seed data and no production secrets).

### 1. Clone the repository

```bash
git clone https://github.com/almirant-ai/almirant.git
cd almirant
```

### 2. Copy the environment template

```bash
cp .env.example .env
```

For local Docker, the defaults already work. You only need to edit `.env` if you want different ports, secrets, or external integrations.

### 3. Build and start the stack

```bash
docker compose up -d --build
```

This starts:

- `postgres` on `5432`
- `redis` on `6379`
- `backend` on `3001`
- `frontend` on `3000`
- `runner` on `3002`
- `web-bridge` on `3004`

The first boot also runs:

- database migrations
- preview/demo seed data
- runner service-account/API-key provisioning for local use

## 4. Wait until services are healthy

```bash
docker compose ps
```

Recommended quick checks:

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3004/health
```

## 5. Create the first admin

Open <http://localhost:3000>. If there are no users yet, Almirant redirects you to `/signup` so you can create the initial administrator account.

## 6. Finish setup with the onboarding wizard

Once the first admin signs in, Almirant redirects to `/onboarding`. The wizard
walks through the remaining self-hosted setup in three steps:

1. **Admin account** - confirms the first administrator was created and that
   open registration is now closed.
2. **Public URL (Tailscale)** - publishes your instance via Tailscale Funnel
   if Tailscale is available on the host (see
   [Production over tailnet](./production-tailnet.md) for the host setup),
   or lets you paste your own HTTPS URL behind any reverse proxy.
3. **GitHub App** - creates a GitHub App through a pre-filled manifest, or
   accepts existing credentials. Saved credentials live in the database, so
   you do not need to set the `GITHUB_*` environment variables manually.

The wizard is idempotent: you can leave it at any time and resume later from
`/onboarding`. Each setting it manages is also editable afterwards from
`/settings/instance` and `/settings/github`.

If you skip the wizard, every step has a "Skip for now" button. The
`/onboarding` link stays available in the sidebar until all steps are done.

## Optional: build Claude/Codex shim images locally

If you want agent jobs to use local shim images instead of remote defaults:

```bash
docker compose --profile shims build
```

## Stop the stack

```bash
docker compose down
```

To remove all data too:

```bash
docker compose down -v
```

## Troubleshooting

### Frontend does not open on port 3000

Check:

```bash
docker compose logs -f frontend
```

### Backend is not healthy

Check:

```bash
docker compose logs -f backend
docker compose logs -f db-init
```

### Runner is up but agent jobs fail pulling images

Build the shim images locally:

```bash
docker compose --profile shims build
```

### Start from scratch

```bash
docker compose down -v
rm -rf services/runner/repos
docker compose up -d --build
```
