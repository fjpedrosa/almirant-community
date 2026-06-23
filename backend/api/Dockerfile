# syntax=docker/dockerfile:1.7

# Build stage
# Docker context: repo root (.)
FROM oven/bun:1.3.8-alpine AS builder

WORKDIR /app

# Copy only dependency manifests before install. Do NOT copy source here:
# source changes should not invalidate the expensive Bun dependency layer.
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

# Cache Bun's package tarballs across invalidated Docker layers.
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile

# Copy source after dependencies for better cache reuse.
COPY backend/packages ./backend/packages
COPY backend/api ./backend/api

# Build the API
WORKDIR /app/backend/api
RUN bun run build

# Production stage
FROM oven/bun:1.3.8-alpine

WORKDIR /app

# Copy installed deps and built code
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend ./backend
COPY --from=builder /app/services ./services

# Build metadata — injected from `docker build --build-arg ALMIRANT_BUILD_SHA=$(git rev-parse HEAD)`
# so the running backend can report its own version to the update-check endpoint.
ARG ALMIRANT_BUILD_SHA=unknown
ENV ALMIRANT_BUILD_SHA=${ALMIRANT_BUILD_SHA}

# Set environment to production
ENV NODE_ENV=production

# Expose API port
EXPOSE 3001

WORKDIR /app/backend/api

CMD ["bun", "run", "dist/index.js"]
