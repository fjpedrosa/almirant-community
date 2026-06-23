# syntax=docker/dockerfile:1.7

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

COPY backend/packages ./backend/packages
COPY services/runner/tsconfig.json ./services/runner/tsconfig.json
COPY services/runner/src ./services/runner/src

# Type-checking belongs in CI/pre-push by default. Keep it opt-in for
# diagnostic Docker builds without slowing every self-hosted upgrade.
ARG RUN_TYPECHECK=false
RUN if [ "$RUN_TYPECHECK" = "true" ]; then \
  bun run --filter @almirant/runner type-check; \
  else echo "Skipping @almirant/runner type-check during Docker build"; \
  fi

FROM oven/bun:1.3.8-alpine

WORKDIR /app/services/runner

RUN apk add --no-cache docker-cli git openssh-client

COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/services/runner ./
COPY --from=builder /app/backend/packages /app/backend/packages

# Bun creates package-local workspace symlinks during the manifest-only
# install layer. Those symlinks can point at `.bun` package-store entries that
# only contain package.json, because source is copied later for Docker cache
# efficiency. Runtime TypeScript imports from backend packages must resolve to
# the copied source tree instead.
RUN rm -rf /app/backend/packages/*/node_modules/@almirant \
  && mkdir -p /app/node_modules/@almirant \
  && for package in bridge-core canonical-events config database i18n remote-agent shared stream-consumer worker; do \
    ln -sfn /app/backend/packages/$package /app/node_modules/@almirant/$package; \
  done

# Copy platform config for injection into target repos.
# The public self-hosted repo ships `.agents`, so we mirror it into both
# `.agents` and `.claude` inside the runner image to support Codex/OpenCode
# and Claude-based runtimes from the same source of truth.
COPY .agents/ /app/platform-config/.agents/
COPY .agents/skills/ /app/platform-config/.claude/skills/
COPY .agents/agents/ /app/platform-config/.claude/agents/
COPY services/runner/platform-config/ /app/platform-config/

RUN mkdir -p /app/platform-config/.claude/hooks

ENV NODE_ENV=production
ENV PORT=3002

EXPOSE 3002

CMD ["bun", "run", "src/index.ts"]
