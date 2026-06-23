/**
 * Unified telemetry: Sentry (errors) + PostHog (analytics).
 * Both are optional — only active when their respective env vars are set.
 */
import * as Sentry from "@sentry/bun";
import { PostHog } from "posthog-node";

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let posthogClient: PostHog | null = null;
let sentryInitialized = false;

export const initTelemetry = (opts: {
  sentryDsn?: string;
  posthogApiKey?: string;
  posthogHost?: string;
  environment?: string;
  workerId?: string;
  hostname?: string;
}): void => {
  // Sentry
  if (opts.sentryDsn) {
    Sentry.init({
      dsn: opts.sentryDsn,
      environment: opts.environment ?? "production",
      tracesSampleRate: 0.2,
      serverName: opts.hostname,
      initialScope: {
        tags: {
          "runner.worker_id": opts.workerId ?? "unknown",
          service: "runner",
        },
      },
    });
    sentryInitialized = true;
    console.log("[telemetry] Sentry initialized");
  }

  // PostHog
  if (opts.posthogApiKey) {
    posthogClient = new PostHog(opts.posthogApiKey, {
      host: opts.posthogHost ?? "https://eu.i.posthog.com",
      flushAt: 5,
      flushInterval: 10_000,
    });
    console.log("[telemetry] PostHog initialized");
  }
};

// ---------------------------------------------------------------------------
// Sentry helpers
// ---------------------------------------------------------------------------

export const captureError = (
  error: unknown,
  context?: Record<string, unknown>,
): void => {
  if (!sentryInitialized) return;
  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext("job", context);
      if (context.jobId) scope.setTag("job.id", String(context.jobId));
      if (context.skillName) scope.setTag("job.skill", String(context.skillName));
      if (context.workerId) scope.setTag("runner.worker_id", String(context.workerId));
    }
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
};

export const setJobScope = (tags: Record<string, string>): void => {
  if (!sentryInitialized) return;
  Sentry.getCurrentScope().setTags(tags);
};

// ---------------------------------------------------------------------------
// PostHog events
// ---------------------------------------------------------------------------

export type JobTelemetryEvent = {
  jobId: string;
  skillName: string;
  provider: string;
  codingAgent: string;
  model: string;
  durationMs: number;
  status: "completed" | "incomplete" | "failed" | "cancelled" | "timeout" | "paused";
  errorCode?: string;
  errorCategory?: string;
  tokenCount?: number;
  retryCount?: number;
  organizationId: string;
};

export const emitJobTelemetry = (event: JobTelemetryEvent): void => {
  if (!posthogClient) return;
  try {
    posthogClient.capture({
      distinctId: event.organizationId,
      event: "agent_job_completed",
      properties: {
        job_id: event.jobId,
        skill_name: event.skillName,
        provider: event.provider,
        coding_agent: event.codingAgent,
        model: event.model,
        duration_ms: event.durationMs,
        status: event.status,
        error_code: event.errorCode,
        error_category: event.errorCategory,
        token_count: event.tokenCount,
        retry_count: event.retryCount,
      },
    });
  } catch (err) {
    console.warn(`[telemetry] Failed to emit event: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export type ResourceUsageEvent = {
  jobId: string;
  skillName: string;
  organizationId: string;
  workerId: string;
  workspaceMountMode: "bind" | "tmpfs";
  memoryLimitMb: number;
  usage: Record<string, { usedMb: number; totalMb: number }>;
};

export const emitResourceUsage = (event: ResourceUsageEvent): void => {
  if (!posthogClient) return;
  try {
    posthogClient.capture({
      distinctId: event.organizationId,
      event: "agent_resource_usage",
      properties: {
        job_id: event.jobId,
        skill_name: event.skillName,
        worker_id: event.workerId,
        mount_mode: event.workspaceMountMode,
        memory_limit_mb: event.memoryLimitMb,
        ...Object.fromEntries(
          Object.entries(event.usage).flatMap(([key, val]) => [
            [`${key}_used_mb`, val.usedMb],
            [`${key}_total_mb`, val.totalMb],
          ]),
        ),
      },
    });
  } catch {
    // best-effort
  }
};

export type HeartbeatMetricsEvent = {
  workerId: string;
  hostname: string;
  cpuPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  ramPercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
  diskPercent: number;
  activeJobs: number;
  maxConcurrent: number;
  containerMetrics?: Array<{
    jobId: string;
    jobType: string;
    memoryUsageMb: number;
    memoryLimitMb: number;
    cpuPercent: number;
  }>;
};

export const emitHeartbeatMetrics = (event: HeartbeatMetricsEvent): void => {
  if (!posthogClient) return;
  try {
    posthogClient.capture({
      distinctId: event.workerId,
      event: "runner_heartbeat",
      properties: {
        worker_id: event.workerId,
        hostname: event.hostname,
        cpu_percent: event.cpuPercent,
        ram_used_mb: event.ramUsedMb,
        ram_total_mb: event.ramTotalMb,
        ram_percent: event.ramPercent,
        disk_used_gb: event.diskUsedGb,
        disk_total_gb: event.diskTotalGb,
        disk_percent: event.diskPercent,
        active_jobs: event.activeJobs,
        max_concurrent: event.maxConcurrent,
        container_count: event.containerMetrics?.length ?? 0,
        containers_ram_total_mb: event.containerMetrics?.reduce((s, c) => s + c.memoryUsageMb, 0) ?? 0,
        containers_cpu_total: event.containerMetrics?.reduce((s, c) => s + c.cpuPercent, 0) ?? 0,
      },
    });
  } catch {
    // best-effort
  }
};

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

export const shutdownTelemetry = async (): Promise<void> => {
  const tasks: Promise<void>[] = [];

  if (posthogClient) {
    tasks.push(posthogClient.shutdown().catch(() => undefined));
  }
  if (sentryInitialized) {
    tasks.push(Sentry.close(2000).then(() => undefined).catch(() => undefined));
  }

  await Promise.all(tasks);
};
