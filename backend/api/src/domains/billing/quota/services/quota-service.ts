import {
  checkQuotaAvailable,
  getCurrentUsage,
  incrementUsage,
  getUnacknowledgedAlerts,
  createQuotaAlert,
  computePeriodBounds,
  enqueueNotification,
  db,
  member,
  eq,
} from "@almirant/database";
import type { QuotaAvailability, CurrentUsage } from "@almirant/database";
import type { AiProvider } from "./ai-model-pricing";
import { logger } from "@almirant/config";
import { sendNotificationBatch } from "../../../../shared/services/notification-service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QuotaServiceConfig = {
  /** TTL for cached quota-availability entries (ms). Default: 30 000 */
  cacheTtlMs?: number;
  /** Interval for the background cache-cleanup tick (ms). Default: 60 000 */
  cleanupIntervalMs?: number;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

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

type UsageSummary = {
  items: UsageSummaryItem[];
};

type QuotaService = {
  checkQuotaForProvider: (workspaceId: string, provider: AiProvider) => Promise<QuotaAvailability>;
  recordUsage: (workspaceId: string, provider: AiProvider, tokens: number, costUsd: number) => Promise<void>;
  getUsageSummary: (workspaceId: string, provider?: AiProvider) => Promise<UsageSummary>;
  evaluateAlerts: (workspaceId: string, provider: AiProvider) => Promise<void>;
  stop: () => void;
};

// ---------------------------------------------------------------------------
// Alert threshold definitions
// ---------------------------------------------------------------------------

const ALERT_THRESHOLDS = [
  { percent: 100, alertType: "exceeded" as const },
  { percent: 90, alertType: "warning_90" as const },
  { percent: 80, alertType: "warning_80" as const },
  { percent: 75, alertType: "warning_75" as const },
];

// ---------------------------------------------------------------------------
// In-app notification helper
// ---------------------------------------------------------------------------

const createQuotaNotifications = async (
  workspaceId: string,
  provider: string,
  quotaType: string,
  alertType: string,
  percent: number,
  periodStart: Date,
): Promise<void> => {
  // Get all members of the workspace
  const orgMembers = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.workspaceId, workspaceId));

  if (orgMembers.length === 0) return;

  const thresholdLabel = alertType === "exceeded" ? "100%" : `${percent}%`;
  const title = `Alerta de uso: ${thresholdLabel} del límite ${quotaType} alcanzado`;
  const body = `El consumo de ${provider} ha alcanzado el ${percent}% del límite configurado (${quotaType}).`;

  const paramsList = orgMembers.map((m) => ({
    recipientUserId: m.userId,
    workspaceId,
    type: "status_changed" as const,
    title,
    body,
    metadata: {
      quotaAlert: true,
      alertType,
      provider,
      percent,
      quotaType,
    },
  }));

  await sendNotificationBatch(paramsList);

  const periodKey = periodStart.toISOString();
  const queueResults = await Promise.allSettled(
    orgMembers.map((m) =>
      enqueueNotification(
        workspaceId,
        m.userId,
        "status_changed",
        `quota-alert:${m.userId}:${provider}:${quotaType}:${alertType}:${periodKey}`,
        {
          title,
          body,
          itemLink: "/settings/quota",
        },
        1,
      )
    )
  );

  for (const result of queueResults) {
    if (result.status === "rejected") {
      logger.warn(
        { workspaceId, provider, quotaType, alertType, err: result.reason },
        "quota-service: failed to enqueue quota alert email"
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createQuotaService = (config?: QuotaServiceConfig): QuotaService => {
  const cacheTtlMs = config?.cacheTtlMs ?? 30_000;
  const cleanupIntervalMs = config?.cleanupIntervalMs ?? 60_000;

  // In-memory cache keyed by `${workspaceId}:${provider}`
  const cache = new Map<string, CacheEntry<QuotaAvailability>>();

  // Background cleanup state
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  // ------- Cache helpers -------

  const getCached = (key: string): QuotaAvailability | null => {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      cache.delete(key);
      return null;
    }
    return entry.value;
  };

  const setCache = (key: string, value: QuotaAvailability): void => {
    cache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
  };

  const invalidateCache = (key: string): void => {
    cache.delete(key);
  };

  // ------- Background cache cleanup -------

  const cleanupExpired = (): void => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now > entry.expiresAt) {
        cache.delete(key);
      }
    }
  };

  timer = setInterval(() => {
    if (stopped) return;
    cleanupExpired();
  }, cleanupIntervalMs);

  // ------- Service methods -------

  const checkQuotaForProvider = async (
    workspaceId: string,
    provider: AiProvider
  ): Promise<QuotaAvailability> => {
    const cacheKey = `${workspaceId}:${provider}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return cached;
    }

    const availability = await checkQuotaAvailable(workspaceId, provider);
    setCache(cacheKey, availability);
    return availability;
  };

  const recordUsage = async (
    workspaceId: string,
    provider: AiProvider,
    tokens: number,
    costUsd: number,
  ): Promise<void> => {
    await incrementUsage(provider, tokens, costUsd, 1);
    invalidateCache(`${workspaceId}:${provider}`);

    // Fire-and-forget alert evaluation; errors are logged but not propagated
    evaluateAlerts(workspaceId, provider).catch((err) => {
      logger.error({ provider, err }, "quota-service: failed to evaluate alerts after recording usage");
    });
  };

  const getUsageSummary = async (
    workspaceId: string,
    provider?: AiProvider
  ): Promise<UsageSummary> => {
    const providers: AiProvider[] = provider
      ? [provider]
      : ["anthropic", "openai", "google", "zai", "xai"];
    const items: UsageSummaryItem[] = [];

    for (const p of providers) {
      const usageEntries: CurrentUsage[] = await getCurrentUsage(workspaceId, p);

      for (const entry of usageEntries) {
        const { quota, usage } = entry;
        const usedTokens = usage?.totalTokens ?? 0;
        const usedCost = parseFloat(usage?.totalCostUsd ?? "0");
        const usedRequests = usage?.totalRequests ?? 0;

        const maxCostFloat = quota.maxCostUsd !== null ? parseFloat(quota.maxCostUsd) : null;

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

  const evaluateAlerts = async (
    workspaceId: string,
    provider: AiProvider
  ): Promise<void> => {
    const usageEntries = await getCurrentUsage(workspaceId, provider);
    if (usageEntries.length === 0) return;

    // Fetch existing unacknowledged alerts once to avoid duplicates
    const existingAlerts = await getUnacknowledgedAlerts(workspaceId);

    for (const entry of usageEntries) {
      const { quota, usage } = entry;
      const usedTokens = usage?.totalTokens ?? 0;
      const usedCost = parseFloat(usage?.totalCostUsd ?? "0");
      const usedRequests = usage?.totalRequests ?? 0;

      // Compute maximum percentage across all configured dimensions
      const percentages: number[] = [];
      if (quota.maxTokens !== null && quota.maxTokens > 0) {
        percentages.push((usedTokens / quota.maxTokens) * 100);
      }
      if (quota.maxCostUsd !== null) {
        const maxCost = parseFloat(quota.maxCostUsd);
        if (maxCost > 0) {
          percentages.push((usedCost / maxCost) * 100);
        }
      }
      if (quota.maxRequests !== null && quota.maxRequests > 0) {
        percentages.push((usedRequests / quota.maxRequests) * 100);
      }

      if (percentages.length === 0) continue;

      const maxPercent = Math.max(...percentages);
      const { start: periodStart } = computePeriodBounds(quota.quotaType);

      // Check thresholds from highest to lowest; create alert for the highest
      // threshold that has been crossed and doesn't already have an unacknowledged alert
      for (const threshold of ALERT_THRESHOLDS) {
        if (maxPercent < threshold.percent) continue;

        // Check if an unacknowledged alert already exists for this quota + type + period
        const alreadyExists = existingAlerts.some(
          (a) =>
            a.providerQuotaId === quota.id &&
            a.alertType === threshold.alertType &&
            a.periodStart.getTime() === periodStart.getTime(),
        );

        if (alreadyExists) break; // Higher threshold already alerted; skip lower ones

        await createQuotaAlert({
          providerQuotaId: quota.id,
          alertType: threshold.alertType,
          periodStart,
          message: `${provider} ${quota.quotaType} usage at ${Math.round(maxPercent)}% — threshold ${threshold.percent}% crossed`,
        });

        logger.warn(
          { provider, quotaType: quota.quotaType, alertType: threshold.alertType, percent: Math.round(maxPercent) },
          "quota-service: alert created",
        );

        // Create in-app notifications for all org members (fire-and-forget)
        createQuotaNotifications(
          workspaceId,
          provider,
          quota.quotaType,
          threshold.alertType,
          Math.round(maxPercent),
          periodStart,
        ).catch((notifErr) => {
          logger.warn({ notifErr }, "quota-service: failed to create usage notification");
        });

        break; // Only create the highest applicable alert per quota
      }
    }
  };

  // ------- Public API -------

  const stop = (): void => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    cache.clear();
  };

  return {
    checkQuotaForProvider,
    recordUsage,
    getUsageSummary,
    evaluateAlerts,
    stop,
  };
};
