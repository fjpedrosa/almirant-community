import { db } from "../../client";
import { workerMetricsHistory } from "../../schema/worker-metrics";
import { agentJobs, workerRegistrations } from "../../schema";
import { and, eq, gte, lte, lt, sql } from "drizzle-orm";
import { logger } from "@almirant/config";

export type InsertMetricsSnapshotInput = {
  workerId: string;
  timestamp: Date;
  cpuPercent: number;
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  activeJobs: number;
  containerMetrics: unknown | null;
};

const sanitizeNumeric = (value: unknown): string => {
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : "0";
};

export const insertMetricsSnapshot = async (
  input: InsertMetricsSnapshotInput
): Promise<void> => {
  try {
    await db.insert(workerMetricsHistory).values({
      workerId: input.workerId,
      timestamp: input.timestamp,
      cpuPercent: sanitizeNumeric(input.cpuPercent),
      ramPercent: sanitizeNumeric(input.ramPercent),
      ramUsedMb: input.ramUsedMb ?? 0,
      ramTotalMb: input.ramTotalMb ?? 0,
      activeJobs: input.activeJobs ?? 0,
      containerMetrics: input.containerMetrics,
    });
  } catch (error) {
    logger.error({ error, workerId: input.workerId }, "Failed to insert worker metrics snapshot");
  }
};

/**
 * Helper to build a subquery of workerIds visible to an org.
 * Includes workers that have handled jobs for this org AND any
 * currently-online workers (shared runners may not have org jobs yet).
 */
const orgVisibleWorkerIdsSubquery = (orgId: string) => {
  const orgJobWorkerIds = db
    .selectDistinct({ workerId: agentJobs.workerId })
    .from(agentJobs)
    .where(
      and(
        eq(agentJobs.workspaceId, orgId),
        sql`${agentJobs.workerId} IS NOT NULL`
      )
    );

  const onlineWorkerIds = db
    .selectDistinct({ workerId: workerRegistrations.workerId })
    .from(workerRegistrations)
    .where(eq(workerRegistrations.status, "online"));

  return sql`(${orgJobWorkerIds} UNION ${onlineWorkerIds})`;
};

export const getMetricsHistory = async (
  workerId: string,
  from: Date,
  to: Date,
  downsampleInterval?: number,
  orgId?: string
) => {
  // If orgId provided, verify this worker is visible to the org
  // (has handled org jobs OR is currently online)
  if (orgId) {
    const [hasOrgJob] = await db
      .select({ workerId: agentJobs.workerId })
      .from(agentJobs)
      .where(
        and(
          eq(agentJobs.workerId, workerId),
          eq(agentJobs.workspaceId, orgId)
        )
      )
      .limit(1);

    if (!hasOrgJob) {
      // Check if worker is online (shared runner without org jobs yet)
      const [isOnline] = await db
        .select({ workerId: workerRegistrations.workerId })
        .from(workerRegistrations)
        .where(
          and(
            eq(workerRegistrations.workerId, workerId),
            eq(workerRegistrations.status, "online")
          )
        )
        .limit(1);

      if (!isOnline) return [];
    }
  }

  const baseQuery = db
    .select()
    .from(workerMetricsHistory)
    .where(
      and(
        eq(workerMetricsHistory.workerId, workerId),
        gte(workerMetricsHistory.timestamp, from),
        lte(workerMetricsHistory.timestamp, to)
      )
    )
    .orderBy(workerMetricsHistory.timestamp);

  if (!downsampleInterval || downsampleInterval <= 1) {
    return baseQuery;
  }

  // Downsample by taking every Nth row using a window function
  const subquery = db
    .select({
      id: workerMetricsHistory.id,
      workerId: workerMetricsHistory.workerId,
      timestamp: workerMetricsHistory.timestamp,
      cpuPercent: workerMetricsHistory.cpuPercent,
      ramPercent: workerMetricsHistory.ramPercent,
      ramUsedMb: workerMetricsHistory.ramUsedMb,
      ramTotalMb: workerMetricsHistory.ramTotalMb,
      activeJobs: workerMetricsHistory.activeJobs,
      containerMetrics: workerMetricsHistory.containerMetrics,
      createdAt: workerMetricsHistory.createdAt,
      rowNum: sql<number>`ROW_NUMBER() OVER (ORDER BY ${workerMetricsHistory.timestamp})`.as(
        "row_num"
      ),
    })
    .from(workerMetricsHistory)
    .where(
      and(
        eq(workerMetricsHistory.workerId, workerId),
        gte(workerMetricsHistory.timestamp, from),
        lte(workerMetricsHistory.timestamp, to)
      )
    )
    .as("numbered");

  return db
    .select({
      id: subquery.id,
      workerId: subquery.workerId,
      timestamp: subquery.timestamp,
      cpuPercent: subquery.cpuPercent,
      ramPercent: subquery.ramPercent,
      ramUsedMb: subquery.ramUsedMb,
      ramTotalMb: subquery.ramTotalMb,
      activeJobs: subquery.activeJobs,
      containerMetrics: subquery.containerMetrics,
      createdAt: subquery.createdAt,
    })
    .from(subquery)
    .where(sql`${subquery.rowNum} % ${downsampleInterval} = 0`)
    .orderBy(subquery.timestamp);
};

export const getAllWorkersMetricsHistory = async (
  from: Date,
  to: Date,
  downsampleInterval?: number,
  orgId?: string
) => {
  const baseConditions = [
    gte(workerMetricsHistory.timestamp, from),
    lte(workerMetricsHistory.timestamp, to),
  ];

  // Filter to only workers visible to this org (org jobs + online)
  if (orgId) {
    baseConditions.push(
      sql`${workerMetricsHistory.workerId} IN ${orgVisibleWorkerIdsSubquery(orgId)}`
    );
  }

  if (!downsampleInterval || downsampleInterval <= 1) {
    return db
      .select()
      .from(workerMetricsHistory)
      .where(and(...baseConditions))
      .orderBy(workerMetricsHistory.timestamp);
  }

  const subquery = db
    .select({
      id: workerMetricsHistory.id,
      workerId: workerMetricsHistory.workerId,
      timestamp: workerMetricsHistory.timestamp,
      cpuPercent: workerMetricsHistory.cpuPercent,
      ramPercent: workerMetricsHistory.ramPercent,
      ramUsedMb: workerMetricsHistory.ramUsedMb,
      ramTotalMb: workerMetricsHistory.ramTotalMb,
      activeJobs: workerMetricsHistory.activeJobs,
      containerMetrics: workerMetricsHistory.containerMetrics,
      createdAt: workerMetricsHistory.createdAt,
      rowNum: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${workerMetricsHistory.workerId} ORDER BY ${workerMetricsHistory.timestamp})`.as(
        "row_num"
      ),
    })
    .from(workerMetricsHistory)
    .where(and(...baseConditions))
    .as("numbered");

  return db
    .select({
      id: subquery.id,
      workerId: subquery.workerId,
      timestamp: subquery.timestamp,
      cpuPercent: subquery.cpuPercent,
      ramPercent: subquery.ramPercent,
      ramUsedMb: subquery.ramUsedMb,
      ramTotalMb: subquery.ramTotalMb,
      activeJobs: subquery.activeJobs,
      containerMetrics: subquery.containerMetrics,
      createdAt: subquery.createdAt,
    })
    .from(subquery)
    .where(sql`${subquery.rowNum} % ${downsampleInterval} = 0`)
    .orderBy(subquery.timestamp);
};

export const cleanupOldMetrics = async (retentionDays: number): Promise<number> => {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(workerMetricsHistory)
      .where(lt(workerMetricsHistory.timestamp, cutoff))
      .returning({ id: workerMetricsHistory.id });
    return deleted.length;
  } catch (error) {
    logger.error({ error }, "Failed to cleanup old worker metrics");
    return 0;
  }
};
