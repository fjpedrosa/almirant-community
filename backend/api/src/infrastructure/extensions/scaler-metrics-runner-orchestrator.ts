import type { RunnerOrchestrator, RunnerMetrics } from "@almirant/shared";
import { env, logger } from "@almirant/config";

/**
 * CE default RunnerOrchestrator.
 *
 * Reads Prometheus-format metrics from an optional external scaler
 * (SCALER_METRICS_URL). Returns null when:
 * - SCALER_METRICS_URL is not set (self-hosted without an external scaler).
 * - The fetch fails (timeout, network error, non-2xx response).
 *
 * For self-hosted deployments without an external scaler, this returns null
 * and the dashboard renders an empty state — which is the correct CE behavior.
 *
 * Enterprise Edition can inject a richer orchestrator that actually spawns
 * and manages runners (Hetzner scaler in production).
 *
 * Metric names preserved from the previous inline implementation in
 * workers-dashboard.routes.ts:
 * - `almirant_scaler_runners_total`  (label `coding_agent="shared"`) → activeRunners/totalRunners
 * - `almirant_scaler_queue_depth`    (label `coding_agent="shared"`) → pendingJobs
 * - `almirant_scaler_runners_target` (label `coding_agent="shared"`) → targetRunners
 * - `process_start_time_seconds`     (any labels)                   → uptimeSeconds (derived)
 *
 * Note: the scaler does not export `runner_idle` today, so `idleRunners` is 0.
 */

const FETCH_TIMEOUT_MS = 5_000;

type MetricParseStrategy = "first" | "sum";

const parsePrometheusLabels = (
  rawLabels: string | undefined,
): Record<string, string> => {
  if (!rawLabels) return {};

  return rawLabels
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const match = entry.match(/^([^=]+)="(.*)"$/);
      if (!match) return acc;

      const [, key, value] = match;
      if (!key) return acc;

      acc[key] = (value ?? "").replace(/\\"/g, '"');
      return acc;
    }, {});
};

const parsePrometheusMetric = (
  text: string,
  name: string,
  {
    strategy = "sum",
    preferredLabels,
  }: {
    strategy?: MetricParseStrategy;
    preferredLabels?: Record<string, string>;
  } = {},
): number | null => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `^${escapedName}(?:\\{([^}]*)\\})?\\s+([^\\s]+)$`,
    "gm",
  );

  const matches = Array.from(text.matchAll(regex))
    .map((match) => {
      const value = Number(match[2]);
      if (!Number.isFinite(value)) return null;

      return {
        value,
        labels: parsePrometheusLabels(match[1]),
      };
    })
    .filter(
      (entry): entry is { value: number; labels: Record<string, string> } =>
        entry !== null,
    );

  if (matches.length === 0) return null;

  const preferredMatches =
    preferredLabels == null
      ? matches
      : matches.filter(({ labels }) =>
          Object.entries(preferredLabels).every(
            ([key, value]) => labels[key] === value,
          ),
        );

  const selectedMatches = preferredMatches.length > 0 ? preferredMatches : matches;

  if (strategy === "first") {
    return selectedMatches[0]?.value ?? null;
  }

  return selectedMatches.reduce((sum, entry) => sum + entry.value, 0);
};

export const scalerMetricsRunnerOrchestrator: RunnerOrchestrator = {
  async getMetrics(): Promise<RunnerMetrics | null> {
    const url = env.SCALER_METRICS_URL;
    if (!url) return null;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn(
          { url, status: response.status },
          "scalerMetricsRunnerOrchestrator: scaler returned non-OK",
        );
        return null;
      }

      const text = await response.text();

      const activeRunners = parsePrometheusMetric(
        text,
        "almirant_scaler_runners_total",
        { preferredLabels: { coding_agent: "shared" } },
      );

      const queueDepth = parsePrometheusMetric(
        text,
        "almirant_scaler_queue_depth",
        { preferredLabels: { coding_agent: "shared" } },
      );

      const targetRunners = parsePrometheusMetric(
        text,
        "almirant_scaler_runners_target",
        { preferredLabels: { coding_agent: "shared" } },
      );

      const processStartTime = parsePrometheusMetric(
        text,
        "process_start_time_seconds",
        { strategy: "first" },
      );

      const uptimeSeconds =
        processStartTime === null
          ? null
          : Math.floor(Date.now() / 1000 - processStartTime);

      const total = activeRunners ?? 0;
      return {
        totalRunners: total,
        activeRunners: total,
        idleRunners: 0,
        pendingJobs: queueDepth ?? 0,
        targetRunners,
        uptimeSeconds,
      };
    } catch (err) {
      logger.warn(
        { err, url },
        "scalerMetricsRunnerOrchestrator: fetch failed",
      );
      return null;
    }
  },
};
