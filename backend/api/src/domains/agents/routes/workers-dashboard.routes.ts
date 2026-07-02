import { Elysia, t } from "elysia";
import {
  getWorkersWithJobs,
  getMetricsHistory,
  getAllWorkersMetricsHistory,
  deleteWorker,
  getLifecycleEvents,
  getWorkerAuditSummary,
  getLifecycleEventsInRange,
} from "@almirant/database";
import { env } from "@almirant/config";
import { getRunnerOrchestrator } from "@almirant/shared";
import { successResponse, errorResponse } from "../../../shared/services/response";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";

const resolveScalerPeerUrl = (
  metricsUrl: string,
  peerPath: "status",
): string | null => {
  try {
    const url = new URL(metricsUrl);
    if (!url.pathname.endsWith("/metrics")) {
      return null;
    }

    url.pathname = url.pathname.replace(/\/metrics$/, `/${peerPath}`);
    return url.toString();
  } catch {
    return null;
  }
};

type OfflineZoneClassification = "planned" | "incident" | "unknown";

type OfflineTimelineEvent = {
  workerName: string;
  eventType: "started" | "stopped" | "draining_started" | "draining_stopped";
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
};

type OfflineZoneSummary = {
  from: string;
  to: string;
  durationMs: number;
  classification: OfflineZoneClassification;
  reason: string | null;
};

type WorkerTimelineSummary = {
  workerName: string;
  offlineZones: OfflineZoneSummary[];
  totalOfflineMs: number;
  plannedOfflineMs: number;
  incidentOfflineMs: number;
  unknownOfflineMs: number;
  totalOnlineMs: number;
  availabilityPercent: number;
};

const getLifecycleReason = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") return null;

  const reason = (metadata as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
};

const classifyOfflineZone = (
  reason: string | null,
  wasDraining: boolean,
): OfflineZoneClassification => {
  if (reason === "scale_down" || reason === "manual_scale_down") {
    return "planned";
  }

  if (reason === "heartbeat_timeout") {
    return wasDraining ? "planned" : "incident";
  }

  if (wasDraining) return "planned";
  if (reason) return "incident";
  return "unknown";
};

const buildOfflineTimelines = (
  events: OfflineTimelineEvent[],
  from: Date,
  to: Date,
): WorkerTimelineSummary[] => {
  const byWorker = new Map<string, OfflineTimelineEvent[]>();
  for (const event of events) {
    const list = byWorker.get(event.workerName) ?? [];
    list.push(event);
    byWorker.set(event.workerName, list);
  }

  const totalRangeMs = to.getTime() - from.getTime();
  const timelines: WorkerTimelineSummary[] = [];

  for (const [workerName, workerEvents] of byWorker) {
    const offlineZones: OfflineZoneSummary[] = [];
    let offlineSince: Date | null = null;
    let offlineReason: string | null = null;
    let offlineClassification: OfflineZoneClassification = "unknown";
    let isDraining = false;

    const firstEvent = workerEvents[0];
    if (firstEvent && firstEvent.createdAt <= from) {
      if (firstEvent.eventType === "stopped") {
        offlineSince = from;
        offlineReason = getLifecycleReason(firstEvent.metadata);
        offlineClassification = classifyOfflineZone(offlineReason, false);
      } else if (firstEvent.eventType === "draining_started") {
        isDraining = true;
      }
    }

    for (const event of workerEvents) {
      if (event.createdAt <= from) continue;

      const eventTime = event.createdAt > to ? to : event.createdAt;

      if (event.eventType === "draining_started") {
        isDraining = true;
        continue;
      }

      if (event.eventType === "draining_stopped") {
        isDraining = false;
        continue;
      }

      if (event.eventType === "stopped" && !offlineSince) {
        offlineSince = eventTime;
        offlineReason = getLifecycleReason(event.metadata);
        offlineClassification = classifyOfflineZone(offlineReason, isDraining);
        continue;
      }

      if (event.eventType === "started" && offlineSince) {
        offlineZones.push({
          from: offlineSince.toISOString(),
          to: eventTime.toISOString(),
          durationMs: eventTime.getTime() - offlineSince.getTime(),
          classification: offlineClassification,
          reason: offlineReason,
        });
        offlineSince = null;
        offlineReason = null;
        offlineClassification = "unknown";
        isDraining = false;
      }
    }

    if (offlineSince) {
      offlineZones.push({
        from: offlineSince.toISOString(),
        to: to.toISOString(),
        durationMs: to.getTime() - offlineSince.getTime(),
        classification: offlineClassification,
        reason: offlineReason,
      });
    }

    const totalOfflineMs = offlineZones.reduce((sum, zone) => sum + zone.durationMs, 0);
    const plannedOfflineMs = offlineZones
      .filter((zone) => zone.classification === "planned")
      .reduce((sum, zone) => sum + zone.durationMs, 0);
    const incidentOfflineMs = offlineZones
      .filter((zone) => zone.classification === "incident")
      .reduce((sum, zone) => sum + zone.durationMs, 0);
    const unknownOfflineMs = offlineZones
      .filter((zone) => zone.classification === "unknown")
      .reduce((sum, zone) => sum + zone.durationMs, 0);
    const totalOnlineMs = totalRangeMs - totalOfflineMs;
    const availabilityPercent =
      totalRangeMs > 0
        ? Math.round((totalOnlineMs / totalRangeMs) * 10000) / 100
        : 100;

    timelines.push({
      workerName,
      offlineZones,
      totalOfflineMs,
      plannedOfflineMs,
      incidentOfflineMs,
      unknownOfflineMs,
      totalOnlineMs,
      availabilityPercent,
    });
  }

  return timelines.sort((left, right) => {
    if (left.incidentOfflineMs !== right.incidentOfflineMs) {
      return right.incidentOfflineMs - left.incidentOfflineMs;
    }

    if (left.plannedOfflineMs !== right.plannedOfflineMs) {
      return right.plannedOfflineMs - left.plannedOfflineMs;
    }

    if (left.totalOfflineMs !== right.totalOfflineMs) {
      return right.totalOfflineMs - left.totalOfflineMs;
    }

    return left.workerName.localeCompare(right.workerName);
  });
};

// Mounted inside the /api/admin group (admin auth required).
export const workersDashboardRoutes = new Elysia({ prefix: "/workers" })
  .use(sessionContextTypes)
  // GET /api/workers
  .get("/", async ({ activeWorkspace }) => {
    const orgId = activeWorkspace!.id;
    const workers = await getWorkersWithJobs(orgId);
    return successResponse(workers);
  })

  // GET /api/workers/metrics-history
  .get(
    "/metrics-history",
    async ({ query, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const range = (query.range as string) ?? "1h";
      const workerId = query.workerId as string | undefined;

      const rangeMs: Record<string, number> = {
        "1h": 60 * 60 * 1000,
        "6h": 6 * 60 * 60 * 1000,
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
      };

      const ms = rangeMs[range] ?? rangeMs["1h"]!;
      const now = new Date();
      const from = new Date(now.getTime() - ms);

      // Downsample for larger ranges to keep payload manageable
      let downsampleInterval: number | undefined;
      if (range === "24h") downsampleInterval = 6;
      else if (range === "7d") downsampleInterval = 30;

      const data = workerId
        ? await getMetricsHistory(workerId, from, now, downsampleInterval, orgId)
        : await getAllWorkersMetricsHistory(from, now, downsampleInterval, orgId);

      return successResponse(data);
    },
    {
      query: t.Object({
        workerId: t.Optional(t.String()),
        range: t.Optional(t.String()),
      }),
    }
  )

  // GET /api/workers/scaler-metrics
  //
  // Primary scaler metrics (runners + queue depth + target + uptime) are
  // fetched via the RunnerOrchestrator extension point (CE default reads
  // SCALER_METRICS_URL).  Supplementary scaler-specific config
  // (infrastructureMode, queueAggregation, etc.) is fetched from the
  // `/status` peer endpoint since those fields are not part of the abstract
  // RunnerMetrics interface.
  .get("/scaler-metrics", async () => {
    const metrics = await getRunnerOrchestrator().getMetrics();

    if (metrics === null) {
      return successResponse({ available: false });
    }

    const scalerStatusUrl = env.SCALER_METRICS_URL
      ? resolveScalerPeerUrl(env.SCALER_METRICS_URL, "status")
      : null;

    const statusPayload = scalerStatusUrl
      ? await fetch(scalerStatusUrl, {
          signal: AbortSignal.timeout(5_000),
        })
          .then(async (statusResponse) => {
            if (!statusResponse.ok) return null;
            return (await statusResponse.json()) as {
              config?: {
                infrastructureMode?: string;
                queueAggregation?: string;
                minAvailableSlots?: number;
                maxConcurrentPerRunner?: number;
              };
            };
          })
          .catch(() => null)
      : null;

    return successResponse({
      available: true,
      queueDepth: metrics.pendingJobs,
      activeRunners: metrics.activeRunners,
      targetRunners: metrics.targetRunners ?? null,
      infrastructureMode: statusPayload?.config?.infrastructureMode ?? null,
      queueAggregation: statusPayload?.config?.queueAggregation ?? null,
      minAvailableSlots: statusPayload?.config?.minAvailableSlots ?? null,
      maxConcurrentPerRunner:
        statusPayload?.config?.maxConcurrentPerRunner ?? null,
      lastDecisionAt: null,
      uptimeSeconds: metrics.uptimeSeconds ?? null,
    });
  })

  // GET /api/workers/offline-timeline
  .get(
    "/offline-timeline",
    async ({ query, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const range = (query.range as string) ?? "24h";

      const rangeMs: Record<string, number> = {
        "24h": 24 * 60 * 60 * 1000,
        "7d": 7 * 24 * 60 * 60 * 1000,
        "30d": 30 * 24 * 60 * 60 * 1000,
      };

      const ms = rangeMs[range] ?? rangeMs["24h"]!;
      const now = new Date();
      const from = new Date(now.getTime() - ms);

      const events = (await getLifecycleEventsInRange(
        from,
        now,
        orgId,
      )) as OfflineTimelineEvent[];
      const totalRangeMs = now.getTime() - from.getTime();
      const timelines = buildOfflineTimelines(events, from, now);

      return successResponse({
        range,
        from: from.toISOString(),
        to: now.toISOString(),
        totalRangeMs,
        workers: timelines,
      });
    },
    {
      query: t.Object({
        range: t.Optional(t.String()),
      }),
    }
  )

  // GET /api/workers/:name/lifecycle
  .get(
    "/:name/lifecycle",
    async ({ params, query, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const limit = query.limit ? parseInt(query.limit, 10) : 100;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      const events = await getLifecycleEvents(params.name, { limit, offset, orgId });
      return successResponse(events);
    },
    {
      params: t.Object({
        name: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    }
  )

  // GET /api/workers/:name/audit
  .get(
    "/:name/audit",
    async ({ params, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const summary = await getWorkerAuditSummary(params.name, orgId);
      return successResponse(summary);
    },
    {
      params: t.Object({
        name: t.String(),
      }),
    }
  )

  // DELETE /api/workers/:workerId
  .delete(
    "/:workerId",
    async ({ params, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const deleted = await deleteWorker(params.workerId, orgId);
      if (!deleted) {
        return errorResponse("Worker not found or does not belong to this workspace", 404);
      }
      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        workerId: t.String(),
      }),
    }
  );
