# Production over tailnet

This guide runs Almirant as a compiled production stack on a LAN machine and
publishes a single HTTPS endpoint to your tailnet.

## Target topology

- `frontend` compiled with `next build`
- `backend` compiled with `bun build`
- local `postgres` + `redis`
- one reverse proxy bound to `127.0.0.1:${PROXY_PORT}`
- `tailscale serve` publishing that proxy to your tailnet

This keeps Postgres, Redis, and the raw app ports off your LAN while still
making the UI, `/api`, `/ws`, and `/mcp` reachable from your tailnet.

## Requirements

- Linux machine on your LAN
- Docker 24+
- Docker Compose v2
- Tailscale installed on the host and already joined to your tailnet

## 1. Prepare the production environment file

```bash
cp .env.production.example .env.production
```

Fill in at least:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `NEXT_PUBLIC_SITE_URL`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `CORS_ORIGIN`
- `BETTER_AUTH_SECRET`
- `INTERNAL_EMAIL_API_SECRET`
- `ENCRYPTION_KEY`
- `ALMIRANT_PROJECT_ID`

Recommended generators:

```bash
python - <<'PY'
import uuid
print(uuid.uuid4())
PY

openssl rand -hex 32
```

Use the UUID for `ALMIRANT_PROJECT_ID` and the 64-hex outputs for the secrets.

## 2. Build and start the compiled stack

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Or via Bun:

```bash
bun run prod:stack:up
```

Services started:

- `postgres`
- `redis`
- `db-init` (one-shot)
- `backend`
- `frontend`
- `proxy`

The proxy listens only on `127.0.0.1:${PROXY_PORT}` by default.

## 3. Check health locally on the host

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl http://127.0.0.1:${PROXY_PORT:-8080}/mcp/health
```

## 4. Publish the stack to your tailnet

Recommended flow (managed from the UI):

1. Install Tailscale on the host and join your tailnet
   ([install docs](https://tailscale.com/kb/installation),
   [Funnel docs](https://tailscale.com/kb/1223/funnel)).
2. Mount the Tailscale socket and CLI into the `backend` container so the
   backend can call `tailscale serve` for you. Use the `tailscale-host`
   profile shipped with the production compose file:

   ```bash
   docker compose --env-file .env.production \
     -f docker-compose.prod.yml \
     -f docker-compose.tailscale.override.yml \
     up -d
   ```

   This adds `/var/run/tailscale` and `/usr/bin/tailscale` (read-only) to the
   backend so it can publish the proxy without you running anything by hand.
3. Sign in as admin and open the onboarding wizard at `/onboarding` (or, after
   onboarding, `/settings/instance`). Hit **Publish via Tailscale**: the
   backend detects the tailnet hostname, calls `tailscale serve`, and stores
   the resulting public URL in the database.

After this step the wizard shows the public HTTPS URL (for example
`https://<device>.<tailnet>.ts.net`) and the rest of the steps (GitHub App,
etc.) can use it as a callback target.

### Plan B - publish manually from the host

If you do not want to mount the socket into the container, publish the proxy
yourself from the host and then paste the resulting URL into the wizard
(*Custom URL* tab) or `/settings/instance`:

```bash
tailscale serve --bg http://127.0.0.1:${PROXY_PORT:-8080}
tailscale serve status
```

Tailscale Serve documentation:

- <https://tailscale.com/docs/features/tailscale-serve>
- <https://tailscale.com/docs/reference/tailscale-cli/serve>

## 5. Create the first admin

Open your tailnet URL:

```text
https://<device>.<tailnet>.ts.net
```

If there are no users yet, Almirant redirects to `/signup`.

## 6. Provision the MCP key for external VPS agents

This is the IMPORTANT part.

The public MCP endpoint is:

```text
https://<device>.<tailnet>.ts.net/mcp
```

But the best key for external VPS agents is **not** the optional infrastructure
key from `.env.production`. Instead:

1. Sign in as the admin
2. Go to `/settings/api-keys`
3. Rotate or create a workspace service-account key
4. Save the plaintext key immediately
5. Configure your VPS agent with:

```text
Authorization: Bearer <workspace-service-account-key>
```

Why? Because the public MCP tools are organization-scoped. A workspace key
belongs to the real team/workspace organization that owns your projects.

## API vs MCP

- **`/mcp`**: the recommended interface for remote AI agents on your tailnet
- **`/api`**: usable, but most protected REST routes require a valid user
  session plus an active organization, so it is less convenient for
  machine-to-machine automation

## Reverse-proxy paths

The production proxy sends these paths to the backend:

- `/api`
- `/ws`
- `/mcp`
- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`

Everything else goes to the frontend.

Those two `/.well-known/*` routes are required for MCP client compatibility.

## Logs

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
```

Or:

```bash
bun run prod:stack:logs
```

## Stop the stack

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

## Security notes

- Publish only the reverse proxy through Tailscale Serve
- Do not expose Postgres or Redis to the LAN
- Keep `/mcp/internal` disabled unless you have a very specific internal-only need
- Rotate workspace MCP keys from `/settings/api-keys` if a VPS is replaced or compromised

## Private Postgres access from your tailnet

Almirant can also create a separate Tailscale sidecar for database access from
`/settings/instance`.

This is different from `tailscale serve`:

- `tailscale serve` publishes the web app, `/api`, `/ws`, and `/mcp`.
- Private database access creates an `almirant-db` tailnet node that forwards
  tailnet port `5432` to the internal Docker service `postgres:5432`.

The setup wizard supports either a one-off auth key or a Tailscale OAuth client.
For OAuth clients, use the `auth_keys` scope and grant the tag you configure in
the wizard, by default `tag:almirant-db`.

Security notes:

- Postgres is not published on the VPS public interface.
- Runtime Tailscale secrets are written to `data/tailscale-db.env`, which must
  not be committed.
- Use Tailscale ACLs to allow only trusted users/devices to reach
  `tag:almirant-db:5432`.
