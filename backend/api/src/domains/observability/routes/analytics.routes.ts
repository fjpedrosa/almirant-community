import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  getOrgAnalyticsOverview,
  getCurrentUsageSummary,
  getAllUserUsageSummaries,
  getUserUsageSummaries,
  getUsageSummaries,
  getTokenUsageByPeriod,
  getModelUsage,
  getCodingAgentUsage,
  getAllWorkersMetricsHistory,
  getWorkersWithJobs,
} from "@almirant/database";
import { logger } from "@almirant/config";
import { successResponse, errorResponse } from "../../../shared/services/response";

type MonitoringRange = "1h" | "6h" | "24h";

const MONITORING_RANGE_MS: Record<MonitoringRange, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const resolveMonitoringRange = (range: string | undefined): MonitoringRange => {
  if (range === "6h" || range === "24h") return range;
  return "1h";
};

export const analyticsRoutes = new Elysia({ prefix: "/analytics" })
  .use(sessionContextTypes)

  // GET /analytics/overview - KPIs for the active organization
  .get("/overview", async ({ activeOrganization }) => {
    try {
      const orgId = activeOrganization!.id;

      const [overview, usageSummary] = await Promise.all([
        getOrgAnalyticsOverview(orgId),
        getCurrentUsageSummary(orgId),
      ]);

      return successResponse({
        ...overview,
        currentMonthUsage: {
          totalSeconds: usageSummary?.totalSeconds ?? 0,
          totalJobs: usageSummary?.totalJobs ?? 0,
          breakdown: {
            implement: usageSummary?.implementSeconds ?? 0,
            validate: usageSummary?.validateSeconds ?? 0,
            planning: usageSummary?.planningSeconds ?? 0,
            review: usageSummary?.reviewSeconds ?? 0,
            chat: usageSummary?.chatSeconds ?? 0,
          },
        },
      });
    } catch (error) {
      logger.error({ error }, "Failed to get analytics overview");
      return errorResponse("Failed to get analytics overview");
    }
  })

  // GET /analytics/users - Per-user consumption for the org
  .get(
    "/users",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;

        const now = new Date();
        const period =
          query.period ??
          `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

        const summaries = await getAllUserUsageSummaries(orgId, period);

        const data = summaries.map((s) => ({
          userId: s.userId,
          userName: s.userName ?? null,
          userEmail: s.userEmail ?? null,
          period: s.period,
          totalSeconds: s.totalSeconds,
          billableSeconds: s.totalSeconds - s.planningSeconds,
          totalJobs: s.totalJobs,
          breakdown: {
            implement: s.implementSeconds,
            validate: s.validateSeconds,
            planning: s.planningSeconds,
            review: s.reviewSeconds,
            chat: s.chatSeconds,
          },
        }));

        return successResponse(data);
      } catch (error) {
        logger.error({ error }, "Failed to get analytics users");
        return errorResponse("Failed to get analytics users");
      }
    },
    {
      query: t.Object({
        period: t.Optional(t.String()),
      }),
    }
  )

  // GET /analytics/users/:userId - Monthly detail for a specific user
  .get(
    "/users/:userId",
    async ({ params, query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const months = query.months ?? 6;
        const clampedMonths = Math.min(24, Math.max(1, months));

        const summaries = await getUserUsageSummaries(
          orgId,
          params.userId,
          clampedMonths
        );

        const history = summaries.map((s) => ({
          userId: s.userId,
          period: s.period,
          totalSeconds: s.totalSeconds,
          billableSeconds: s.totalSeconds - s.planningSeconds,
          totalJobs: s.totalJobs,
          breakdown: {
            implement: s.implementSeconds,
            validate: s.validateSeconds,
            planning: s.planningSeconds,
            review: s.reviewSeconds,
            chat: s.chatSeconds,
          },
        }));

        return successResponse(history);
      } catch (error) {
        logger.error({ error }, "Failed to get analytics user detail");
        return errorResponse("Failed to get analytics user detail");
      }
    },
    {
      params: t.Object({
        userId: t.String(),
      }),
      query: t.Object({
        months: t.Optional(t.Numeric()),
      }),
    }
  )

  // GET /analytics/trends - Monthly trend data
  .get(
    "/trends",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const months = query.months ?? 12;
        const clampedMonths = Math.min(24, Math.max(1, months));

        const summaries = await getUsageSummaries(orgId, clampedMonths);

        const trends = summaries.map((s) => ({
          period: s.period,
          totalSeconds: s.totalSeconds,
          totalJobs: s.totalJobs,
          breakdown: {
            implement: s.implementSeconds,
            validate: s.validateSeconds,
            planning: s.planningSeconds,
            review: s.reviewSeconds,
            chat: s.chatSeconds,
          },
        }));

        return successResponse(trends);
      } catch (error) {
        logger.error({ error }, "Failed to get analytics trends");
        return errorResponse("Failed to get analytics trends");
      }
    },
    {
      query: t.Object({
        months: t.Optional(t.Numeric()),
      }),
    }
  )

  // GET /analytics/token-usage - Token consumption grouped by period
  .get(
    "/token-usage",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const months = query.months ?? 12;
        const clampedMonths = Math.min(24, Math.max(1, months));

        const data = await getTokenUsageByPeriod(orgId, clampedMonths);

        return successResponse(data);
      } catch (error) {
        logger.error({ error }, "Failed to get token usage by period");
        return errorResponse("Failed to get token usage by period");
      }
    },
    {
      query: t.Object({
        months: t.Optional(t.Numeric()),
      }),
    }
  )

  // GET /analytics/model-usage - Model usage breakdown
  .get(
    "/model-usage",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const months = query.months ?? 12;
        const clampedMonths = Math.min(24, Math.max(1, months));

        const data = await getModelUsage(orgId, clampedMonths);

        return successResponse(data);
      } catch (error) {
        logger.error({ error }, "Failed to get model usage");
        return errorResponse("Failed to get model usage");
      }
    },
    {
      query: t.Object({
        months: t.Optional(t.Numeric()),
      }),
    }
  )

  // GET /analytics/agent-usage - Coding agent usage breakdown
  .get(
    "/agent-usage",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const months = Math.min(24, Math.max(1, query.months ?? 12));
        const data = await getCodingAgentUsage(orgId, months, query.userId);
        return successResponse(
          data.map((d) => ({
            codingAgent: d.codingAgent,
            jobCount: d.jobCount,
            totalTokens: d.totalTokens,
            totalCost: Number(d.totalCost),
          }))
        );
      } catch (error) {
        logger.error({ error }, "Failed to get agent usage");
        return errorResponse("Failed to get agent usage");
      }
    },
    {
      query: t.Object({
        months: t.Optional(t.Numeric()),
        userId: t.Optional(t.String()),
      }),
    }
  )

  // GET /analytics/system-monitoring - Runner/system/process telemetry for analytics
  .get(
    "/system-monitoring",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const range = resolveMonitoringRange(query.range);
        const now = new Date();
        const from = new Date(now.getTime() - MONITORING_RANGE_MS[range]);
        const downsampleInterval = range === "24h" ? 6 : undefined;

        const [workers, metricsHistory] = await Promise.all([
          getWorkersWithJobs(orgId),
          getAllWorkersMetricsHistory(from, now, downsampleInterval, orgId),
        ]);

        return successResponse({
          range,
          generatedAt: now.toISOString(),
          workers,
          metricsHistory,
        });
      } catch (error) {
        logger.error({ error }, "Failed to get analytics system monitoring");
        return errorResponse("Failed to get analytics system monitoring");
      }
    },
    {
      query: t.Object({
        range: t.Optional(t.String()),
      }),
    }
  );
