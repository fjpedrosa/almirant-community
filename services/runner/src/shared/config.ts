import { z } from "zod";

// Optional URL fields that should treat empty strings (common in shared .env
// files where a key is declared but not configured) as absent.
const optionalUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z.string().url().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3002),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  ALMIRANT_API_URL: z.string().url(),
  ALMIRANT_API_KEY: z.string().min(1),
  WORKER_ID: z.string().optional(),
  RUNNER_HOSTNAME: z.string().optional(),
  /** Local claim cap. RAM budgeting adds a dynamic memory bound on top of this cap. */
  MAX_CONCURRENT: z.coerce.number().int().min(1).max(64).default(4),
  DOCKER_SOCKET: z.string().optional(),
  /** DOCKER_HOST is set by docker-compose to point at the socket proxy. */
  DOCKER_HOST: z.string().optional(),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(5000).default(10000),
  CLAIM_INTERVAL_MS: z.coerce.number().int().min(2000).default(10000),
  OPENCODE_IMAGE: z.string().default("almirant-opencode-shim:1.14.31"),
  CLAUDE_SHIM_IMAGE: z.string().default("almirant-claude-shim:2.1.126"),
  CODEX_SHIM_IMAGE: z.string().default("almirant-codex-shim:0.128.0"),
  OPENCODE_COMMAND: z.string().optional(),
  REPOS_HOST_PATH: z.string().optional(),
  REDIS_URL: optionalUrl,
  QUEUE_NAME: z.string().default("discord-output").optional(),
  JOB_INTERACTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300000),
  JOB_OVERALL_TIMEOUT_MS: z.coerce.number().int().min(60000).default(3 * 60 * 60 * 1000),
  EFFORT_POINT_DURATION_MS: z.coerce.number().int().min(60000).default(20 * 60 * 1000),
  JOB_PRE_SESSION_TIMEOUT_MS: z.coerce.number().int().min(30000).default(5 * 60 * 1000),
  BRIDGE_MODE: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_CHANNEL_ID: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default("eu-central"),
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  CHECKPOINT_INTERVAL_MS: z.coerce.number().int().min(30000).default(300000),
  CHECKPOINT_ENABLED: z.string().optional(),
  NIGHTLY_CHECK_INTERVAL_MS: z.coerce.number().int().min(60000).default(60000),
  RUNNER_RAM_BUDGET_ENABLED: z.enum(["true", "false"]).default("false"),
  /** RAM kept free for the host/VM outside runner job containers. */
  RUNNER_RAM_RESERVED_MB: z.coerce.number().int().min(0).default(2048),
  /** Enable publishing web output events to the Redis Stream for planning jobs. */
  WEB_OUTPUT_ENABLED: z.enum(["true", "false"]).default("false"),
  /** Default staging URL used as fallback for walkthrough recording target resolution. */
  STAGING_URL: optionalUrl,
  /** Enable Playwright browser support inside runner containers (starts Xvfb, registers MCP). */
  ENABLE_BROWSER: z.enum(["true", "false"]).default("false"),
  /** Maximum number of automatic retries for recoverable errors (0 to disable). */
  MAX_AUTO_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /** Base backoff delay in ms between retries (multiplied by attempt number). */
  RETRY_BACKOFF_MS: z.coerce.number().int().min(1000).default(30000),
  /** Path to baked platform config (skills, agents, settings) for injection into target repos. */
  PLATFORM_CONFIG_PATH: z.string().default("/app/platform-config"),
  /** GHCR credentials for pulling private container images (shim containers). */
  GHCR_USERNAME: z.string().optional(),
  GHCR_TOKEN: z.string().optional(),
  /** Sentry DSN for error tracking. Disabled if not set or empty. */
  SENTRY_DSN: optionalUrl,
  /** PostHog API key for telemetry events. Disabled if not set. */
  POSTHOG_API_KEY: z.string().optional(),
  /** PostHog host (defaults to EU). */
  POSTHOG_HOST: optionalUrl,
  /** Auto-Fix Bot API key. When set, agent containers running the feedback-bug-fix
   *  skill use this key for MCP auth so comments are attributed to auto-fix-bot. */
  MC_API_KEY: z.string().optional(),
});

export type RunnerEnv = z.infer<typeof envSchema> & {
  WORKER_ID: string;
  RUNNER_HOSTNAME: string;
  /** Resolved Docker connection path (TCP URL or socket path, always present). */
  DOCKER_SOCKET: string;
};

export const loadRunnerEnv = (source: Record<string, string | undefined> = process.env): RunnerEnv => {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid runner environment: ${JSON.stringify(details)}`);
  }

  const hostname = parsed.data.RUNNER_HOSTNAME ?? source.HOSTNAME ?? "almirant-runner";
  const workerId =
    parsed.data.WORKER_ID ??
    `${hostname}-${Math.random().toString(36).slice(2, 8)}`;

  // Resolve Docker connection: prefer DOCKER_HOST (TCP proxy set by docker-compose),
  // then DOCKER_SOCKET (explicit path), then the standard default socket.
  const dockerSocket =
    parsed.data.DOCKER_HOST ??
    parsed.data.DOCKER_SOCKET ??
    "/var/run/docker.sock";

  return {
    ...parsed.data,
    WORKER_ID: workerId,
    RUNNER_HOSTNAME: hostname,
    DOCKER_SOCKET: dockerSocket,
  };
};
