# Local Development Stack

Almirant now ships a single local Docker stack under the compose project name `almirant`.

## Quickstart

```bash
cp .env.example .env
docker compose up -d --build
```

## What boots

| Service | Port |
|---|---:|
| frontend | 3000 |
| backend | 3001 |
| runner | 3002 |
| web-bridge | 3004 |
| postgres | 5432 |
| redis | 6379 |

Optional profile:

```bash
docker compose --profile discord-bridge up -d discord-bridge
docker compose --profile shims build
```

## Useful commands

```bash
docker compose up -d
docker compose build
docker compose logs -f
docker compose down
```

## Health checks

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3004/health
```

## Initial admin setup

If the instance has no users yet, opening the app redirects you to `/signup` so you can create the first administrator account.
