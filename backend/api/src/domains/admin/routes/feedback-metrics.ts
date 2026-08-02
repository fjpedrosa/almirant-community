import { Elysia, t } from "elysia";
import { getAdminFeedbackMetrics } from "@almirant/database";
import {
  successResponse,
  errorResponse,
  internalErrorResponse,
} from "../../../shared/services/response";

/**
 * Admin routes for feedback pipeline KPI metrics.
 *
 * Mounted at: /api/admin/feedback/metrics
 *
 * Returns 8 documented metrics:
 *   1. inboxSize              - Feedback items requiring review or in early-stage statuses
 *   2. itemsTriagedToday      - Items triaged within the provided date range (or today)
 *   3. autoAssignmentRate     - Ratio of auto-assigned items over the last 7 days
 *   4. avgTriageTime          - Average seconds from creation to triage (last 7 days)
 *   5. itemsPromotedToday     - Clusters promoted within the provided date range (or today)
 *   6. bugFixesInProgress     - Bug fix attempts currently being analyzed or implemented
 *   7. topicsCount            - Active feedback topics
 *   8. clustersOpen           - Open feedback clusters
 */
export const adminFeedbackMetricsRoutes = new Elysia({
  prefix: "/feedback",
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

      const metrics = await getAdminFeedbackMetrics({ from, to });
      return successResponse(metrics);
    } catch (error) {
      set.status = 500;
      return internalErrorResponse(error, { route: "/feedback/metrics" }, "Failed to get feedback metrics");
    }
  },
  {
    query: t.Object({
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
    }),
  },
);
