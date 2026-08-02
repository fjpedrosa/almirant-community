import { Elysia, t } from "elysia";
import {
  getBugFixAttempts,
  getBugFixAttemptById,
  markAttemptAsFailed,
  listBugFixAttemptsWithPrByCluster,
  type BugFixAttemptWithPr,
} from "@almirant/database";
import {
  successResponse,
  internalErrorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../shared/services/response";

/**
 * Admin bug-fix-attempts routes — mounted at /api/admin/bug-fix-attempts.
 *
 * Ported from the enterprise build (`domains/admin/routes/bug-fix-attempts.ts`),
 * adapted to the cloud `bug-fix-attempt-repository`. The only behavioural
 * divergence from the enterprise port is `GET /cluster/:clusterId`: cloud
 * enriches each attempt with the locally-synced PR state
 * (`listBugFixAttemptsWithPrByCluster`) and projects it to the exact
 * `BugFixAttemptSummary` wire shape the feedback-triage cluster-detail modal
 * expects (frontend `getBugFixAttemptsByCluster`). The list/detail/mark-failed
 * endpoints match the enterprise contract 1:1.
 */

interface BugFixAttemptPrSummaryDto {
  state: string;
  reviewStatus: string;
  ciStatus: string;
  mergedAt: string | null;
  closedAt: string | null;
}

interface BugFixAttemptSummaryDto {
  id: string;
  status: string;
  attemptNumber: number;
  rootCause: string | null;
  solutionProposed: string | null;
  fixPrUrl: string | null;
  fixPrNumber: number | null;
  createdAt: string;
  pr: BugFixAttemptPrSummaryDto | null;
  agentJobId: string | null;
}

const toBugFixAttemptSummary = (
  attempt: BugFixAttemptWithPr
): BugFixAttemptSummaryDto => ({
  id: attempt.id,
  status: attempt.status,
  attemptNumber: attempt.attemptNumber,
  rootCause: attempt.rootCause ?? null,
  solutionProposed: attempt.solutionProposed ?? null,
  fixPrUrl: attempt.fixPrUrl ?? null,
  fixPrNumber: attempt.fixPrNumber ?? null,
  createdAt: attempt.createdAt.toISOString(),
  agentJobId: attempt.agentJobId ?? null,
  pr: attempt.pr
    ? {
        state: attempt.pr.state,
        reviewStatus: attempt.pr.reviewStatus,
        ciStatus: attempt.pr.ciStatus,
        mergedAt: attempt.pr.mergedAt ? attempt.pr.mergedAt.toISOString() : null,
        closedAt: attempt.pr.closedAt ? attempt.pr.closedAt.toISOString() : null,
      }
    : null,
});

export const adminBugFixAttemptsRoutes = new Elysia({
  prefix: "/bug-fix-attempts",
})

  // -------------------------------------------------------
  // GET /bug-fix-attempts — List with filters and pagination
  // -------------------------------------------------------
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const pagination = parsePaginationParams(query);
        const filters = {
          projectId: query.projectId,
          status: query.status || undefined,
          clusterId: query.clusterId || undefined,
          feedbackItemId: query.feedbackItemId || undefined,
        };
        const { items, total } = await getBugFixAttempts(filters, pagination);
        const meta = buildPaginationMeta(
          pagination.page,
          pagination.limit,
          total
        );
        return successResponse(items, meta);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/bug-fix-attempts" }, "Failed to fetch bug fix attempts");
      }
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
        status: t.Optional(t.String()),
        clusterId: t.Optional(t.String()),
        feedbackItemId: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /bug-fix-attempts/cluster/:clusterId — All attempts for a cluster,
  // enriched with live PR state and projected to the frontend
  // `BugFixAttemptSummary` shape. Fired by the cluster-detail modal on open.
  // -------------------------------------------------------
  .get(
    "/cluster/:clusterId",
    async ({ params, set }) => {
      try {
        const attempts = await listBugFixAttemptsWithPrByCluster(
          params.clusterId
        );
        return successResponse(attempts.map(toBugFixAttemptSummary));
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/bug-fix-attempts/cluster/:clusterId", clusterId: params.clusterId },
          "Failed to fetch bug fix attempts for cluster",
        );
      }
    },
    {
      params: t.Object({
        clusterId: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /bug-fix-attempts/:id — Get detail by ID
  // -------------------------------------------------------
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const attempt = await getBugFixAttemptById(params.id);
        if (!attempt) {
          set.status = 404;
          return notFoundResponse("Bug fix attempt");
        }
        return successResponse(attempt);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/bug-fix-attempts/:id", attemptId: params.id },
          "Failed to fetch bug fix attempt",
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /bug-fix-attempts/:id/mark-failed — Mark as failed
  // -------------------------------------------------------
  .post(
    "/:id/mark-failed",
    async ({ params, body, set }) => {
      try {
        const updated = await markAttemptAsFailed(params.id, body.reason, "admin");
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Bug fix attempt");
        }
        return successResponse(updated);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/bug-fix-attempts/:id/mark-failed", attemptId: params.id },
          "Failed to mark bug fix attempt as failed",
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        reason: t.String(),
      }),
    }
  );
