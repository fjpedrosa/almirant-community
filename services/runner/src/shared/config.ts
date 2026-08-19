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
  /** Explicit internal Docker network used only for runner/agent/Squid traffic. */
  AGENT_EGRESS_NETWORK: z.string().trim().min(1).optional(),
  /** Separate internal network used only for runner-to-agent serve traffic. */
  AGENT_CONTROL_NETWORK: z.string().trim().min(1).optional(),
  /** Deprecated explicit alias retained for safe rollout of existing runner env files. */
  AGENT_NETWORK_NAME: z.string().trim().min(1).optional(),
  /** HTTP Squid endpoint on AGENT_EGRESS_NETWORK. No implicit default by design. */
  AGENT_EGRESS_PROXY_URL: optionalUrl,
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(5000).default(10000),
  CLAIM_INTERVAL_MS: z.coerce.number().int().min(2000).default(10000),
  OPENCODE_IMAGE: z.string().default("almirant-opencode-shim:1.18.4"),
  CLAUDE_SHIM_IMAGE: z.string().default("almirant-claude-shim:2.1.218"),
  CODEX_SHIM_IMAGE: z.string().default("almirant-codex-shim:0.145.0"),
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
  /**
   * Master switch for the runner's own scheduling loop (nightly validation +
   * scheduled_agent_configs dispatch). Mirrors cloud's runner-side flag of
   * the same name (cloud's default is "true" there, since cloud's backend
   * dispatcher is rolled out from PostHog rather than defaulting on).
   *
   * Community's default is computed, not static -- see the derivation in
   * loadRunnerEnv() below, which reads the raw SCHEDULED_AGENT_DISPATCHER_ENABLED
   * value from the SAME shared env file (docker-compose wires both `backend`
   * and `runner` to `.env` / `.env.production`):
   *   - SCHEDULED_AGENT_DISPATCHER_ENABLED unset or "true" (the backend's own
   *     default as of 2026-08-02, see @almirant/config's env.ts) => this
   *     defaults to "false": the backend owns dispatch, the runner must not
   *     also dispatch or the deterministic modes (backlogDrain, dodReview,
   *     releaseIntegration) double-create jobs.
   *   - SCHEDULED_AGENT_DISPATCHER_ENABLED explicitly "false" (an existing
   *     self-hoster's opt-out back to the pre-2026-08-02 behavior) => this
   *     defaults to "true" automatically, with zero extra configuration, so
   *     the runner keeps dispatching exactly like it always did.
   * An explicit RUNNER_SCHEDULER_ENABLED value always wins over the derived
   * default in both directions.
   */
  RUNNER_SCHEDULER_ENABLED: z.enum(["true", "false"]).optional(),
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
  /** Always resolved -- see the derivation comment on the schema field above. */
  RUNNER_SCHEDULER_ENABLED: "true" | "false";
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

  // RUNNER_SCHEDULER_ENABLED default derivation -- see the schema field's
  // comment for the full rationale. Read the RAW source value (not the
  // backend's own parsed/validated default) because the runner has no
  // dependency on @almirant/config; an invalid or garbage
  // SCHEDULED_AGENT_DISPATCHER_ENABLED value is treated the same as "unset"
  // here (defaults the runner scheduler OFF, the safe conservative choice),
  // and the backend's own schema will separately reject that value at its
  // own boot time.
  const runnerSchedulerEnabled =
    parsed.data.RUNNER_SCHEDULER_ENABLED ??
    (source.SCHEDULED_AGENT_DISPATCHER_ENABLED === "false" ? "true" : "false");

  return {
    ...parsed.data,
    WORKER_ID: workerId,
    RUNNER_HOSTNAME: hostname,
    DOCKER_SOCKET: dockerSocket,
    RUNNER_SCHEDULER_ENABLED: runnerSchedulerEnabled,
  };
};
