import { db } from "../../client";
import { usageRecords, projects, boards, boardColumns, workItems } from "../../schema";
import { agentJobs } from "../../schema/agent-jobs";
import { eq, and, sql, gte, count, countDistinct, desc } from "drizzle-orm";

/**
 * Get org-level analytics overview KPIs.
 *
 * Returns entity counts and usage stats scoped to the given organization.
 */
export const getOrgAnalyticsOverview = async (organizationId: string) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  // Run all count queries in parallel for performance
  const [
    aiSessionsResult,
    activeUsersResult,
    activeProjectsResult,
    totalBoardsResult,
    workItemsCreatedResult,
    workItemsCompletedResult,
  ] = await Promise.all([
    // Total AI sessions (usage records) for the org
    db
      .select({ count: count() })
      .from(usageRecords)
      .where(eq(usageRecords.organizationId, organizationId)),

    // Active users: distinct users with usage records in last 30 days
    db
      .select({ count: countDistinct(usageRecords.userId) })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.organizationId, organizationId),
          gte(usageRecords.startedAt, thirtyDaysAgo)
        )
      ),

    // Active projects count (status = 'active')
    db
      .select({ count: count() })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          eq(projects.status, "active")
        )
      ),

    // Total boards count
    db
      .select({ count: count() })
      .from(boards)
      .where(eq(boards.organizationId, organizationId)),

    // Work items created (all, via boards belonging to the org)
    db
      .select({ count: count() })
      .from(workItems)
      .innerJoin(boards, eq(workItems.boardId, boards.id))
      .where(eq(boards.organizationId, organizationId)),

    // Work items completed (boardColumn.isDone = true)
    db
      .select({ count: count() })
      .from(workItems)
      .innerJoin(boards, eq(workItems.boardId, boards.id))
      .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
      .where(
        and(
          eq(boards.organizationId, organizationId),
          eq(boardColumns.isDone, true)
        )
      ),
  ]);

  return {
    totalAiSessions: aiSessionsResult[0]?.count ?? 0,
    activeUsers: activeUsersResult[0]?.count ?? 0,
    activeProjects: activeProjectsResult[0]?.count ?? 0,
    totalBoards: totalBoardsResult[0]?.count ?? 0,
    workItemsCreated: workItemsCreatedResult[0]?.count ?? 0,
    workItemsCompleted: workItemsCompletedResult[0]?.count ?? 0,
  };
};

/**
 * Get token usage grouped by period (month) for the given organization.
 *
 * Returns an array sorted by period descending with totalTokens, totalCost,
 * and jobCount for each month. Only completed jobs are counted.
 */
export const getTokenUsageByPeriod = async (
  organizationId: string,
  months: number = 12
) => {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

  const rows = await db
    .select({
      period: sql<string>`to_char(${agentJobs.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`,
      totalTokens: sql<number>`coalesce(sum(${agentJobs.tokensUsed}), 0)::int`,
      totalCost: sql<number>`coalesce(sum(${agentJobs.cost}::numeric), 0)::float`,
      jobCount: count(),
    })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.organizationId, organizationId),
        eq(agentJobs.status, "completed"),
        gte(agentJobs.createdAt, cutoff)
      )
    )
    .groupBy(
      sql`to_char(${agentJobs.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`
    )
    .orderBy(
      desc(
        sql`to_char(${agentJobs.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`
      )
    );

  return rows.map((r) => ({
    period: r.period,
    totalTokens: Number(r.totalTokens),
    totalCost: Number(r.totalCost),
    jobCount: r.jobCount,
  }));
};

/**
 * Get model usage breakdown for the organization.
 *
 * Groups completed agent jobs by model and returns job count, total tokens, and total cost.
 */
export const getModelUsage = async (
  organizationId: string,
  months: number = 12
) => {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

  const rows = await db
    .select({
      model: agentJobs.model,
      jobCount: count(),
      totalTokens: sql<number>`coalesce(sum(${agentJobs.tokensUsed}), 0)::int`,
      totalCost: sql<number>`coalesce(sum(${agentJobs.cost}::numeric), 0)::float`,
    })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.organizationId, organizationId),
        eq(agentJobs.status, "completed"),
        gte(agentJobs.createdAt, cutoff)
      )
    )
    .groupBy(agentJobs.model)
    .orderBy(desc(count()));

  return rows.map((r) => ({
    model: r.model,
    jobCount: r.jobCount,
    totalTokens: Number(r.totalTokens),
    totalCost: Number(r.totalCost),
  }));
};

/**
 * Get coding agent usage distribution (by codingAgent field) for the given organization.
 *
 * Returns an array of { codingAgent, jobCount, totalTokens, totalCost }
 * grouped by coding agent (claude-code, codex, opencode, etc.). Only completed jobs are counted.
 */
export const getCodingAgentUsage = async (
  organizationId: string,
  months: number = 12,
  userId?: string
) => {
  const startDate = new Date();
  startDate.setUTCMonth(startDate.getUTCMonth() - months);

  const conditions = [
    eq(agentJobs.organizationId, organizationId),
    eq(agentJobs.status, "completed"),
    gte(agentJobs.createdAt, startDate),
  ];
  if (userId) conditions.push(eq(agentJobs.createdByUserId, userId));

  const rows = await db
    .select({
      codingAgent: agentJobs.codingAgent,
      jobCount: sql<number>`count(*)::int`,
      totalTokens: sql<number>`coalesce(sum(${agentJobs.tokensUsed}), 0)::int`,
      totalCost: sql<number>`coalesce(sum(${agentJobs.cost}::numeric), 0)::numeric`,
    })
    .from(agentJobs)
    .where(and(...conditions))
    .groupBy(agentJobs.codingAgent)
    .orderBy(desc(sql`count(*)`));

  return rows;
};
