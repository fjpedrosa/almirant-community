import { JobRunner } from "./job-runner";
import { InfraRunner } from "./infra-runner";
import { ServiceOpsRunner } from "./service-ops-runner";
import { createApp } from "./app";

// ─── Environment ─────────────────────────────────────────────────────────────

const requireEnv = (name: string): string => {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
};

const env = {
  PORT: Number(process.env.PORT ?? "9999"),
  TOKEN: requireEnv("UPDATER_INTERNAL_TOKEN"),
  REPO_PATH: process.env.ALMIRANT_REPO_PATH ?? "/repo",
  COMPOSE_FILE: process.env.COMPOSE_FILE ?? "docker-compose.prod.yml",
  ENV_FILE: process.env.ENV_FILE ?? ".env.production",
  BRANCH: process.env.UPDATER_BRANCH ?? "main",
  EXCLUDE_SERVICES: (process.env.UPDATER_EXCLUDE_SERVICES ?? "updater")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

const log = (message: string, meta?: Record<string, unknown>): void => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "updater",
      message,
      ...meta,
    }),
  );
};

// ─── Runner + app ────────────────────────────────────────────────────────────

const runner = new JobRunner({
  repoPath: env.REPO_PATH,
  composeFile: env.COMPOSE_FILE,
  envFile: env.ENV_FILE,
  branch: env.BRANCH,
  excludeServices: env.EXCLUDE_SERVICES,
});

const infraRunner = new InfraRunner({
  repoPath: env.REPO_PATH,
  composeFile: env.COMPOSE_FILE,
  envFile: env.ENV_FILE,
});

const serviceOpsRunner = new ServiceOpsRunner({
  repoPath: env.REPO_PATH,
  composeFile: env.COMPOSE_FILE,
  envFile: env.ENV_FILE,
});

const app = createApp({
  runner,
  infraRunner,
  serviceOpsRunner,
  token: env.TOKEN,
});
const server = app.listen(env.PORT);

log(`updater listening on port ${env.PORT}`, {
  repoPath: env.REPO_PATH,
  composeFile: env.COMPOSE_FILE,
  envFile: env.ENV_FILE,
  branch: env.BRANCH,
  excludeServices: env.EXCLUDE_SERVICES,
});

const shutdown = (signal: string): void => {
  log(`Received ${signal}, shutting down updater`);
  server.stop();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
