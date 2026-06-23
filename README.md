# Almirant Self-Hosted

> Open, self-hostable project management & CRM platform powered by LLM agents.

[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/Status-Pre--alpha-orange.svg)](#status)
[![Changelog](https://img.shields.io/badge/changelog-keep--a--changelog-orange.svg)](./CHANGELOG.md)

---

## Status

**Pre-alpha, but runnable locally from source with Docker Compose.**
This repository ships the source code and a local stack that boots the core product (`frontend`, `backend`, `runner`, `web-bridge`, `postgres`, `redis`) under the `almirant` compose project.

## What is Almirant?

Almirant is a project management and CRM platform that combines traditional work-item tracking (boards, sprints, milestones, roadmaps) with an LLM-native planning pipeline and agent orchestration.

### Core capabilities in this repo

- Projects, boards, work items, seeds, docs and CRM primitives
- Backend API + Next.js frontend
- Local runner service for agent orchestration
- Web bridge for live agent output streaming
- Local PostgreSQL + Redis stack
- First-admin onboarding for self-hosted installs

## Quickstart

> Requires Docker 24+ and Docker Compose v2.

### Production install (from source)

Clone the repo and run the installer — it generates random secrets, builds the images and starts the full stack:

```bash
git clone https://github.com/almirant-ai/almirant.git
cd almirant
./scripts/install.sh
```

By default Almirant serves at <http://localhost:8080>. The installer prompts for the public URL (accept the default for a LAN / localhost try-out). First build is ~10-20 min on a modern laptop; subsequent `./scripts/install.sh` runs reuse the Docker layer cache.

Public VPS install with the built-in Caddy reverse proxy:

```bash
ALMIRANT_DOMAIN=almirant.example.com ./scripts/install.sh
```

This exposes frontend and backend on one origin: app at `https://almirant.example.com`, API at `/api`, MCP at `/mcp`, and WebSocket at `/ws`.

Capacity-aware VPS install, keeping 4 GB free for the OS and frontend builds during upgrades:

```bash
RUNNER_RAM_BUDGET_ENABLED=true \
RUNNER_RAM_RESERVED_MB=4096 \
ALMIRANT_DOMAIN=almirant.example.com \
./scripts/install.sh
```

LAN-only install, reachable from other devices on your private network but not published to the Internet:

```bash
ALMIRANT_BIND_ADDRESS=0.0.0.0 \
ALMIRANT_PROXY_MODE=none \
ALMIRANT_PUBLIC_URL=http://192.168.1.50:8080 \
./scripts/install.sh
```

Non-interactive install (for VM images / CI):

```bash
ALMIRANT_NONINTERACTIVE=1 ALMIRANT_PUBLIC_URL=http://localhost:8080 ./scripts/install.sh
```

Day-2 ops (from the repo dir):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f
docker compose -f docker-compose.prod.yml --env-file .env.production ps
# If agents are busy, drain/pause them first so the frontend build keeps RAM headroom.
git pull \
  && docker compose -f docker-compose.prod.yml --env-file .env.production build \
  && docker compose -f docker-compose.prod.yml --env-file .env.production up -d   # upgrade
docker compose -f docker-compose.prod.yml --env-file .env.production down         # stop (data persists)
```

### Publishing Docker images

Releases publish Docker images to Docker Hub through `.github/workflows/publish-docker.yml`.
Configure these repository secrets before publishing:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN` — use a Docker Hub access token, not your account password

Optional repository variables:

- `DOCKER_PLATFORMS` — defaults to `linux/amd64`
- `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`,
  `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` — build-time frontend values

### Developer dev stack

Boot the live-reload dev stack with the repo's default compose file (no production secrets, Drizzle seed data, hot reload):

```bash
git clone https://github.com/almirant-ai/almirant.git
cd almirant
cp .env.example .env
docker compose up -d --build
```

Then open <http://localhost:3000>. If the instance has no users yet, Almirant redirects you to `/signup` so you can create the first administrator account.

Useful URLs (dev stack):

- App: <http://localhost:3000>
- API health: <http://localhost:3001/health>
- Runner health: <http://localhost:3002/health>
- Web bridge health: <http://localhost:3004/health>

## Documentation

- [Self-hosting guide](./docs/self-hosting/getting-started.md)
- [Production over tailnet](./docs/self-hosting/production-tailnet.md)
- [Environment variables](./docs/self-hosting/environment.md)
- [Local development stack](./docs/local-dev-stack.md)
- [Backups and restore](./docs/self-hosting/backups.md)
- [Upgrading](./docs/upgrading/README.md)

## Contributing

Before your first pull request, read:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- [CLA.md](./CLA.md)

## Security

Found a vulnerability? Please do not open a public issue. See [SECURITY.md](./SECURITY.md).

## License

Almirant Self-Hosted is distributed under the [Business Source License 1.1](./LICENSE).

- Free for internal, non-production, and non-competitive use
- Prohibited from being offered as a managed/hosted service to third parties
- Each release converts to Apache License 2.0 four years after its publication date

For commercial licenses or hosted service partnerships, contact **<hello@almirant.ai>**.

---

Built by [F. Javier Pedrosa Ruiz](https://almirant.ai).
