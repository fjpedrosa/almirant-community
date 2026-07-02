import { z } from "zod";

// Optional fields with format validators must treat empty strings as absent so
// docker-compose's ${VAR-} default (empty when unset in .env) doesn't crash
// the backend when the operator hasn't filled those secrets yet.
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    schema.optional(),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z
    .string()
    .default("http://localhost:3000,https://frontend.almirant.orb.local"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  AGENT_JOB_LOG_RETENTION_DAYS: z.coerce.number().default(7),
  AGENT_JOB_LOG_SWEEPER_INTERVAL_MS: z.coerce.number().default(60_000),
  AGENT_JOB_LOG_SWEEPER_BATCH_SIZE: z.coerce.number().default(1_000),
  ALMIRANT_INVESTIGATION_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  ALMIRANT_INVESTIGATION_SWEEPER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  EFFORT_ESTIMATION_SWEEPER_INTERVAL_MS: z.coerce.number().int().min(5_000).default(15_000),
  EFFORT_ESTIMATION_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(10),
  // Telegram (optional - only required if enabling the Telegram bot integration)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().optional(),
  // Discord (optional - only required if enabling Discord interactions/slash commands)
  DISCORD_PUBLIC_KEY: z.string().optional(),
  DISCORD_APPLICATION_ID: z.string().optional(),
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_CHANNEL_ID: z.string().optional(),
  DISCORD_BRIDGE_URL: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_OAUTH_REDIRECT_URI: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_OAUTH_REDIRECT_URI: z.string().optional(),
  // Google OAuth (optional - only required if enabling Google sign-in)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default("eu-central"),
  S3_BUCKET: z.string().optional(),
  S3_PRIVATE_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  // Vercel (optional - only required if enabling Vercel OAuth integration)
  VERCEL_WEBHOOK_SECRET: z.string().optional(),
  // Coolify (optional - only required if enabling Coolify deployment webhooks)
  COOLIFY_WEBHOOK_SECRET: z.string().optional(),
  VERCEL_CLIENT_ID: z.string().optional(),
  VERCEL_CLIENT_SECRET: z.string().optional(),
  VERCEL_REDIRECT_URI: z.string().optional(),
  // Codex / OpenAI OAuth (optional - only required if enabling Codex OAuth integration)
  OPENAI_CODEX_CLIENT_ID: z.string().optional(),
  OPENAI_CODEX_CLIENT_SECRET: z.string().optional(),
  OPENAI_CODEX_REDIRECT_URI: z.string().optional(),
  THUM_IO_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-nano"),
  OPENAI_PROMPT_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  // Groq (optional - only required for audio transcription)
  GROQ_API_KEY: z.string().optional(),
  GROQ_WHISPER_MODEL: z.string().default("whisper-large-v3-turbo"),
  HCAPTCHA_SECRET_KEY: z.string().optional(),
  FEEDBACK_INGEST_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  FEEDBACK_INGEST_RATE_LIMIT_MAX: z.coerce.number().default(20),
  FEEDBACK_WIDGET_TOKEN_TTL_SECONDS: z.coerce.number().default(600),
  FEEDBACK_INGEST_DEDUPE_WINDOW_SECONDS: z.coerce.number().default(120),
  // Contact form (optional - rate limiting and notification config)
  CONTACT_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  CONTACT_RATE_LIMIT_MAX: z.coerce.number().default(5),
  CONTACT_RECIPIENTS: z.string().default(""),
  WAITLIST_CONFIRM_TOKEN_TTL_MINUTES: z.coerce.number().default(1440),
  WAITLIST_SIGNUP_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  WAITLIST_SIGNUP_RATE_LIMIT_MAX: z.coerce.number().default(10),
  WAITLIST_CONFIRM_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  WAITLIST_CONFIRM_RATE_LIMIT_MAX: z.coerce.number().default(30),
  WAITLIST_REF_COOKIE_NAME: z.string().default("wl_ref"),
  WAITLIST_SESSION_COOKIE_NAME: z.string().default("wl_session"),
  // SMTP (optional - preferred provider when configured)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Resend (optional - only required if enabling email sending)
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().default("Almirant <no-reply@almirant.ai>"),
  WAITLIST_THANK_YOU_FROM: z.string().default("Almirant Team <team@almirant.ai>"),
  INTERNAL_EMAIL_API_SECRET: z.string().optional(),
  ENCRYPTION_KEY: optional(z.string().length(64).regex(/^[0-9a-f]+$/i)),
  // Anthropic Admin API (optional - only required for usage/cost reports)
  ANTHROPIC_ADMIN_API_KEY: z.string().optional(),
  ANTHROPIC_ORG_ID: z.string().optional(),
  // Anthropic OAuth (optional - for OAuth PKCE flow with Claude subscriptions)
  ANTHROPIC_OAUTH_CLIENT_ID: z.string().optional(),
  ANTHROPIC_OAUTH_REDIRECT_URI: z.string().optional(),
  // Sentry (optional - only required if enabling error monitoring)
  SENTRY_DSN: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT_FRONTEND: z.string().optional(),
  SENTRY_PROJECT_BACKEND: z.string().optional(),
  // Stripe (optional - only required if enabling payment features)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // PostHog (optional - only required if enabling server-side analytics)
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().default("https://eu.i.posthog.com"),
  // PostHog personal API key (optional - enables local feature-flag evaluation instead of remote calls)
  POSTHOG_PERSONAL_API_KEY: z.string().optional(),
  // Health check sweeper (optional - automated health monitoring)
  HEALTH_CHECK_INTERVAL_MS: z.coerce.number().default(300_000),
  // VPS reachability probe (optional) — set to your own VPS IP/hostname to
  // enable an SSH-port (22) health check; leave unset to skip it.
  VPS_HOST: z.string().optional(),
  // Scaler (optional - Prometheus metrics endpoint for the auto-scaler)
  SCALER_METRICS_URL: z.string().optional(),
  // Spare capacity the scaler keeps available beyond queued + executing jobs
  // (see GET /workers/scaling-metric).
  SCALING_MIN_AVAILABLE_SLOTS: z.coerce.number().int().min(0).default(1),
  // Web Push (optional - only required if enabling browser push notifications)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  // Redis Pub/Sub (optional - only required for multi-instance WS broadcast)
  REDIS_URL: z.string().url().optional(),
  WS_PUBSUB_CHANNEL: z.string().default("ws:broadcast"),
  // Debug skills pipeline (optional - enables LLM-powered incident analysis)
  DEBUG_SKILLS_ENABLED: z.string().optional(),
  // MCP internal mount (optional - enables privileged /mcp/internal endpoint)
  MCP_INTERNAL_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Almirant internal feedback project UUID
  // Required in production for internal feedback flows (feedback creation,
  // launch derivation, backfills, migrations). Validated at runtime via
  // `getAlmirantProjectId()` in dev/test to avoid breaking CLI scripts that
  // don't touch feedback.
  ALMIRANT_PROJECT_ID: optional(z.string().uuid()),
  // Click-to-update sidecar (self-hosted) — both must be set for the
  // backend to advertise updater availability via /instance/update/available.
  // Without them, the version banner falls back to the copy-command UX.
  UPDATER_INTERNAL_URL: z.string().url().optional(),
  UPDATER_INTERNAL_TOKEN: z.string().optional(),
  // GitHub Personal Access Token (optional, scope `public_repo`) used by the
  // version-check service to poll the upstream repo's latest commit. Without it
  // the poll still works but is subject to GitHub's unauthenticated rate limit
  // (60 req/h vs 5000 req/h); under rate limiting `latest` resolves to `null`
  // and the "update available" banner stays hidden.
  GITHUB_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Coolify preview deployments: {{pr_id}} template is only resolved in
// COOLIFY_URL/COOLIFY_FQDN, NOT in user env vars. Resolve at startup.
const coolifyFqdn = process.env.COOLIFY_FQDN;
if (coolifyFqdn) {
  const prMatch = coolifyFqdn.match(/(?:^|-)(\d+)\./);
  if (prMatch) {
    const prId = prMatch[1];
    if (prId) {
      for (const key of Object.keys(process.env)) {
        if (process.env[key]?.includes("{{pr_id}}")) {
          process.env[key] = process.env[key]!.replace(/\{\{pr_id\}\}/g, prId);
        }
      }
    }
  }
}

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error("Invalid environment variables:", parseResult.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parseResult.data;
export const isDev = env.NODE_ENV === "development";
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

// `ALMIRANT_PROJECT_ID` is optional in all environments: self-hosted bootstrap
// auto-provisions an internal feedback project and injects it via
// `setAlmirantProjectId()` at boot. We keep env as the highest-priority
// override for SaaS/EE deploys that bind to a canonical project UUID.
if (!env.ALMIRANT_PROJECT_ID) {
  // eslint-disable-next-line no-console
  console.warn(
    "[config] ALMIRANT_PROJECT_ID not set in env — backend will load it from " +
      "instance_settings.internal_feedback_project_id at boot (self-hosted default).",
  );
}
