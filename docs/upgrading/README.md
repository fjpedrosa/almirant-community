# Upgrading Guide

> Coming soon.

This directory holds per-major-version upgrade guides.

## General upgrade flow (minor versions)

Between minor versions (e.g. `v1.2.x` to `v1.3.x`):

```bash
docker compose pull
docker compose up -d
```

The container entrypoint runs database migrations automatically before starting the API. If a migration fails, the container exits instead of starting with an inconsistent database.

**Always back up your Postgres volume before any upgrade.**

## Major versions

Major version upgrades may require manual steps. Release notes and per-version guides will live here:

- `v2.md` — upgrade notes for v2.x (when it exists)
- `v3.md` — upgrade notes for v3.x (when it exists)

## Rolling back

If an upgrade fails:

1. Stop the containers: `docker compose down`
2. Restore the Postgres volume from backup
3. Pin the previous version in `docker-compose.yml`
4. Start again: `docker compose up -d`
5. Open an issue describing what failed

---

_Return to the [repo root](../../README.md)_
