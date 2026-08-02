import { Elysia, t } from "elysia";
import { getFeedbackTriageMetrics } from "@almirant/database";
import {
  successResponse,
  errorResponse,
  internalErrorResponse,
} from "../../../shared/services/response";

/**
 * Admin routes for feedback triage pipeline metrics.
 *
 * Mounted at: /api/admin/feedback-triage/metrics
 *
 * Returns 5 documented metrics:
 *   1. jobsByStatus          – Agent job counts by status for feedback-triage jobs
 *   2. latencyPercentiles    – p50/p95/p99 latency (ms) of completed triage jobs
 *   3. confidenceDistribution – AI confidence score distribution across buckets
 *   4. autoApprovalRate      – Fraction of triaged items auto-approved (no human review)
 *   5. newClusterRate        – Fraction of triaged items that created a new cluster
 */
export const adminFeedbackTriageMetricsRoutes = new Elysia({
  prefix: "/feedback-triage",
}).get(
  "/metrics",
  async ({ query, set }) => {
    try {
      const from = query.from ? new Date(query.from) : undefined;
      const to = query.to ? new Date(query.to) : undefined;

      // Validate date params if provided
      if (from && isNaN(from.getTime())) {
        set.status = 400;
        return errorResponse("Invalid 'from' date format. Use ISO-8601 (e.g. 2026-04-01).", 400);
      }
      if (to && isNaN(to.getTime())) {
        set.status = 400;
        return errorResponse("Invalid 'to' date format. Use ISO-8601 (e.g. 2026-04-15).", 400);
      }

      const metrics = await getFeedbackTriageMetrics({ from, to });
      return successResponse(metrics);
    } catch (error) {
      set.status = 500;
      return internalErrorResponse(error, { route: "/feedback-triage/metrics" }, "Failed to get triage metrics");
    }
  },
  {
    query: t.Object({
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
    }),
  },
);
