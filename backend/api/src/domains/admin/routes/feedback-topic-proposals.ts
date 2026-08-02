import { Elysia, t } from "elysia";
import {
  listProposals,
  getProposalById,
  updateProposalStatus,
  mergeTopics,
  splitTopic,
  updateTopic,
  getTopicById,
} from "@almirant/database";
import type {
  MergePayload,
  SplitPayload,
  RenamePayload,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  internalErrorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../shared/services/response";

const normalizeError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

/**
 * Admin routes for feedback topic proposals (merge/split/rename).
 * Mounted under /api/admin/feedback/feedback-topic-proposals
 */
export const adminFeedbackTopicProposalRoutes = new Elysia({
  prefix: "/feedback-topic-proposals",
})
  // ── LIST proposals ─────────────────────────────────────────────
  //
  // Feedback is mono-project by definition (the Almirant project): the
  // `projectId` query parameter was dropped and is no longer accepted.
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const pagination = parsePaginationParams(query);
        const { items, total } = await listProposals(
          {
            status: query.status,
            type: query.type,
            topicId: query.topicId,
          },
          pagination
        );

        return successResponse(
          items,
          buildPaginationMeta(pagination.page, pagination.limit, total)
        );
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-topic-proposals" }, "Failed to fetch feedback topic proposals");
      }
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        type: t.Optional(t.String()),
        topicId: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // ── GET single proposal ────────────────────────────────────────
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const proposal = await getProposalById(params.id);
        if (!proposal) {
          set.status = 404;
          return notFoundResponse("Feedback topic proposal");
        }
        return successResponse(proposal);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-topic-proposals/:id", proposalId: params.id },
          "Failed to fetch feedback topic proposal",
        );
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // ── ACCEPT proposal ────────────────────────────────────────────
  .post(
    "/:id/accept",
    async (ctx) => {
      const { params, body, set } = ctx;
      try {
        const proposal = await getProposalById(params.id);
        if (!proposal) {
          set.status = 404;
          return notFoundResponse("Feedback topic proposal");
        }

        if (proposal.status !== "pending") {
          set.status = 409;
          return errorResponse(
            `Proposal has already been ${proposal.status}`,
            409
          );
        }

        // Verify the topic still exists
        const topic = await getTopicById(proposal.topicId);
        if (!topic) {
          await updateProposalStatus(params.id, "failed", reviewerName(ctx), body.notes);
          set.status = 422;
          return errorResponse("Referenced topic no longer exists", 422);
        }

        const reviewer = reviewerName(ctx);

        // Execute the operation based on proposal type
        try {
          switch (proposal.type) {
            case "merge": {
              const payload = proposal.payload as MergePayload;
              const targetTopic = await getTopicById(payload.targetTopicId);
              if (!targetTopic) {
                await updateProposalStatus(params.id, "failed", reviewer, "Target topic not found");
                set.status = 422;
                return errorResponse("Target topic for merge no longer exists", 422);
              }
              await mergeTopics(proposal.topicId, payload.targetTopicId, {
                mergedBy: reviewer ?? "admin",
              });
              break;
            }
            case "split": {
              const payload = proposal.payload as SplitPayload;
              await splitTopic(proposal.topicId, payload.subtopics);
              break;
            }
            case "rename": {
              const payload = proposal.payload as RenamePayload;
              await updateTopic(proposal.topicId, {
                title: payload.newTitle,
              });
              break;
            }
            default: {
              await updateProposalStatus(params.id, "failed", reviewer, `Unknown proposal type: ${proposal.type}`);
              set.status = 422;
              return errorResponse(`Unknown proposal type: ${proposal.type}`, 422);
            }
          }
        } catch (opError) {
          // Operation failed -- mark proposal as failed
          await updateProposalStatus(
            params.id,
            "failed",
            reviewer,
            normalizeError(opError)
          );
          set.status = 500;
          return internalErrorResponse(
            opError,
            { route: "/feedback-topic-proposals/:id/accept", proposalType: proposal.type },
            `Failed to execute ${proposal.type}`,
          );
        }

        // Mark as accepted
        const updated = await updateProposalStatus(
          params.id,
          "accepted",
          reviewer,
          body.notes
        );

        return successResponse(updated);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-topic-proposals/:id/accept", proposalId: params.id },
          "Failed to accept feedback topic proposal",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        notes: t.Optional(t.String()),
      }),
    }
  )

  // ── REJECT proposal ────────────────────────────────────────────
  .post(
    "/:id/reject",
    async (ctx) => {
      const { params, body, set } = ctx;
      try {
        const proposal = await getProposalById(params.id);
        if (!proposal) {
          set.status = 404;
          return notFoundResponse("Feedback topic proposal");
        }

        if (proposal.status !== "pending") {
          set.status = 409;
          return errorResponse(
            `Proposal has already been ${proposal.status}`,
            409
          );
        }

        const updated = await updateProposalStatus(
          params.id,
          "rejected",
          reviewerName(ctx),
          body.notes
        );

        return successResponse(updated);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-topic-proposals/:id/reject", proposalId: params.id },
          "Failed to reject feedback topic proposal",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        notes: t.Optional(t.String()),
      }),
    }
  );

// ── Helper ───────────────────────────────────────────────────────

/**
 * Extract a human-readable reviewer identifier from the Elysia context.
 * Falls back to "admin" when the user object is not available.
 */
function reviewerName(ctx: unknown): string {
  const user = (ctx as { user?: { id?: string; name?: string } }).user;
  return user?.name ?? user?.id ?? "admin";
}
