FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN mkdir -p -m 755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git jq bc bash openssh-client gh \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libdbus-1-3 libxkbcommon0 \
  libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
  libxshmfence1 fonts-liberation fonts-noto-color-emoji \
  xvfb \
  && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install -g bun@1.3.13 @anthropic-ai/claude-code@2.1.119 undici@8.0.2 \
    @modelcontextprotocol/server-sequential-thinking@2025.12.18 \
    @modelcontextprotocol/server-memory@2026.1.26 \
    @modelcontextprotocol/server-filesystem@2026.1.14 \
    @playwright/mcp@0.0.70 \
    mcp-remote@0.1.38

RUN npx playwright install chromium

WORKDIR /app

COPY backend/packages/canonical-events /backend/packages/canonical-events
COPY services/runner/docker/shim-server ./shim-server
COPY services/runner-claude/shim ./claude-shim
COPY services/runner/docker/entrypoint-shim.sh /entrypoint-shim.sh

RUN chmod +x /entrypoint-shim.sh \
  && cd /app/shim-server && bun install && bun run build \
  && cd /app/claude-shim && bun install && bun run build

RUN useradd -m -u 1001 -s /bin/bash opencode \
  && chown -R opencode:opencode /app /entrypoint-shim.sh

USER opencode
WORKDIR /workspace

ENV SHIM_ENTRY=/app/claude-shim/dist/index.js
ENV OPENCODE_SERVER_HOST=0.0.0.0
ENV OPENCODE_SERVER_PORT=4096

ENTRYPOINT ["/entrypoint-shim.sh"]
