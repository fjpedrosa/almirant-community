import { db, sql } from "../../client";

// ── Types ──

export interface FeedbackTriageMetrics {
  /** Count of feedback-triage agent jobs grouped by status */
  jobsByStatus: Record<string, number>;
  /** Latency percentiles (ms) for completed feedback-triage jobs */
  latencyPercentiles: { p50: number; p95: number; p99: number };
  /** Distribution of AI confidence scores across triaged feedback items */
  confidenceDistribution: Record<string, number>;
  /** Fraction of triaged items that did NOT require human review (0-1) */
  autoApprovalRate: number;
  /** Fraction of triaged items that created a new cluster vs. assigned to existing (0-1) */
  newClusterRate: number;
  /** Total feedback items processed by the triage pipeline in the period */
  totalTriaged: number;
  /** ISO-8601 date boundaries used for the query */
  period: { from: string; to: string };
}

// ── Repository function ──

/**
 * Compute aggregate metrics for the feedback-triage pipeline.
 *
 * All queries are date-bounded and run in parallel via Promise.all.
 * Raw SQL is used for percentile_cont which is not natively supported by Drizzle ORM.
 */
export const getFeedbackTriageMetrics = async (params: {
  from?: Date;
  to?: Date;
}): Promise<FeedbackTriageMetrics> => {
  const from = params.from ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const to = params.to ?? new Date();

  const [
    jobsByStatusRows,
    latencyRows,
    confidenceRows,
    approvalRows,
    clusterRows,
  ] = await Promise.all([
    // 1. Job counts by status for feedback-triage job type
    db.execute(sql`
      SELECT status, count(*)::int AS count
      FROM agent_jobs
      WHERE job_type = 'feedback-triage'
        AND created_at >= ${from}
        AND created_at <= ${to}
      GROUP BY status
    `),

    // 2. Latency percentiles (created_at -> completed_at) for completed jobs
    db.execute(sql`
      SELECT
        coalesce(percentile_cont(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000), 0) AS p50,
        coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000), 0) AS p95,
        coalesce(percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000), 0) AS p99
      FROM agent_jobs
      WHERE job_type = 'feedback-triage'
        AND status = 'completed'
        AND completed_at IS NOT NULL
        AND created_at >= ${from}
        AND created_at <= ${to}
    `),

    // 3. Confidence distribution bucketed into 5 ranges
    db.execute(sql`
      SELECT
        CASE
          WHEN CAST(ai_confidence AS float) < 0.5 THEN '0-0.5'
          WHEN CAST(ai_confidence AS float) < 0.7 THEN '0.5-0.7'
          WHEN CAST(ai_confidence AS float) < 0.8 THEN '0.7-0.8'
          WHEN CAST(ai_confidence AS float) < 0.9 THEN '0.8-0.9'
          ELSE '0.9-1.0'
        END AS bucket,
        count(*)::int AS count
      FROM feedback_items
      WHERE ai_confidence IS NOT NULL
        AND updated_at >= ${from}
        AND updated_at <= ${to}
      GROUP BY bucket
      ORDER BY bucket
    `),

    // 4. Auto-approval rate: items with cluster_id (triaged) where requires_review = false
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE requires_review = false)::int AS auto_approved,
        count(*)::int AS total
      FROM feedback_items
      WHERE cluster_id IS NOT NULL
        AND updated_at >= ${from}
        AND updated_at <= ${to}
    `),

    // 5. New cluster rate: clusters created in the period vs total items triaged
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM feedback_clusters
         WHERE created_at >= ${from} AND created_at <= ${to}) AS new_clusters,
        (SELECT count(*)::int FROM feedback_items
         WHERE cluster_id IS NOT NULL
           AND updated_at >= ${from}
           AND updated_at <= ${to}) AS total_triaged
    `),
  ]);

  // Parse query 1: jobs by status
  const jobsByStatus: Record<string, number> = {};
  for (const row of jobsByStatusRows as unknown as Array<{ status: string; count: number }>) {
    jobsByStatus[row.status] = Number(row.count);
  }

  // Parse query 2: latency percentiles
  const latencyRow = (latencyRows as unknown as Array<{ p50: string; p95: string; p99: string }>)[0];
  const latencyPercentiles = {
    p50: Math.round(Number(latencyRow?.p50 ?? 0)),
    p95: Math.round(Number(latencyRow?.p95 ?? 0)),
    p99: Math.round(Number(latencyRow?.p99 ?? 0)),
  };

  // Parse query 3: confidence distribution
  const confidenceDistribution: Record<string, number> = {};
  for (const row of confidenceRows as unknown as Array<{ bucket: string; count: number }>) {
    confidenceDistribution[row.bucket] = Number(row.count);
  }

  // Parse query 4: auto-approval rate
  const approvalRow = (approvalRows as unknown as Array<{ auto_approved: number; total: number }>)[0];
  const autoApprovedCount = Number(approvalRow?.auto_approved ?? 0);
  const approvalTotal = Number(approvalRow?.total ?? 0);
  const autoApprovalRate = approvalTotal > 0 ? autoApprovedCount / approvalTotal : 0;

  // Parse query 5: new cluster rate
  const clusterRow = (clusterRows as unknown as Array<{ new_clusters: number; total_triaged: number }>)[0];
  const newClusters = Number(clusterRow?.new_clusters ?? 0);
  const totalTriaged = Number(clusterRow?.total_triaged ?? 0);
  const newClusterRate = totalTriaged > 0 ? newClusters / totalTriaged : 0;

  return {
    jobsByStatus,
    latencyPercentiles,
    confidenceDistribution,
    autoApprovalRate: Math.round(autoApprovalRate * 10000) / 10000, // 4 decimal precision
    newClusterRate: Math.round(newClusterRate * 10000) / 10000,
    totalTriaged,
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  };
};
