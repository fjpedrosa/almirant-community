# syntax=docker/dockerfile:1.7

# Updater sidecar — drives `git pull` + `docker compose up --build` against
# a host-mounted clone of the repo. Mounts /var/run/docker.sock to control
# the host docker daemon.
#
# Docker context: repo root (.)

FROM oven/bun:1.3.8-alpine AS builder

WORKDIR /app

# Dependency manifests only. Source is copied after `bun install` so ordinary
# code/config changes do not invalidate the expensive dependency layer.
COPY package.json ./package.json
COPY bun.lock ./bun.lock
COPY backend/api/package.json ./backend/api/package.json
COPY backend/packages/bridge-core/package.json ./backend/packages/bridge-core/package.json
COPY backend/packages/canonical-events/package.json ./backend/packages/canonical-events/package.json
COPY backend/packages/config/package.json ./backend/packages/config/package.json
COPY backend/packages/database/package.json ./backend/packages/database/package.json
COPY backend/packages/i18n/package.json ./backend/packages/i18n/package.json
COPY backend/packages/remote-agent/package.json ./backend/packages/remote-agent/package.json
COPY backend/packages/shared/package.json ./backend/packages/shared/package.json
COPY backend/packages/stream-consumer/package.json ./backend/packages/stream-consumer/package.json
COPY backend/packages/worker/package.json ./backend/packages/worker/package.json
COPY services/runner/package.json ./services/runner/package.json
COPY services/web-bridge/package.json ./services/web-bridge/package.json
COPY services/discord-bridge/package.json ./services/discord-bridge/package.json
COPY services/updater/package.json ./services/updater/package.json

RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile

COPY services/updater/tsconfig.json ./services/updater/tsconfig.json
COPY services/updater/src ./services/updater/src

# Type-checking belongs in CI/pre-push by default. Keep it opt-in for
# diagnostic Docker builds without slowing every self-hosted upgrade.
ARG RUN_TYPECHECK=false
RUN if [ "$RUN_TYPECHECK" = "true" ]; then \
  bun run --filter @almirant/updater type-check; \
  else echo "Skipping @almirant/updater type-check during Docker build"; \
  fi

# ─── Production stage ────────────────────────────────────────────────────────
FROM oven/bun:1.3.8-alpine

# git: needed for `git fetch`/`git pull` against the bind-mounted repo.
# docker-cli + docker-cli-compose: drive the host docker daemon via the
# bind-mounted /var/run/docker.sock.
RUN apk add --no-cache git docker-cli docker-cli-compose

WORKDIR /app/services/updater

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/services/updater ./

ENV NODE_ENV=production
ENV PORT=9999

EXPOSE 9999

CMD ["bun", "run", "src/index.ts"]
