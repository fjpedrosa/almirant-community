import { db } from "../../client";
import { providerQuotas, quotaUsagePeriods, quotaAlerts } from "../../schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import type {
  ProviderQuotaDb,
  NewProviderQuota,
  QuotaUsagePeriodDb,
  QuotaAlertDb,
  NewQuotaAlert,
} from "../../schema/quotas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuotaAvailability = {
  allowed: boolean;
  remaining?: {
    tokens: number | null;
    costUsd: number | null;
    requests: number | null;
  };
  reason?: string;
  resetAt?: string;
  periodEnd?: string;
  blockingQuotaType?: "daily" | "weekly" | "monthly";
};

export type CurrentUsage = {
  quota: ProviderQuotaDb;
  usage: QuotaUsagePeriodDb | null;
};

// ---------------------------------------------------------------------------
// Period calculation helpers (pure functions)
// ---------------------------------------------------------------------------

export const computePeriodBounds = (
  periodType: "daily" | "weekly" | "monthly",
  referenceDate: Date = new Date()
): { start: Date; end: Date } => {
  const ref = new Date(referenceDate);

  switch (periodType) {
    case "daily": {
      const start = new Date(
        Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())
      );
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return { start, end };
    }

    case "weekly": {
      // Monday = 1 in getUTCDay(), Sunday = 0
      const dayOfWeek = ref.getUTCDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const start = new Date(
        Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() - diffToMonday)
      );
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      return { start, end };
    }

    case "monthly": {
      const start = new Date(
        Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1)
      );
      const end = new Date(
        Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1)
      );
      return { start, end };
    }
  }
};

// ---------------------------------------------------------------------------
// Provider Quotas CRUD
// ---------------------------------------------------------------------------

export const listProviderQuotas = async (organizationId: string): Promise<ProviderQuotaDb[]> => {
  return db
    .select()
    .from(providerQuotas)
    .where(eq(providerQuotas.organizationId, organizationId))
    .orderBy(desc(providerQuotas.createdAt));
};

export const createProviderQuota = async (
  organizationId: string,
  data: Omit<NewProviderQuota, "id" | "createdAt" | "updatedAt" | "organizationId">
): Promise<ProviderQuotaDb> => {
  const [quota] = await db
    .insert(providerQuotas)
    .values({ ...data, organizationId })
    .returning();

  if (!quota) throw new Error("Failed to create provider quota");
  return quota;
};

export const updateProviderQuota = async (
  organizationId: string,
  id: string,
  data: Partial<
    Pick<NewProviderQuota, "maxTokens" | "maxCostUsd" | "maxRequests" | "isActive">
  >
): Promise<ProviderQuotaDb> => {
  const [updated] = await db
    .update(providerQuotas)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(providerQuotas.id, id), eq(providerQuotas.organizationId, organizationId)))
    .returning();

  if (!updated) throw new Error("Provider quota not found");
  return updated;
};

// ---------------------------------------------------------------------------
// Active quota lookup
// ---------------------------------------------------------------------------

export const getActiveQuotaByProvider = async (
  organizationId: string,
  provider: ProviderQuotaDb["provider"]
): Promise<ProviderQuotaDb[]> => {
  return db
    .select()
    .from(providerQuotas)
    .where(
      and(
        eq(providerQuotas.provider, provider),
        eq(providerQuotas.isActive, true),
        eq(providerQuotas.organizationId, organizationId)
      )
    );
};

// ---------------------------------------------------------------------------
// Usage period management
// ---------------------------------------------------------------------------

export const getOrCreateUsagePeriod = async (
  provider: QuotaUsagePeriodDb["provider"],
  periodType: QuotaUsagePeriodDb["periodType"],
  referenceDate: Date = new Date()
): Promise<QuotaUsagePeriodDb> => {
  const { start, end } = computePeriodBounds(periodType, referenceDate);

  const [period] = await db
    .insert(quotaUsagePeriods)
    .values({
      provider,
      periodType,
      periodStart: start,
      periodEnd: end,
      totalTokens: 0,
      totalCostUsd: "0",
      totalRequests: 0,
    })
    .onConflictDoUpdate({
      target: [
        quotaUsagePeriods.provider,
        quotaUsagePeriods.periodType,
        quotaUsagePeriods.periodStart,
      ],
      set: {
        // No-op update to return the existing row
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!period) throw new Error("Failed to get or create usage period");
  return period;
};

// ---------------------------------------------------------------------------
// Atomic usage increment
// ---------------------------------------------------------------------------

export const incrementUsage = async (
  provider: QuotaUsagePeriodDb["provider"],
  tokens: number,
  costUsd: number,
  requests: number = 1
): Promise<void> => {
  const now = new Date();
  const periodTypes = ["daily", "weekly", "monthly"] as const;

  for (const periodType of periodTypes) {
    const { start, end } = computePeriodBounds(periodType, now);

    // Upsert + atomic increment in a single statement
    await db
      .insert(quotaUsagePeriods)
      .values({
        provider,
        periodType,
        periodStart: start,
        periodEnd: end,
        totalTokens: tokens,
        totalCostUsd: costUsd.toFixed(6),
        totalRequests: requests,
      })
      .onConflictDoUpdate({
        target: [
          quotaUsagePeriods.provider,
          quotaUsagePeriods.periodType,
          quotaUsagePeriods.periodStart,
        ],
        set: {
          totalTokens: sql`${quotaUsagePeriods.totalTokens} + ${tokens}`,
          totalCostUsd: sql`${quotaUsagePeriods.totalCostUsd}::numeric + ${costUsd.toFixed(6)}::numeric`,
          totalRequests: sql`${quotaUsagePeriods.totalRequests} + ${requests}`,
          updatedAt: now,
        },
      });
  }
};

// ---------------------------------------------------------------------------
// Current usage retrieval
// ---------------------------------------------------------------------------

export const getCurrentUsage = async (
  organizationId: string,
  provider: ProviderQuotaDb["provider"],
  periodType?: "daily" | "weekly" | "monthly"
): Promise<CurrentUsage[]> => {
  const quotas = await getActiveQuotaByProvider(organizationId, provider);
  const results: CurrentUsage[] = [];

  for (const quota of quotas) {
    // If a specific periodType is requested, skip non-matching quotas
    if (periodType && quota.quotaType !== periodType) continue;

    const { start } = computePeriodBounds(quota.quotaType);

    const [usage] = await db
      .select()
      .from(quotaUsagePeriods)
      .where(
        and(
          eq(quotaUsagePeriods.provider, provider),
          eq(quotaUsagePeriods.periodType, quota.quotaType),
          eq(quotaUsagePeriods.periodStart, start)
        )
      )
      .limit(1);

    results.push({ quota, usage: usage ?? null });
  }

  return results;
};

// ---------------------------------------------------------------------------
// Quota availability check
// ---------------------------------------------------------------------------

export const checkQuotaAvailable = async (
  organizationId: string,
  provider: ProviderQuotaDb["provider"]
): Promise<QuotaAvailability> => {
  const quotas = await getActiveQuotaByProvider(organizationId, provider);

  // No quotas configured = unrestricted
  if (quotas.length === 0) {
    return { allowed: true };
  }

  const buildBlockedAvailability = (
    quota: ProviderQuotaDb,
    usage: {
      currentTokens: number;
      currentCost: number;
      currentRequests: number;
    },
    reason: string,
  ): QuotaAvailability => {
    const { end } = computePeriodBounds(quota.quotaType);
    return {
      allowed: false,
      remaining: {
        tokens: quota.maxTokens !== null ? Math.max(0, quota.maxTokens - usage.currentTokens) : null,
        costUsd: quota.maxCostUsd !== null ? Math.max(0, parseFloat(quota.maxCostUsd) - usage.currentCost) : null,
        requests: quota.maxRequests !== null ? Math.max(0, quota.maxRequests - usage.currentRequests) : null,
      },
      reason,
      resetAt: end.toISOString(),
      periodEnd: end.toISOString(),
      blockingQuotaType: quota.quotaType,
    };
  };

  for (const quota of quotas) {
    const { start } = computePeriodBounds(quota.quotaType);

    const [usage] = await db
      .select()
      .from(quotaUsagePeriods)
      .where(
        and(
          eq(quotaUsagePeriods.provider, provider),
          eq(quotaUsagePeriods.periodType, quota.quotaType),
          eq(quotaUsagePeriods.periodStart, start)
        )
      )
      .limit(1);

    const currentTokens = usage?.totalTokens ?? 0;
    const currentCost = parseFloat(usage?.totalCostUsd ?? "0");
    const currentRequests = usage?.totalRequests ?? 0;

    // Check each limit type
    if (quota.maxTokens !== null && currentTokens >= quota.maxTokens) {
      return buildBlockedAvailability(
        quota,
        { currentTokens, currentCost, currentRequests },
        `${quota.quotaType} token limit exceeded (${currentTokens}/${quota.maxTokens})`,
      );
    }

    if (quota.maxCostUsd !== null && currentCost >= parseFloat(quota.maxCostUsd)) {
      return buildBlockedAvailability(
        quota,
        { currentTokens, currentCost, currentRequests },
        `${quota.quotaType} cost limit exceeded ($${currentCost.toFixed(6)}/$${quota.maxCostUsd})`,
      );
    }

    if (quota.maxRequests !== null && currentRequests >= quota.maxRequests) {
      return buildBlockedAvailability(
        quota,
        { currentTokens, currentCost, currentRequests },
        `${quota.quotaType} request limit exceeded (${currentRequests}/${quota.maxRequests})`,
      );
    }
  }

  // All checks passed -- compute minimum remaining across all active quotas
  let minRemainingTokens: number | null = null;
  let minRemainingCost: number | null = null;
  let minRemainingRequests: number | null = null;

  for (const quota of quotas) {
    const { start } = computePeriodBounds(quota.quotaType);

    const [usage] = await db
      .select()
      .from(quotaUsagePeriods)
      .where(
        and(
          eq(quotaUsagePeriods.provider, provider),
          eq(quotaUsagePeriods.periodType, quota.quotaType),
          eq(quotaUsagePeriods.periodStart, start)
        )
      )
      .limit(1);

    const currentTokens = usage?.totalTokens ?? 0;
    const currentCost = parseFloat(usage?.totalCostUsd ?? "0");
    const currentRequests = usage?.totalRequests ?? 0;

    if (quota.maxTokens !== null) {
      const rem = quota.maxTokens - currentTokens;
      minRemainingTokens =
        minRemainingTokens === null ? rem : Math.min(minRemainingTokens, rem);
    }

    if (quota.maxCostUsd !== null) {
      const rem = parseFloat(quota.maxCostUsd) - currentCost;
      minRemainingCost =
        minRemainingCost === null ? rem : Math.min(minRemainingCost, rem);
    }

    if (quota.maxRequests !== null) {
      const rem = quota.maxRequests - currentRequests;
      minRemainingRequests =
        minRemainingRequests === null ? rem : Math.min(minRemainingRequests, rem);
    }
  }

  return {
    allowed: true,
    remaining: {
      tokens: minRemainingTokens,
      costUsd: minRemainingCost,
      requests: minRemainingRequests,
    },
  };
};

// ---------------------------------------------------------------------------
// Quota Alerts
// ---------------------------------------------------------------------------

export const createQuotaAlert = async (
  data: Omit<NewQuotaAlert, "id" | "createdAt">
): Promise<QuotaAlertDb> => {
  const [alert] = await db
    .insert(quotaAlerts)
    .values(data)
    .returning();

  if (!alert) throw new Error("Failed to create quota alert");
  return alert;
};

export const getUnacknowledgedAlerts = async (organizationId: string): Promise<QuotaAlertDb[]> => {
  // Join through providerQuotas to filter by organization
  const results = await db
    .select({
      alert: quotaAlerts,
    })
    .from(quotaAlerts)
    .innerJoin(providerQuotas, eq(quotaAlerts.providerQuotaId, providerQuotas.id))
    .where(
      and(
        isNull(quotaAlerts.acknowledgedAt),
        eq(providerQuotas.organizationId, organizationId)
      )
    )
    .orderBy(desc(quotaAlerts.createdAt));

  return results.map((r) => r.alert);
};

export const acknowledgeAlert = async (organizationId: string, alertId: string): Promise<QuotaAlertDb> => {
  // Verify alert belongs to organization via providerQuota
  const [alertRow] = await db
    .select({ alert: quotaAlerts })
    .from(quotaAlerts)
    .innerJoin(providerQuotas, eq(quotaAlerts.providerQuotaId, providerQuotas.id))
    .where(
      and(
        eq(quotaAlerts.id, alertId),
        eq(providerQuotas.organizationId, organizationId)
      )
    )
    .limit(1);

  if (!alertRow) throw new Error("Quota alert not found");

  const [updated] = await db
    .update(quotaAlerts)
    .set({ acknowledgedAt: new Date() })
    .where(eq(quotaAlerts.id, alertId))
    .returning();

  if (!updated) throw new Error("Quota alert not found");
  return updated;
};

// Get distinct organization IDs that have active quotas for a given provider
export const getOrganizationIdsWithActiveQuotas = async (
  provider: ProviderQuotaDb["provider"]
): Promise<string[]> => {
  const rows = await db
    .selectDistinct({ organizationId: providerQuotas.organizationId })
    .from(providerQuotas)
    .where(
      and(
        eq(providerQuotas.provider, provider),
        eq(providerQuotas.isActive, true)
      )
    );
  return rows.map((r) => r.organizationId);
};
