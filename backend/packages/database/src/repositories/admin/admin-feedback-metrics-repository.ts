import { db } from "../../client";
import { feedbackItems } from "../../schema/feedback-items";
import { feedbackClusters } from "../../schema/feedback-clusters";
import { feedbackTopics } from "../../schema/feedback-topics";
import { bugFixAttempts } from "../../schema/bug-fix-attempts";
import { sql, count, and, or, eq, gte, isNotNull } from "drizzle-orm";

/**
 * Aggregated KPI metrics for the admin feedback pipeline dashboard.
 */
export interface AdminFeedbackMetrics {
  /** Feedback items requiring human review or in early-stage statuses */
  inboxSize: number;
  /** Items triaged today (or within the provided date range) */
  itemsTriagedToday: number;
  /** Ratio of auto-assigned items (requires_review=false with cluster) over last 7 days */
  autoAssignmentRate: number;
  /** Average seconds from creation to triage over the last 7 days */
  avgTriageTime: number;
  /** Clusters promoted today (or within the provided date range) */
  itemsPromotedToday: number;
  /** Bug fix attempts currently being analyzed or implemented */
  bugFixesInProgress: number;
  /** Active feedback topics */
  topicsCount: number;
  /** Open feedback clusters */
  clustersOpen: number;
}

export interface AdminFeedbackMetricsParams {
  from?: Date;
  to?: Date;
}

/**
 * Executes 8 aggregate queries in parallel and returns all feedback
 * pipeline KPIs in a single round-trip.
 */
export const getAdminFeedbackMetrics = async (
  params?: AdminFeedbackMetricsParams,
): Promise<AdminFeedbackMetrics> => {
  const today = params?.from
    ? sql`${params.from}::date`
    : sql`date_trunc('day', now())`;

  const endOfDay = params?.to
    ? sql`(${params.to}::date + interval '1 day')`
    : sql`(date_trunc('day', now()) + interval '1 day')`;

  const sevenDaysAgo = sql`now() - interval '7 days'`;

  const [
    [inboxSizeResult],
    [itemsTriagedTodayResult],
    [autoAssignmentResult],
    [avgTriageTimeResult],
    [itemsPromotedTodayResult],
    [bugFixesInProgressResult],
    [topicsCountResult],
    [clustersOpenResult],
  ] = await Promise.all([
    // 1. inboxSize: requires_review=true OR status IN ('new','triaged')
    db
      .select({ value: count() })
      .from(feedbackItems)
      .where(
        or(
          eq(feedbackItems.requiresReview, true),
          sql`${feedbackItems.status} IN ('new', 'triaged')`,
        ),
      ),

    // 2. itemsTriagedToday: status='triaged' AND updated_at within today
    db
      .select({ value: count() })
      .from(feedbackItems)
      .where(
        and(
          eq(feedbackItems.status, "triaged"),
          gte(feedbackItems.updatedAt, today),
          sql`${feedbackItems.updatedAt} < ${endOfDay}`,
        ),
      ),

    // 3. autoAssignmentRate: ratio of (requires_review=false AND cluster_id IS NOT NULL)
    //    over total items with cluster_id assigned, last 7 days
    db
      .select({
        autoAssigned: sql<number>`count(*) filter (where ${feedbackItems.requiresReview} = false)`,
        total: sql<number>`count(*)`,
      })
      .from(feedbackItems)
      .where(
        and(
          isNotNull(feedbackItems.clusterId),
          gte(feedbackItems.createdAt, sevenDaysAgo),
        ),
      ),

    // 4. avgTriageTime: average seconds from created_at to updated_at
    //    for triaged items created in the last 7 days
    db
      .select({
        value: sql<number>`coalesce(avg(extract(epoch from ${feedbackItems.updatedAt} - ${feedbackItems.createdAt})), 0)`,
      })
      .from(feedbackItems)
      .where(
        and(
          eq(feedbackItems.status, "triaged"),
          gte(feedbackItems.createdAt, sevenDaysAgo),
        ),
      ),

    // 5. itemsPromotedToday: clusters with status='promoted' created today
    db
      .select({ value: count() })
      .from(feedbackClusters)
      .where(
        and(
          eq(feedbackClusters.status, "promoted"),
          gte(feedbackClusters.createdAt, today),
          sql`${feedbackClusters.createdAt} < ${endOfDay}`,
        ),
      ),

    // 6. bugFixesInProgress: status IN ('analyzing','implementing')
    db
      .select({ value: count() })
      .from(bugFixAttempts)
      .where(
        sql`${bugFixAttempts.status} IN ('analyzing', 'implementing')`,
      ),

    // 7. topicsCount: active topics
    db
      .select({ value: count() })
      .from(feedbackTopics)
      .where(eq(feedbackTopics.status, "active")),

    // 8. clustersOpen: open clusters
    db
      .select({ value: count() })
      .from(feedbackClusters)
      .where(eq(feedbackClusters.status, "open")),
  ]);

  const autoTotal = Number(autoAssignmentResult?.total ?? 0);
  const autoAssigned = Number(autoAssignmentResult?.autoAssigned ?? 0);

  return {
    inboxSize: inboxSizeResult?.value ?? 0,
    itemsTriagedToday: itemsTriagedTodayResult?.value ?? 0,
    autoAssignmentRate: autoTotal > 0 ? autoAssigned / autoTotal : 0,
    avgTriageTime: Number(avgTriageTimeResult?.value ?? 0),
    itemsPromotedToday: itemsPromotedTodayResult?.value ?? 0,
    bugFixesInProgress: bugFixesInProgressResult?.value ?? 0,
    topicsCount: topicsCountResult?.value ?? 0,
    clustersOpen: clustersOpenResult?.value ?? 0,
  };
};
