import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  getCurrentUsageSummary,
  getUsageSummaries,
  getUsageRecords,
  getDailyUsage,
  getHourlyUsage,
  getWeeklyUsage,
  getUserUsageSummary,
  getUserUsageSummaries,
} from "@almirant/database";
import { logger } from "@almirant/config";
import { successResponse, errorResponse } from "../../../../shared/services/response";
import { quotaService } from "../services/quota-service-instance";

export const usageRoutes = new Elysia({ prefix: "/usage" })
  .use(sessionContextTypes)

  // GET /usage/summary - Current month usage for the org
  // Optional query param: projectId to filter by project
  .get(
    "/summary",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;

        // Fetch quota limits for the org (all active quotas across providers)
        const quotaSummary = await quotaService.getUsageSummary(orgId);
        const quotaItems = quotaSummary.items.map((item) => ({
          provider: item.provider,
          periodType: item.periodType,
          maxTokens: item.maxTokens,
          maxCostUsd: item.maxCostUsd,
          maxRequests: item.maxRequests,
          usedTokens: item.usedTokens,
          usedCostUsd: item.usedCostUsd,
          usedRequests: item.usedRequests,
          percentTokens: item.percentTokens,
          percentCost: item.percentCost,
          percentRequests: item.percentRequests,
          periodEnd: item.periodEnd,
        }));

        if (query.projectId) {
          const now = new Date();
          const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
          const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

          const records = await getUsageRecords(orgId, {
            projectId: query.projectId,
            startDate,
            endDate,
          });

          // Manually aggregate
          let totalSeconds = 0;
          let totalJobs = 0;
          const breakdown: Record<string, number> = {
            implement: 0,
            validate: 0,
            planning: 0,
            review: 0,
            chat: 0,
          };

          for (const r of records) {
            totalSeconds += r.durationSeconds;
            totalJobs++;
            const sessionType = r.sessionType;
            if (sessionType && sessionType in breakdown) {
              const key = sessionType as keyof typeof breakdown;
              breakdown[key] = (breakdown[key] ?? 0) + r.durationSeconds;
            }
          }

          return successResponse({
            organizationId: orgId,
            projectId: query.projectId,
            period: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
            totalSeconds,
            totalJobs,
            breakdown,
            quotas: quotaItems,
          });
        }

        // No projectId: get pre-aggregated summary
        const now = new Date();
        const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

        const summary = await getCurrentUsageSummary(orgId);

        return successResponse({
          organizationId: orgId,
          period,
          totalSeconds: summary?.totalSeconds ?? 0,
          totalJobs: summary?.totalJobs ?? 0,
          breakdown: {
            implement: summary?.implementSeconds ?? 0,
            validate: summary?.validateSeconds ?? 0,
            planning: summary?.planningSeconds ?? 0,
            review: summary?.reviewSeconds ?? 0,
            chat: summary?.chatSeconds ?? 0,
          },
          quotas: quotaItems,
        });
      } catch (error) {
        logger.error({ error }, "Failed to get usage summary");
        return errorResponse("Failed to get usage summary");
      }
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
      }),
    }
  )

  // GET /usage/history - Monthly usage history
  .get(
    "/history",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const months = query.months ?? 6;
        const clampedMonths = Math.min(24, Math.max(1, months));

        const summaries = await getUsageSummaries(orgId, clampedMonths);

        // Transform to a cleaner response format
        const history = summaries.map((s) => ({
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

        return successResponse(history);
      } catch (error) {
        logger.error({ error }, "Failed to get usage history");
        return errorResponse("Failed to get usage history");
      }
    },
    {
      query: t.Object({
        months: t.Optional(t.Numeric()),
      }),
    }
  )

  // GET /usage/user-summary - Current month usage for the authenticated user
  .get(
    "/user-summary",
    async ({ query, user, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const userId = user!.id;
        const period = query.period ?? undefined;

        const summary = await getUserUsageSummary(orgId, userId, period);

        const now = new Date();
        const currentPeriod =
          period ??
          `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

        const totalSeconds = summary?.totalSeconds ?? 0;
        const planningSeconds = summary?.planningSeconds ?? 0;
        const billableSeconds = totalSeconds - planningSeconds;

        return successResponse({
          userId,
          period: currentPeriod,
          totalSeconds,
          billableSeconds,
          totalJobs: summary?.totalJobs ?? 0,
          breakdown: {
            implement: summary?.implementSeconds ?? 0,
            validate: summary?.validateSeconds ?? 0,
            planning: planningSeconds,
            review: summary?.reviewSeconds ?? 0,
            chat: summary?.chatSeconds ?? 0,
          },
        });
      } catch (error) {
        logger.error({ error }, "Failed to get user usage summary");
        return errorResponse("Failed to get user usage summary");
      }
    },
    {
      query: t.Object({
        period: t.Optional(t.String()),
      }),
    }
  )

  // GET /usage/daily - Daily usage grouped by day
  .get(
    "/daily",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const days = Math.min(90, Math.max(1, query.days ?? 30));

        const dailyData = await getDailyUsage(orgId, {
          days,
          sessionType: query.sessionType,
          userId: query.userId,
        });

        return successResponse(dailyData);
      } catch (error) {
        logger.error({ error }, "Failed to get daily usage");
        return errorResponse("Failed to get daily usage");
      }
    },
    {
      query: t.Object({
        days: t.Optional(t.Numeric()),
        sessionType: t.Optional(t.String()),
        userId: t.Optional(t.String()),
      }),
    }
  )

  // GET /usage/hourly - Usage frequency grouped by hour of day
  .get(
    "/hourly",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const days = Math.min(90, Math.max(1, query.days ?? 30));

        const hourlyData = await getHourlyUsage(orgId, {
          days,
          sessionType: query.sessionType,
          userId: query.userId,
        });

        return successResponse(hourlyData);
      } catch (error) {
        logger.error({ error }, "Failed to get hourly usage");
        return errorResponse("Failed to get hourly usage");
      }
    },
    {
      query: t.Object({
        days: t.Optional(t.Numeric()),
        sessionType: t.Optional(t.String()),
        userId: t.Optional(t.String()),
      }),
    }
  )

  // GET /usage/weekly - Weekly usage grouped by ISO week
  .get(
    "/weekly",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const weeks = Math.min(52, Math.max(1, query.weeks ?? 12));

        const weeklyData = await getWeeklyUsage(orgId, {
          weeks,
          sessionType: query.sessionType,
          userId: query.userId,
        });

        return successResponse(weeklyData);
      } catch (error) {
        logger.error({ error }, "Failed to get weekly usage");
        return errorResponse("Failed to get weekly usage");
      }
    },
    {
      query: t.Object({
        weeks: t.Optional(t.Numeric()),
        sessionType: t.Optional(t.String()),
        userId: t.Optional(t.String()),
      }),
    }
  )

  // GET /usage/user-history - Monthly usage history for the authenticated user
  .get(
    "/user-history",
    async ({ query, user, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const userId = user!.id;
        const months = query.months ?? 6;
        const clampedMonths = Math.min(24, Math.max(1, months));

        const summaries = await getUserUsageSummaries(
          orgId,
          userId,
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
        logger.error({ error }, "Failed to get user usage history");
        return errorResponse("Failed to get user usage history");
      }
    },
    {
      query: t.Object({
        months: t.Optional(t.Numeric()),
      }),
    }
  );
