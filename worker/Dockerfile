FROM oven/bun:1.3.8-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git openssh-client

# Copy only required packages so local file dependencies resolve inside the image.
COPY worker/package.json ./worker/package.json
COPY worker/tsconfig.json ./worker/tsconfig.json
COPY worker/src ./worker/src
COPY backend/packages/config ./backend/packages/config
COPY backend/packages/database ./backend/packages/database
COPY backend/packages/shared ./backend/packages/shared

WORKDIR /app/worker
RUN bun install

FROM oven/bun:1.3.8-alpine

WORKDIR /app/worker

RUN apk add --no-cache git openssh-client

# Install Claude Code CLI (required for AI code execution)
RUN apk add --no-cache nodejs npm && \
    npm install -g @anthropic-ai/claude-code@2.1.119 && \
    apk del npm

COPY --from=builder /app/worker ./
COPY --from=builder /app/backend /app/backend

RUN mkdir -p /app/repos

ENV NODE_ENV=production

ENTRYPOINT ["bun", "run", "src/index.ts"]
CMD ["daemon"]
