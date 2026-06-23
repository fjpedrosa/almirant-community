# syntax=docker/dockerfile:1.7

# Stage 1 — install deps with Bun (fast, uses bun.lock)
FROM oven/bun:1.3.8-alpine AS deps

WORKDIR /app/frontend

COPY package.json bun.lock bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile

# Stage 2 — build Next.js with Node (Bun's Next compiler segfaults on large apps)
FROM node:22-alpine AS builder

WORKDIR /app/frontend

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_WS_URL=
ARG BETTER_AUTH_URL
ARG BETTER_AUTH_TRUSTED_ORIGINS

ENV NODE_ENV=production \
  NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
  NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
  NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL} \
  BETTER_AUTH_URL=${BETTER_AUTH_URL} \
  BETTER_AUTH_TRUSTED_ORIGINS=${BETTER_AUTH_TRUSTED_ORIGINS} \
  BACKEND_URL=http://backend:3001 \
  DATABASE_URL=postgresql://build:build@build:5432/build \
  BETTER_AUTH_SECRET=build-time-placeholder-secret \
  INTERNAL_EMAIL_API_SECRET=build-time-placeholder-email-secret

COPY --from=deps /app/frontend/node_modules ./node_modules
COPY . .

# Allow Node to use more memory for the Next.js compile step.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN --mount=type=cache,target=/app/frontend/.next/cache \
  node ./node_modules/next/dist/bin/next build

# Stage 3 — runtime: Node serves the minimal Next.js standalone output.
FROM node:22-alpine

WORKDIR /app/frontend

ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME=0.0.0.0

# `output: "standalone"` traces and copies only the runtime files required by
# Next.js. Keep static assets outside the server trace and copy them explicitly.
COPY --from=builder /app/frontend/.next/standalone/frontend ./
COPY --from=builder /app/frontend/.next/static ./.next/static
COPY --from=builder /app/frontend/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
