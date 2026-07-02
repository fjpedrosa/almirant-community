import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  listProviderQuotas,
  createProviderQuota,
  updateProviderQuota,
  getCurrentUsage,
  getUnacknowledgedAlerts,
  acknowledgeAlert,
  computePeriodBounds,
} from "@almirant/database";
import type { ProviderQuotaDb } from "@almirant/database";
import { logger } from "@almirant/config";
import { successResponse, errorResponse, notFoundResponse } from "../../../../shared/services/response";

type AiProviderEnum = ProviderQuotaDb["provider"];

// ---------------------------------------------------------------------------
// Usage summary builder (same logic as quota-service but without cache)
// ---------------------------------------------------------------------------

type UsageSummaryItem = {
  provider: string;
  periodType: string;
  maxTokens: number | null;
  maxCostUsd: number | null;
  maxRequests: number | null;
  usedTokens: number;
  usedCostUsd: number;
  usedRequests: number;
  percentTokens: number | null;
  percentCost: number | null;
  percentRequests: number | null;
  periodEnd: Date | null;
};

const buildUsageSummary = async (
  orgId: string,
  provider?: string
): Promise<{ items: UsageSummaryItem[] }> => {
  const providers: AiProviderEnum[] = provider
    ? [provider as AiProviderEnum]
    : ["anthropic", "openai", "google", "zai", "xai"];
  const items: UsageSummaryItem[] = [];

  for (const p of providers) {
    const usageEntries = await getCurrentUsage(orgId, p);

    for (const entry of usageEntries) {
      const { quota, usage } = entry;
      const usedTokens = usage?.totalTokens ?? 0;
      const usedCost = parseFloat(usage?.totalCostUsd ?? "0");
      const usedRequests = usage?.totalRequests ?? 0;

      const maxCostFloat =
        quota.maxCostUsd !== null ? parseFloat(quota.maxCostUsd) : null;

      const percentTokens =
        quota.maxTokens !== null && quota.maxTokens > 0
          ? Math.round((usedTokens / quota.maxTokens) * 10000) / 100
          : null;
      const percentCost =
        maxCostFloat !== null && maxCostFloat > 0
          ? Math.round((usedCost / maxCostFloat) * 10000) / 100
          : null;
      const percentRequests =
        quota.maxRequests !== null && quota.maxRequests > 0
          ? Math.round((usedRequests / quota.maxRequests) * 10000) / 100
          : null;

      const { end } = computePeriodBounds(quota.quotaType);

      items.push({
        provider: p,
        periodType: quota.quotaType,
        maxTokens: quota.maxTokens,
        maxCostUsd: maxCostFloat,
        maxRequests: quota.maxRequests,
        usedTokens,
        usedCostUsd: usedCost,
        usedRequests,
        percentTokens,
        percentCost,
        percentRequests,
        periodEnd: end,
      });
    }
  }

  return { items };
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const quotaRoutes = new Elysia({ prefix: "/quotas" })
  .use(sessionContextTypes)

  // GET /quotas - List all quota configurations
  .get("/", async ({ activeWorkspace }) => {
    try {
      const orgId = activeWorkspace!.id;
      const quotas = await listProviderQuotas(orgId);
      return successResponse(quotas);
    } catch (error) {
      logger.error({ error }, "Failed to list provider quotas");
      return errorResponse("Failed to list provider quotas");
    }
  })

  // POST /quotas - Create a new quota configuration
  .post(
    "/",
    async ({ body, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const quota = await createProviderQuota(orgId, {
          provider: body.provider,
          quotaType: body.quotaType,
          maxTokens: body.maxTokens ?? null,
          maxCostUsd: body.maxCostUsd != null ? String(body.maxCostUsd) : null,
          maxRequests: body.maxRequests ?? null,
          isActive: true,
        });
        set.status = 201;
        return successResponse(quota);
      } catch (error) {
        logger.error({ error }, "Failed to create provider quota");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to create provider quota"
        );
      }
    },
    {
      body: t.Object({
        provider: t.Union([
          t.Literal("anthropic"),
          t.Literal("openai"),
          t.Literal("google"),
          t.Literal("zai"),
        ]),
        quotaType: t.Union([
          t.Literal("daily"),
          t.Literal("weekly"),
          t.Literal("monthly"),
        ]),
        maxTokens: t.Optional(t.Number()),
        maxCostUsd: t.Optional(t.Number()),
        maxRequests: t.Optional(t.Number()),
      }),
    }
  )

  // PATCH /quotas/:id - Update a quota configuration
  .patch(
    "/:id",
    async ({ params, body, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const updateData: Record<string, unknown> = {};
        if (body.maxTokens !== undefined) updateData.maxTokens = body.maxTokens;
        if (body.maxCostUsd !== undefined)
          updateData.maxCostUsd =
            body.maxCostUsd != null ? String(body.maxCostUsd) : null;
        if (body.maxRequests !== undefined) updateData.maxRequests = body.maxRequests;
        if (body.isActive !== undefined) updateData.isActive = body.isActive;

        const quota = await updateProviderQuota(orgId, params.id, updateData);
        return successResponse(quota);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          set.status = 404;
          return notFoundResponse("Provider quota");
        }
        logger.error({ error }, "Failed to update provider quota");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to update provider quota"
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        maxTokens: t.Optional(t.Nullable(t.Number())),
        maxCostUsd: t.Optional(t.Nullable(t.Number())),
        maxRequests: t.Optional(t.Nullable(t.Number())),
        isActive: t.Optional(t.Boolean()),
      }),
    }
  )

  // GET /quotas/usage - Get usage summary for all providers
  .get(
    "/usage",
    async ({ activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const summary = await buildUsageSummary(orgId);
        return successResponse(summary);
      } catch (error) {
        logger.error({ error }, "Failed to get usage summary");
        return errorResponse("Failed to get usage summary");
      }
    }
  )

  // GET /quotas/usage/:provider - Get usage summary for a specific provider
  .get(
    "/usage/:provider",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const summary = await buildUsageSummary(orgId, params.provider);
        return successResponse(summary);
      } catch (error) {
        logger.error({ error, provider: params.provider }, "Failed to get provider usage");
        return errorResponse("Failed to get provider usage");
      }
    },
    {
      params: t.Object({
        provider: t.String(),
      }),
    }
  )

  // GET /quotas/alerts - Get unacknowledged alerts
  .get("/alerts", async ({ activeWorkspace }) => {
    try {
      const orgId = activeWorkspace!.id;
      const alerts = await getUnacknowledgedAlerts(orgId);
      return successResponse(alerts);
    } catch (error) {
      logger.error({ error }, "Failed to get quota alerts");
      return errorResponse("Failed to get quota alerts");
    }
  })

  // POST /quotas/alerts/:id/ack - Acknowledge an alert
  .post(
    "/alerts/:id/ack",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const alert = await acknowledgeAlert(orgId, params.id);
        return successResponse(alert);
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          set.status = 404;
          return notFoundResponse("Quota alert");
        }
        logger.error({ error }, "Failed to acknowledge quota alert");
        return errorResponse(
          error instanceof Error ? error.message : "Failed to acknowledge quota alert"
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
