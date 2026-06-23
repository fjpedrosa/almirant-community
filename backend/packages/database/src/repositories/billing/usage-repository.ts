import { db } from "../../client";
import { usageRecords, usageSummaries, userUsageSummaries } from "../../schema";
import { organization, member } from "../../schema/organization";
import { user } from "../../schema/auth";
import { projects } from "../../schema/projects";
import { agentJobs } from "../../schema/agent-jobs";
import {
  eq,
  and,
  sql,
  gte,
  lt,
  desc,
  asc,
  isNotNull,
  SQL,
} from "drizzle-orm";
import type {
  NewUsageRecord,
  UsageRecordDb,
  UsageSummaryDb,
  UserUsageSummaryDb,
} from "../../schema/usage";

type AdminUsageFilters = {
  sessionType?: string;
  codingAgent?: string;
  model?: string;
  userId?: string;
};

const getPeriodRange = (period: string) => {
  const [year, month] = period.split("-").map(Number);

  return {
    startDate: new Date(Date.UTC(year!, month! - 1, 1)),
    endDate: new Date(Date.UTC(year!, month!, 1)),
  };
};

const buildAdminUsageFilterConditions = (
  opts?: AdminUsageFilters & {
    startDate?: Date;
    endDate?: Date;
    organizationId?: string;
  }
) => {
  const conditions: SQL<unknown>[] = [];

  if (opts?.organizationId) {
    conditions.push(eq(usageRecords.organizationId, opts.organizationId));
  }

  if (opts?.startDate) {
    conditions.push(gte(usageRecords.startedAt, opts.startDate));
  }

  if (opts?.endDate) {
    conditions.push(lt(usageRecords.startedAt, opts.endDate));
  }

  if (opts?.sessionType) {
    conditions.push(
      eq(
        usageRecords.sessionType,
        opts.sessionType as UsageRecordDb["sessionType"]
      )
    );
  }

  if (opts?.userId) {
    conditions.push(eq(usageRecords.userId, opts.userId));
  }

  if (opts?.codingAgent) {
    conditions.push(
      eq(
        agentJobs.codingAgent,
        opts.codingAgent as typeof agentJobs.codingAgent.enumValues[number]
      )
    );
  }

  if (opts?.model) {
    conditions.push(eq(agentJobs.model, opts.model));
  }

  return {
    conditions,
    needsAgentJobsJoin: Boolean(opts?.codingAgent || opts?.model),
  };
};

// Create a usage record
export const createUsageRecord = async (
  data: Omit<NewUsageRecord, "id" | "createdAt">
): Promise<UsageRecordDb> => {
  const [record] = await db.insert(usageRecords).values(data).returning();
  if (!record) throw new Error("Failed to create usage record");
  return record;
};

// Get usage records for an organization within a date range
export const getUsageRecords = async (
  organizationId: string,
  opts?: {
    projectId?: string;
    startDate?: Date;
    endDate?: Date;
    sessionType?: UsageRecordDb["sessionType"];
  }
): Promise<UsageRecordDb[]> => {
  // Build conditions dynamically
  const conditions = [eq(usageRecords.organizationId, organizationId)];
  if (opts?.projectId)
    conditions.push(eq(usageRecords.projectId, opts.projectId));
  if (opts?.startDate)
    conditions.push(gte(usageRecords.startedAt, opts.startDate));
  if (opts?.endDate) conditions.push(lt(usageRecords.startedAt, opts.endDate));
  if (opts?.sessionType)
    conditions.push(eq(usageRecords.sessionType, opts.sessionType));

  return db
    .select()
    .from(usageRecords)
    .where(and(...conditions))
    .orderBy(desc(usageRecords.startedAt));
};

// Aggregate usage records into summaries for a given month
export const aggregateUsageForPeriod = async (
  organizationId: string,
  period: string // "2026-03" format
): Promise<UsageSummaryDb> => {
  // Parse period to get date range
  const [year, month] = period.split("-").map(Number);
  const startDate = new Date(Date.UTC(year!, month! - 1, 1));
  const endDate = new Date(Date.UTC(year!, month!, 1));

  // Query aggregated data
  const [agg] = await db
    .select({
      totalSeconds:
        sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
      totalJobs: sql<number>`count(*)::int`,
      implementSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'implement' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      validateSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'validate' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      planningSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'planning' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      reviewSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'review' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      chatSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'chat' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.organizationId, organizationId),
        gte(usageRecords.startedAt, startDate),
        lt(usageRecords.startedAt, endDate)
      )
    );

  // Upsert summary
  const [summary] = await db
    .insert(usageSummaries)
    .values({
      organizationId,
      period,
      totalSeconds: agg?.totalSeconds ?? 0,
      totalJobs: agg?.totalJobs ?? 0,
      implementSeconds: agg?.implementSeconds ?? 0,
      validateSeconds: agg?.validateSeconds ?? 0,
      planningSeconds: agg?.planningSeconds ?? 0,
      reviewSeconds: agg?.reviewSeconds ?? 0,
      chatSeconds: agg?.chatSeconds ?? 0,
    })
    .onConflictDoUpdate({
      target: [usageSummaries.organizationId, usageSummaries.period],
      set: {
        totalSeconds: agg?.totalSeconds ?? 0,
        totalJobs: agg?.totalJobs ?? 0,
        implementSeconds: agg?.implementSeconds ?? 0,
        validateSeconds: agg?.validateSeconds ?? 0,
        planningSeconds: agg?.planningSeconds ?? 0,
        reviewSeconds: agg?.reviewSeconds ?? 0,
        chatSeconds: agg?.chatSeconds ?? 0,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!summary) throw new Error("Failed to upsert usage summary");
  return summary;
};

// Get usage summaries (monthly history)
export const getUsageSummaries = async (
  organizationId: string,
  months: number = 6
): Promise<UsageSummaryDb[]> => {
  return db
    .select()
    .from(usageSummaries)
    .where(eq(usageSummaries.organizationId, organizationId))
    .orderBy(desc(usageSummaries.period))
    .limit(months);
};

// Get current month summary
export const getCurrentUsageSummary = async (
  organizationId: string
): Promise<UsageSummaryDb | null> => {
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const [summary] = await db
    .select()
    .from(usageSummaries)
    .where(
      and(
        eq(usageSummaries.organizationId, organizationId),
        eq(usageSummaries.period, period)
      )
    )
    .limit(1);

  return summary ?? null;
};

// Aggregate usage records into per-user summaries for a given month
export const aggregateUserUsageForPeriod = async (
  organizationId: string,
  period: string // "2026-03" format
): Promise<UserUsageSummaryDb[]> => {
  const [year, month] = period.split("-").map(Number);
  const startDate = new Date(Date.UTC(year!, month! - 1, 1));
  const endDate = new Date(Date.UTC(year!, month!, 1));

  // Query aggregated data grouped by userId
  const rows = await db
    .select({
      userId: usageRecords.userId,
      totalSeconds:
        sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
      totalJobs: sql<number>`count(*)::int`,
      implementSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'implement' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      validateSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'validate' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      planningSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'planning' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      reviewSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'review' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      chatSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'chat' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.organizationId, organizationId),
        isNotNull(usageRecords.userId),
        gte(usageRecords.startedAt, startDate),
        lt(usageRecords.startedAt, endDate)
      )
    )
    .groupBy(usageRecords.userId);

  const results: UserUsageSummaryDb[] = [];

  for (const row of rows) {
    if (!row.userId) continue;

    const [summary] = await db
      .insert(userUsageSummaries)
      .values({
        organizationId,
        userId: row.userId,
        period,
        totalSeconds: row.totalSeconds,
        totalJobs: row.totalJobs,
        implementSeconds: row.implementSeconds,
        validateSeconds: row.validateSeconds,
        planningSeconds: row.planningSeconds,
        reviewSeconds: row.reviewSeconds,
        chatSeconds: row.chatSeconds,
      })
      .onConflictDoUpdate({
        target: [
          userUsageSummaries.organizationId,
          userUsageSummaries.userId,
          userUsageSummaries.period,
        ],
        set: {
          totalSeconds: row.totalSeconds,
          totalJobs: row.totalJobs,
          implementSeconds: row.implementSeconds,
          validateSeconds: row.validateSeconds,
          planningSeconds: row.planningSeconds,
          reviewSeconds: row.reviewSeconds,
          chatSeconds: row.chatSeconds,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (summary) results.push(summary);
  }

  return results;
};

// Get user usage summary for current or specified period
export const getUserUsageSummary = async (
  organizationId: string,
  userId: string,
  period?: string
): Promise<UserUsageSummaryDb | null> => {
  const targetPeriod =
    period ??
    (() => {
      const now = new Date();
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    })();

  const [summary] = await db
    .select()
    .from(userUsageSummaries)
    .where(
      and(
        eq(userUsageSummaries.organizationId, organizationId),
        eq(userUsageSummaries.userId, userId),
        eq(userUsageSummaries.period, targetPeriod)
      )
    )
    .limit(1);

  return summary ?? null;
};

// Get user usage summaries (monthly history)
export const getUserUsageSummaries = async (
  organizationId: string,
  userId: string,
  months: number = 6
): Promise<UserUsageSummaryDb[]> => {
  return db
    .select()
    .from(userUsageSummaries)
    .where(
      and(
        eq(userUsageSummaries.organizationId, organizationId),
        eq(userUsageSummaries.userId, userId)
      )
    )
    .orderBy(desc(userUsageSummaries.period))
    .limit(months);
};

// Get daily usage grouped by day
export const getDailyUsage = async (
  organizationId: string,
  opts?: {
    days?: number;
    sessionType?: string;
    userId?: string;
  }
) => {
  const days = opts?.days ?? 30;
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - days);
  startDate.setUTCHours(0, 0, 0, 0);

  const conditions = [
    eq(usageRecords.organizationId, organizationId),
    gte(usageRecords.startedAt, startDate),
  ];

  if (opts?.sessionType) {
    conditions.push(
      eq(
        usageRecords.sessionType,
        opts.sessionType as UsageRecordDb["sessionType"]
      )
    );
  }
  if (opts?.userId) {
    conditions.push(eq(usageRecords.userId, opts.userId));
  }

  const rows = await db
    .select({
      date: sql<string>`to_char(${usageRecords.startedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      totalSeconds:
        sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
      totalJobs: sql<number>`count(*)::int`,
      implementSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'implement' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      validateSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'validate' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      planningSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'planning' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      reviewSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'review' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      chatSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'chat' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    })
    .from(usageRecords)
    .where(and(...conditions))
    .groupBy(
      sql`to_char(${usageRecords.startedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
    )
    .orderBy(
      sql`to_char(${usageRecords.startedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
    );

  return rows.map((row) => ({
    date: row.date,
    totalSeconds: row.totalSeconds,
    totalJobs: row.totalJobs,
    breakdown: {
      implement: row.implementSeconds,
      validate: row.validateSeconds,
      planning: row.planningSeconds,
      review: row.reviewSeconds,
      chat: row.chatSeconds,
    },
  }));
};

export const getHourlyUsage = async (
  organizationId: string,
  opts?: {
    days?: number;
    sessionType?: string;
    userId?: string;
  }
) => {
  const days = opts?.days ?? 30;
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - days);
  startDate.setUTCHours(0, 0, 0, 0);

  const conditions = [
    eq(usageRecords.organizationId, organizationId),
    gte(usageRecords.startedAt, startDate),
  ];

  if (opts?.sessionType) {
    conditions.push(
      eq(
        usageRecords.sessionType,
        opts.sessionType as UsageRecordDb["sessionType"]
      )
    );
  }
  if (opts?.userId) {
    conditions.push(eq(usageRecords.userId, opts.userId));
  }

  const hourExpr = sql<string>`to_char(${usageRecords.startedAt} AT TIME ZONE 'UTC', 'HH24')`;

  const rows = await db
    .select({
      hour: hourExpr,
      totalSeconds:
        sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
      totalJobs: sql<number>`count(*)::int`,
    })
    .from(usageRecords)
    .where(and(...conditions))
    .groupBy(hourExpr)
    .orderBy(hourExpr);

  const usageByHour = new Map(
    rows.map((row) => [Number(row.hour), row])
  );

  return Array.from({ length: 24 }, (_, hour) => {
    const row = usageByHour.get(hour);
    const label = `${String(hour).padStart(2, "0")}:00`;

    return {
      hour,
      label,
      totalSeconds: row?.totalSeconds ?? 0,
      totalJobs: row?.totalJobs ?? 0,
    };
  });
};


// Get daily usage grouped by day across all organizations (admin view)
export const getGlobalDailyUsage = async (opts?: {
  days?: number;
  sessionType?: string;
  codingAgent?: string;
  model?: string;
  userId?: string;
}) => {
  const days = opts?.days ?? 30;
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - days);
  startDate.setUTCHours(0, 0, 0, 0);
  const { conditions, needsAgentJobsJoin } = buildAdminUsageFilterConditions({
    startDate,
    sessionType: opts?.sessionType,
    codingAgent: opts?.codingAgent,
    model: opts?.model,
    userId: opts?.userId,
  });
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const selectFields = {
    date: sql<string>`to_char(${usageRecords.startedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    totalSeconds:
      sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
    totalJobs: sql<number>`count(*)::int`,
    implementSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'implement' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    validateSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'validate' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    planningSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'planning' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    reviewSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'review' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    chatSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'chat' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
  };
  const dateExpr = sql`to_char(${usageRecords.startedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

  const rows = needsAgentJobsJoin
    ? await db
        .select(selectFields)
        .from(usageRecords)
        .innerJoin(agentJobs, eq(usageRecords.jobId, agentJobs.id))
        .where(whereClause)
        .groupBy(dateExpr)
        .orderBy(dateExpr)
    : await db
        .select(selectFields)
        .from(usageRecords)
        .where(whereClause)
        .groupBy(dateExpr)
        .orderBy(dateExpr);

  return rows.map((row) => ({
    date: row.date,
    totalSeconds: row.totalSeconds,
    totalJobs: row.totalJobs,
    breakdown: {
      implement: row.implementSeconds,
      validate: row.validateSeconds,
      planning: row.planningSeconds,
      review: row.reviewSeconds,
      chat: row.chatSeconds,
    },
  }));
};

export const getGlobalMonthlyUsage = async (opts?: {
  months?: number;
  sessionType?: string;
  codingAgent?: string;
  model?: string;
  userId?: string;
}) => {
  const months = opts?.months ?? 12;
  const startDate = new Date();
  startDate.setUTCMonth(startDate.getUTCMonth() - months + 1, 1);
  startDate.setUTCHours(0, 0, 0, 0);

  const { conditions, needsAgentJobsJoin } = buildAdminUsageFilterConditions({
    startDate,
    sessionType: opts?.sessionType,
    codingAgent: opts?.codingAgent,
    model: opts?.model,
    userId: opts?.userId,
  });
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const monthExpr = sql`to_char(date_trunc('month', ${usageRecords.startedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

  const selectFields = {
    date: sql<string>`${monthExpr}`,
    totalSeconds:
      sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
    totalJobs: sql<number>`count(*)::int`,
    implementSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'implement' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    validateSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'validate' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    planningSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'planning' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    reviewSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'review' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    chatSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'chat' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
  };

  const rows = needsAgentJobsJoin
    ? await db
        .select(selectFields)
        .from(usageRecords)
        .innerJoin(agentJobs, eq(usageRecords.jobId, agentJobs.id))
        .where(whereClause)
        .groupBy(monthExpr)
        .orderBy(monthExpr)
    : await db
        .select(selectFields)
        .from(usageRecords)
        .where(whereClause)
        .groupBy(monthExpr)
        .orderBy(monthExpr);

  return rows.map((row) => ({
    date: row.date,
    totalSeconds: row.totalSeconds,
    totalJobs: row.totalJobs,
    breakdown: {
      implement: row.implementSeconds,
      validate: row.validateSeconds,
      planning: row.planningSeconds,
      review: row.reviewSeconds,
      chat: row.chatSeconds,
    },
  }));
};

// Get weekly usage grouped by ISO week
export const getWeeklyUsage = async (
  organizationId: string,
  opts?: {
    weeks?: number;
    sessionType?: string;
    userId?: string;
  }
) => {
  const weeks = opts?.weeks ?? 12;
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - weeks * 7);
  startDate.setUTCHours(0, 0, 0, 0);

  const conditions = [
    eq(usageRecords.organizationId, organizationId),
    gte(usageRecords.startedAt, startDate),
  ];

  if (opts?.sessionType) {
    conditions.push(
      eq(
        usageRecords.sessionType,
        opts.sessionType as UsageRecordDb["sessionType"]
      )
    );
  }
  if (opts?.userId) {
    conditions.push(eq(usageRecords.userId, opts.userId));
  }

  const weekExpr = sql`to_char(date_trunc('week', ${usageRecords.startedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      date: sql<string>`${weekExpr}`,
      totalSeconds:
        sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
      totalJobs: sql<number>`count(*)::int`,
      implementSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'implement' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      validateSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'validate' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      planningSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'planning' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      reviewSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'review' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
      chatSeconds:
        sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'chat' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    })
    .from(usageRecords)
    .where(and(...conditions))
    .groupBy(weekExpr)
    .orderBy(weekExpr);

  return rows.map((row) => ({
    date: row.date,
    totalSeconds: row.totalSeconds,
    totalJobs: row.totalJobs,
    breakdown: {
      implement: row.implementSeconds,
      validate: row.validateSeconds,
      planning: row.planningSeconds,
      review: row.reviewSeconds,
      chat: row.chatSeconds,
    },
  }));
};

// Get weekly usage grouped by ISO week across all organizations (admin view)
export const getGlobalWeeklyUsage = async (opts?: {
  weeks?: number;
  sessionType?: string;
  codingAgent?: string;
  model?: string;
  userId?: string;
}) => {
  const weeks = opts?.weeks ?? 12;
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - weeks * 7);
  startDate.setUTCHours(0, 0, 0, 0);
  const { conditions, needsAgentJobsJoin } = buildAdminUsageFilterConditions({
    startDate,
    sessionType: opts?.sessionType,
    codingAgent: opts?.codingAgent,
    model: opts?.model,
    userId: opts?.userId,
  });
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const weekExpr = sql`to_char(date_trunc('week', ${usageRecords.startedAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
  const selectFields = {
    date: sql<string>`${weekExpr}`,
    totalSeconds:
      sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
    totalJobs: sql<number>`count(*)::int`,
    implementSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'implement' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    validateSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'validate' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    planningSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'planning' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    reviewSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'review' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
    chatSeconds:
      sql<number>`coalesce(sum(case when ${usageRecords.sessionType} = 'chat' then ${usageRecords.durationSeconds} else 0 end), 0)::int`,
  };

  const rows = needsAgentJobsJoin
    ? await db
        .select(selectFields)
        .from(usageRecords)
        .innerJoin(agentJobs, eq(usageRecords.jobId, agentJobs.id))
        .where(whereClause)
        .groupBy(weekExpr)
        .orderBy(weekExpr)
    : await db
        .select(selectFields)
        .from(usageRecords)
        .where(whereClause)
        .groupBy(weekExpr)
        .orderBy(weekExpr);

  return rows.map((row) => ({
    date: row.date,
    totalSeconds: row.totalSeconds,
    totalJobs: row.totalJobs,
    breakdown: {
      implement: row.implementSeconds,
      validate: row.validateSeconds,
      planning: row.planningSeconds,
      review: row.reviewSeconds,
      chat: row.chatSeconds,
    },
  }));
};

/** User usage summary with optional user info from the user table */
export type UserUsageSummaryWithUser = UserUsageSummaryDb & {
  userName: string | null;
  userEmail: string | null;
};

// Get all user usage summaries for a period (admin view)
// Starts from member table so ALL org members appear, even those with zero usage.
export const getAllUserUsageSummaries = async (
  organizationId: string,
  period: string
): Promise<UserUsageSummaryWithUser[]> => {
  const rows = await db
    .select({
      id: sql<string>`coalesce(${userUsageSummaries.id}, ${member.id})`.as(
        "id"
      ),
      organizationId: member.organizationId,
      userId: member.userId,
      period: sql<string>`coalesce(${userUsageSummaries.period}, ${period})`.as(
        "period"
      ),
      totalSeconds:
        sql<number>`coalesce(${userUsageSummaries.totalSeconds}, 0)`.as(
          "total_seconds"
        ),
      totalJobs:
        sql<number>`coalesce(${userUsageSummaries.totalJobs}, 0)`.as(
          "total_jobs"
        ),
      implementSeconds:
        sql<number>`coalesce(${userUsageSummaries.implementSeconds}, 0)`.as(
          "implement_seconds"
        ),
      validateSeconds:
        sql<number>`coalesce(${userUsageSummaries.validateSeconds}, 0)`.as(
          "validate_seconds"
        ),
      planningSeconds:
        sql<number>`coalesce(${userUsageSummaries.planningSeconds}, 0)`.as(
          "planning_seconds"
        ),
      reviewSeconds:
        sql<number>`coalesce(${userUsageSummaries.reviewSeconds}, 0)`.as(
          "review_seconds"
        ),
      chatSeconds:
        sql<number>`coalesce(${userUsageSummaries.chatSeconds}, 0)`.as(
          "chat_seconds"
        ),
      createdAt:
        sql<Date>`coalesce(${userUsageSummaries.createdAt}, ${member.createdAt})`.as(
          "created_at"
        ),
      updatedAt:
        sql<Date>`coalesce(${userUsageSummaries.updatedAt}, ${member.createdAt})`.as(
          "updated_at"
        ),
      userName: user.name,
      userEmail: user.email,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .leftJoin(
      userUsageSummaries,
      and(
        eq(userUsageSummaries.userId, member.userId),
        eq(userUsageSummaries.organizationId, member.organizationId),
        eq(userUsageSummaries.period, period)
      )
    )
    .where(eq(member.organizationId, organizationId))
    .orderBy(
      desc(
        sql`coalesce(${userUsageSummaries.totalSeconds}, 0)`
      )
    );

  return rows;
};

// Get global cross-org usage summary for a period (backoffice admin view)
export const getGlobalUsageSummary = async (
  period: string,
  filters?: AdminUsageFilters
) => {
  const { startDate, endDate } = getPeriodRange(period);
  const { conditions, needsAgentJobsJoin } = buildAdminUsageFilterConditions({
    startDate,
    endDate,
    sessionType: filters?.sessionType,
    codingAgent: filters?.codingAgent,
    model: filters?.model,
    userId: filters?.userId,
  });
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totals = needsAgentJobsJoin
    ? await db
        .select({
          totalSeconds:
            sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
          totalSessions: sql<number>`count(*)::int`,
          totalActiveUsers:
            sql<number>`count(distinct ${usageRecords.userId})::int`,
          totalActiveOrganizations:
            sql<number>`count(distinct ${usageRecords.organizationId})::int`,
        })
        .from(usageRecords)
        .innerJoin(agentJobs, eq(usageRecords.jobId, agentJobs.id))
        .where(whereClause)
    : await db
        .select({
          totalSeconds:
            sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
          totalSessions: sql<number>`count(*)::int`,
          totalActiveUsers:
            sql<number>`count(distinct ${usageRecords.userId})::int`,
          totalActiveOrganizations:
            sql<number>`count(distinct ${usageRecords.organizationId})::int`,
        })
        .from(usageRecords)
        .where(whereClause);

  const [totalsRow] = totals;

  const orgSelect = {
    orgId: organization.id,
    orgName: organization.name,
    totalSeconds:
      sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
    totalSessions: sql<number>`count(*)::int`,
    activeUsers: sql<number>`count(distinct ${usageRecords.userId})::int`,
    projectCount:
      sql<number>`(select count(*) from ${projects} where ${projects.organizationId} = ${organization.id})::int`,
  };
  const orgOrderExpr = desc(
    sql`coalesce(sum(${usageRecords.durationSeconds}), 0)`
  );

  const organizationBreakdown = needsAgentJobsJoin
    ? await db
        .select(orgSelect)
        .from(usageRecords)
        .innerJoin(organization, eq(usageRecords.organizationId, organization.id))
        .innerJoin(agentJobs, eq(usageRecords.jobId, agentJobs.id))
        .where(whereClause)
        .groupBy(organization.id, organization.name)
        .orderBy(orgOrderExpr)
    : await db
        .select(orgSelect)
        .from(usageRecords)
        .innerJoin(organization, eq(usageRecords.organizationId, organization.id))
        .where(whereClause)
        .groupBy(organization.id, organization.name)
        .orderBy(orgOrderExpr);

  const topUserConditions = [
    isNotNull(usageRecords.userId),
    ...conditions,
  ] as SQL<unknown>[];
  const topUsersWhere =
    topUserConditions.length > 0 ? and(...topUserConditions) : undefined;

  const userUsageTotals = (
    needsAgentJobsJoin
      ? db
          .select({
            organizationId: usageRecords.organizationId,
            userId: usageRecords.userId,
            totalSeconds:
              sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
          })
          .from(usageRecords)
          .innerJoin(agentJobs, eq(usageRecords.jobId, agentJobs.id))
          .where(topUsersWhere)
          .groupBy(usageRecords.organizationId, usageRecords.userId)
      : db
          .select({
            organizationId: usageRecords.organizationId,
            userId: usageRecords.userId,
            totalSeconds:
              sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
          })
          .from(usageRecords)
          .where(topUsersWhere)
          .groupBy(usageRecords.organizationId, usageRecords.userId)
  ).as("user_usage_totals");

  const topUsers = await db
    .select({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      orgName: organization.name,
      totalSeconds:
        sql<number>`coalesce(${userUsageTotals.totalSeconds}, 0)::int`,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .leftJoin(
      userUsageTotals,
      and(
        eq(userUsageTotals.organizationId, member.organizationId),
        eq(userUsageTotals.userId, member.userId)
      )
    )
    .orderBy(
      desc(sql`coalesce(${userUsageTotals.totalSeconds}, 0)`),
      asc(user.name)
    )
    .limit(5);

  return {
    totalSeconds: totalsRow?.totalSeconds ?? 0,
    totalSessions: totalsRow?.totalSessions ?? 0,
    totalActiveUsers: totalsRow?.totalActiveUsers ?? 0,
    totalActiveOrganizations: totalsRow?.totalActiveOrganizations ?? 0,
    organizationBreakdown,
    topUsers,
  };
};

// Get model distribution across all agent jobs (admin view)
export const getModelDistribution = async (
  period?: string,
  filters?: AdminUsageFilters
) => {
  const range = period ? getPeriodRange(period) : undefined;
  const baseConditions: SQL<unknown>[] = [isNotNull(usageRecords.jobId)];
  const { conditions } = buildAdminUsageFilterConditions({
    startDate: range?.startDate,
    endDate: range?.endDate,
    sessionType: filters?.sessionType,
    codingAgent: filters?.codingAgent,
    model: filters?.model,
    userId: filters?.userId,
  });
  baseConditions.push(...conditions);
  const whereClause = and(...baseConditions);

  const filteredJobs = db
    .select({
      jobId: usageRecords.jobId,
      model: agentJobs.model,
      totalSeconds:
        sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
      tokensUsed: sql<number>`coalesce(${agentJobs.tokensUsed}, 0)::int`,
    })
    .from(usageRecords)
    .innerJoin(agentJobs, eq(usageRecords.jobId, agentJobs.id))
    .where(whereClause)
    .groupBy(usageRecords.jobId, agentJobs.model, agentJobs.tokensUsed)
    .as("filtered_jobs");

  return db
    .select({
      model: filteredJobs.model,
      jobCount: sql<number>`count(*)::int`,
      totalMinutes:
        sql<number>`(coalesce(sum(${filteredJobs.totalSeconds}), 0) / 60)::int`,
      totalTokens:
        sql<number>`coalesce(sum(${filteredJobs.tokensUsed}), 0)::int`,
    })
    .from(filteredJobs)
    .where(sql`${filteredJobs.model} is not null`)
    .groupBy(filteredJobs.model)
    .orderBy(desc(sql`coalesce(sum(${filteredJobs.totalSeconds}), 0)`));
};

// Get coding agent distribution (admin view)
export const getCodingAgentDistribution = async (
  period?: string,
  filters?: AdminUsageFilters
) => {
  const range = period ? getPeriodRange(period) : undefined;
  const baseConditions: SQL<unknown>[] = [isNotNull(usageRecords.jobId)];
  const { conditions } = buildAdminUsageFilterConditions({
    startDate: range?.startDate,
    endDate: range?.endDate,
    sessionType: filters?.sessionType,
    codingAgent: filters?.codingAgent,
    model: filters?.model,
    userId: filters?.userId,
  });
  baseConditions.push(...conditions);
  const whereClause = and(...baseConditions);

  const filteredJobs = db
    .select({
      jobId: usageRecords.jobId,
      codingAgent: agentJobs.codingAgent,
      totalSeconds:
        sql<number>`coalesce(sum(${usageRecords.durationSeconds}), 0)::int`,
    })
    .from(usageRecords)
    .innerJoin(agentJobs, eq(usageRecords.jobId, agentJobs.id))
    .where(whereClause)
    .groupBy(usageRecords.jobId, agentJobs.codingAgent)
    .as("filtered_jobs");

  return db
    .select({
      codingAgent: filteredJobs.codingAgent,
      jobCount: sql<number>`count(*)::int`,
      totalMinutes:
        sql<number>`(coalesce(sum(${filteredJobs.totalSeconds}), 0) / 60)::int`,
    })
    .from(filteredJobs)
    .where(sql`${filteredJobs.codingAgent} is not null`)
    .groupBy(filteredJobs.codingAgent)
    .orderBy(desc(sql`coalesce(sum(${filteredJobs.totalSeconds}), 0)`));
};

// Get activity distribution by session type (admin view)
export const getActivityDistribution = async (
  period?: string,
  filters?: AdminUsageFilters
) => {
  const range = period ? getPeriodRange(period) : undefined;
  const { conditions, needsAgentJobsJoin } = buildAdminUsageFilterConditions({
    startDate: range?.startDate,
    endDate: range?.endDate,
    sessionType: filters?.sessionType,
    codingAgent: filters?.codingAgent,
    model: filters?.model,
    userId: filters?.userId,
  });
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return needsAgentJobsJoin
    ? db
        .select({
          sessionType: usageRecords.sessionType,
          totalMinutes:
            sql<number>`(coalesce(sum(${usageRecords.durationSeconds}), 0) / 60)::int`,
          jobCount: sql<number>`count(*)::int`,
        })
        .from(usageRecords)
        .innerJoin(agentJobs, eq(usageRecords.jobId, agentJobs.id))
        .where(whereClause)
        .groupBy(usageRecords.sessionType)
        .orderBy(desc(sql`coalesce(sum(${usageRecords.durationSeconds}), 0)`))
    : db
        .select({
          sessionType: usageRecords.sessionType,
          totalMinutes:
            sql<number>`(coalesce(sum(${usageRecords.durationSeconds}), 0) / 60)::int`,
          jobCount: sql<number>`count(*)::int`,
        })
        .from(usageRecords)
        .where(whereClause)
        .groupBy(usageRecords.sessionType)
        .orderBy(desc(sql`coalesce(sum(${usageRecords.durationSeconds}), 0)`));
};

// Get available filter values for admin usage views
export const getAvailableFilters = async () => {
  const [codingAgentsResult, modelsResult, usersResult, sessionTypesResult] =
    await Promise.all([
      db
        .selectDistinct({ value: agentJobs.codingAgent })
        .from(agentJobs)
        .where(isNotNull(agentJobs.codingAgent)),
      db
        .selectDistinct({ value: agentJobs.model })
        .from(agentJobs)
        .where(isNotNull(agentJobs.model)),
      db
        .selectDistinct({
          id: user.id,
          name: user.name,
          email: user.email,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id)),
      db
        .selectDistinct({ value: usageRecords.sessionType })
        .from(usageRecords),
    ]);

  return {
    codingAgents: codingAgentsResult
      .map((result) => result.value)
      .filter(
        (
          value
        ): value is typeof agentJobs.codingAgent.enumValues[number] => Boolean(value)
      ),
    models: modelsResult
      .map((result) => result.value)
      .filter((value): value is string => Boolean(value)),
    users: usersResult,
    sessionTypes: sessionTypesResult.map((result) => result.value),
  };
};
