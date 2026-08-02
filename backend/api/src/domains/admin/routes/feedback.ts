import { Elysia, t } from "elysia";
import {
  getAdminFeedbackItems,
  getAdminFeedbackSources,
  getAdminFeedbackClusters,
  getAdminFeedbackStats,
  getFeedbackItemById,
  getFeedbackItemsByIds,
  updateFeedbackItem,
  deleteFeedbackItem,
  createFeedbackSource,
  getFeedbackSourceById,
  updateFeedbackSource,
  deleteFeedbackSource,
  rotateFeedbackSourcePublicKey,
  getFeedbackClusterDetail,
  updateFeedbackCluster,
  deleteFeedbackCluster,
  getFeedbackPromotions,
  getFeedbackTraceability,
  getEntityComments,
  getEntityCommentVersions,
  createEntityComment,
  updateEntityComment,
  deleteEntityComment,
  parseMentionsFromHtml,
  enqueueNotification,
  feedbackClusterStatusEnum,
  dismissClusterWithReason,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  internalErrorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../shared/services/response";
import { adminFeedbackTopicProposalRoutes } from "./feedback-topic-proposals";
import {
  enqueueFeedbackTriageJob,
  enqueueFeedbackTriageBatchJob,
} from "../../feedback/services/feedback-triage-enqueue";
import { sendMentionNotification } from "../../../shared/services/notification-service";
import {
  broadcastFeedbackCommentCreated,
  broadcastFeedbackCommentDeleted,
  broadcastFeedbackCommentUpdated,
  broadcastFeedbackItemDeleted,
  broadcastFeedbackItemUpdated,
} from "../../../shared/ws/feedback-events";
import { abortClusterInvestigation } from "../services/abort-cluster-investigation";
import { launchClusterInvestigationForUser } from "../services/launch-cluster-investigation";

const mergeFeedbackSourceConfig = (
  existingConfig: Record<string, unknown> | null | undefined,
  nextConfig: Record<string, unknown> | null | undefined,
  workspaceId: string
): Record<string, unknown> => ({
  ...(existingConfig ?? {}),
  ...(nextConfig ?? {}),
  workspaceId,
});

// =============================================
// Admin Feedback Items
// =============================================

const adminFeedbackItemsRoutes = new Elysia({ prefix: "/feedback-items" })

  // GET /feedback-items?status=...&category=...&sourceId=...&clusterId=...&search=...&sentiment=...
  //
  // Feedback is mono-project by definition (the Almirant project), so the
  // `projectId` query parameter was dropped. Legacy callers that still send
  // it simply have it ignored.
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const pagination = parsePaginationParams(query);
        const { items, total } = await getAdminFeedbackItems(
          {
            status: query.status,
            category: query.category,
            sourceId: query.sourceId,
            clusterId: query.clusterId,
            search: query.search,
            sentiment: query.sentiment,
          },
          pagination
        );
        return successResponse(items, buildPaginationMeta(pagination.page, pagination.limit, total));
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-items" }, "Failed to fetch feedback items");
      }
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        category: t.Optional(t.String()),
        sourceId: t.Optional(t.String()),
        clusterId: t.Optional(t.String()),
        search: t.Optional(t.String()),
        sentiment: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // GET /feedback-items/:id
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const item = await getFeedbackItemById(params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }
        return successResponse(item);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-items/:id", feedbackItemId: params.id },
          "Failed to fetch feedback item",
        );
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // PATCH /feedback-items/:id
  .patch(
    "/:id",
    async (ctx) => {
      const { params, body, set } = ctx;
      try {
        const updated = await updateFeedbackItem(params.id, {
          ...body,
          status: body.status as "new" | "triaged" | "in_progress" | "pending_validation" | "implementing" | "deployed" | "verified" | "cancelled" | undefined,
          category: body.category as "bug" | "feature_request" | "improvement" | "question" | "praise" | "other" | undefined,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }
        const workspaceId = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace?.id;
        broadcastFeedbackItemUpdated({
          item: updated,
          workspaceId,
          changes: body,
        });
        return successResponse(updated);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-items/:id", feedbackItemId: params.id },
          "Failed to update feedback item",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        status: t.Optional(t.String()),
        category: t.Optional(t.String()),
        title: t.Optional(t.String()),
        content: t.Optional(t.String()),
        clusterId: t.Optional(t.String()),
        sentiment: t.Optional(t.String()),
        metadata: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )

  // DELETE /feedback-items/:id
  .delete(
    "/:id",
    async (ctx) => {
      const { params, set } = ctx;
      try {
        const deleted = await deleteFeedbackItem(params.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }
        const workspaceId = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace?.id;
        broadcastFeedbackItemDeleted({
          feedbackItemId: params.id,
          workspaceId,
        });
        return successResponse({ deleted: true });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-items/:id", feedbackItemId: params.id },
          "Failed to delete feedback item",
        );
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // GET /feedback-items/:id/traceability
  .get(
    "/:id/traceability",
    async ({ params, set }) => {
      try {
        const result = await getFeedbackTraceability(params.id);
        if (!result) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }
        return successResponse(result);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-items/:id/traceability", feedbackItemId: params.id },
          "Failed to fetch traceability",
        );
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /feedback-items/:id/triage — manually (re-)enqueue a feedback-triage
  // agent job for this item. Idempotent: if an active job already exists, the
  // response reports `alreadyActive` so the UI can surface that feedback.
  .post(
    "/:id/triage",
    async (ctx) => {
      const { params, set } = ctx;
      try {
        const item = await getFeedbackItemById(params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }
        const sessionWorkspaceId = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace?.id;
        const metadataWorkspaceId = (
          item.metadata as Record<string, unknown> | null
        )?.workspaceId as string | undefined;
        const workspaceId = metadataWorkspaceId ?? sessionWorkspaceId;
        if (!workspaceId) {
          set.status = 400;
          return errorResponse(
            "Feedback item has no workspace context and no active workspace in session",
            400
          );
        }
        const result = await enqueueFeedbackTriageJob({
          feedbackItemId: params.id,
          workspaceId,
        });
        if (result.status === "error") {
          set.status = 500;
          return internalErrorResponse(
            result.error,
            { route: "/feedback-items/:id/triage" },
            "Failed to enqueue triage job",
          );
        }
        return successResponse({
          enqueued: result.status === "enqueued",
          alreadyActive: result.status === "already_active",
          jobId: result.status === "enqueued" ? result.jobId : null,
        });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-items/:id/triage", feedbackItemId: params.id },
          "Failed to enqueue triage job",
        );
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /feedback-items/batch-triage — enqueue a single feedback-triage-batch
  // job that groups N feedback items together, so the triage skill can compute
  // embeddings + cluster assignments in one shot instead of one job per item.
  //
  // Contract:
  //   body: { feedbackItemIds: string[] }  (min 2, max 20 uuids)
  //   400 if any id is missing in the DB (`items_not_found`)
  //   400 if any item is not in status="new" (`invalid_status`)
  //   400 if items span multiple metadata.workspaceId values
  //         (`mixed_organizations`)
  //   400 if there is no workspace context at all
  //
  // Idempotency is delegated to enqueueFeedbackTriageBatchJob, which returns
  // `already_active` + the overlapping jobId when any of the ids is still
  // being processed by another active batch job.
  .post(
    "/batch-triage",
    async (ctx) => {
      const { body, set } = ctx;
      try {
        const items = await getFeedbackItemsByIds(body.feedbackItemIds);

        const notFoundIds = body.feedbackItemIds.filter(
          (id) => !items.some((i) => i.id === id)
        );
        if (notFoundIds.length > 0) {
          set.status = 400;
          return {
            success: false as const,
            error: "items_not_found",
            notFoundIds,
            meta: { timestamp: new Date().toISOString() },
          };
        }

        const invalidStatus = items
          .filter((i) => i.status !== "new")
          .map((i) => ({ id: i.id, status: i.status }));
        if (invalidStatus.length > 0) {
          set.status = 400;
          return {
            success: false as const,
            error: "invalid_status",
            invalidIds: invalidStatus,
            meta: { timestamp: new Date().toISOString() },
          };
        }

        const metaWorkspaces = items
          .map(
            (i) =>
              ((i.metadata as Record<string, unknown> | null)?.workspaceId as
                | string
                | undefined) ?? null
          )
          .filter((x): x is string => Boolean(x));
        const distinctWorkspaces = Array.from(new Set(metaWorkspaces));
        if (distinctWorkspaces.length > 1) {
          set.status = 400;
          return {
            success: false as const,
            error: "mixed_organizations",
            workspaceIds: distinctWorkspaces,
            meta: { timestamp: new Date().toISOString() },
          };
        }

        const sessionWorkspaceId = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace?.id;
        const workspaceId = distinctWorkspaces[0] ?? sessionWorkspaceId;
        if (!workspaceId) {
          set.status = 400;
          return errorResponse(
            "Feedback items have no workspace context and no active workspace in session",
            400
          );
        }

        const result = await enqueueFeedbackTriageBatchJob({
          feedbackItemIds: body.feedbackItemIds,
          workspaceId,
        });

        if (result.status === "enqueued") {
          return successResponse({
            enqueued: true,
            jobId: result.jobId,
            itemCount: body.feedbackItemIds.length,
          });
        }
        if (result.status === "already_active") {
          return successResponse({
            enqueued: false,
            alreadyActiveJobId: result.alreadyActiveJobId,
            itemCount: body.feedbackItemIds.length,
          });
        }
        // result.status === "error"
        set.status = 500;
        return internalErrorResponse(
          result.error,
          { route: "/feedback-items/batch-triage" },
          "Failed to enqueue batch triage job",
        );
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-items/batch-triage" },
          "Failed to enqueue batch triage job",
        );
      }
    },
    {
      body: t.Object({
        feedbackItemIds: t.Array(t.String({ format: "uuid" }), {
          minItems: 2,
          maxItems: 20,
        }),
      }),
    }
  )

  // ── Comments ──────────────────────────────────────────────────────────────

  // GET /feedback-items/:id/comments
  .get(
    "/:id/comments",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const item = await getFeedbackItemById(params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }
        const comments = await getEntityComments("feedback_item", params.id);
        return successResponse(comments);
      } catch (error) {
        if (error instanceof Error && error.message === "COMMENT_NOT_OWNED") {
          ctx.set.status = 403;
          return errorResponse("You can only edit or delete your own comments", 403);
        }
        ctx.set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-items/:id/comments" }, "Failed to fetch comments");
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // GET /feedback-items/:id/comments/:commentId/history
  .get(
    "/:id/comments/:commentId/history",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const item = await getFeedbackItemById(params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }
        const comments = await getEntityComments("feedback_item", params.id);
        const commentExists = comments.some((c) => c.id === params.commentId);
        if (!commentExists) {
          set.status = 404;
          return notFoundResponse("Comment");
        }
        const versions = await getEntityCommentVersions(
          "feedback_item",
          params.id,
          params.commentId
        );
        return successResponse(versions);
      } catch (error) {
        if (error instanceof Error && error.message === "COMMENT_NOT_OWNED") {
          ctx.set.status = 403;
          return errorResponse("You can only edit or delete your own comments", 403);
        }
        ctx.set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-items/:id/comments/:commentId/history" },
          "Failed to fetch comment history",
        );
      }
    },
    { params: t.Object({ id: t.String(), commentId: t.String() }) }
  )

  // POST /feedback-items/:id/comments
  .post(
    "/:id/comments",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const currentUser = (ctx as { user?: { id?: string; name?: string } }).user;
        if (!currentUser?.id) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }
        const activeWorkspace = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace;
        const workspaceId = activeWorkspace?.id;
        if (!workspaceId) {
          set.status = 403;
          return errorResponse("No active workspace in session", 403);
        }

        const item = await getFeedbackItemById(params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }

        const content = body.content?.trim();
        if (!content) {
          set.status = 400;
          return errorResponse("Comment content is required", 400);
        }

        const comment = await createEntityComment(
          "feedback_item",
          params.id,
          currentUser.id,
          content
        );
        broadcastFeedbackCommentCreated({
          feedbackItemId: params.id,
          commentId: comment.id,
          workspaceId,
        });

        const mentionedUserIds = parseMentionsFromHtml(comment.content);
        for (const mentionedUserId of mentionedUserIds) {
          void sendMentionNotification({
            mentionedUserId,
            actorUserId: currentUser.id,
            workspaceId,
            entityType: "feedback_item",
            entityId: params.id,
            entityTitle: item.title,
            link: "/backoffice/feedback",
          }).catch(() => {});

          if (mentionedUserId === currentUser.id) continue;
          void enqueueNotification(
            workspaceId,
            mentionedUserId,
            "mention",
            `mention:feedback:${params.id}:${mentionedUserId}`,
            {
              feedbackItemId: params.id,
              feedbackItemTitle: item.title,
              commentContent: content,
              mentionerName: currentUser.name ?? "Someone",
              mentionerId: currentUser.id,
              itemLink: "/backoffice/feedback",
            },
            1
          ).catch(() => {});
        }

        set.status = 201;
        return successResponse(comment);
      } catch (error) {
        if (error instanceof Error && error.message === "COMMENT_NOT_OWNED") {
          ctx.set.status = 403;
          return errorResponse("You can only edit or delete your own comments", 403);
        }
        ctx.set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-items/:id/comments" }, "Failed to create comment");
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ content: t.String({ minLength: 1 }) }),
    }
  )

  // PATCH /feedback-items/:id/comments/:commentId
  .patch(
    "/:id/comments/:commentId",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const currentUser = (ctx as { user?: { id?: string; name?: string } }).user;
        if (!currentUser?.id) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }
        const activeWorkspace = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace;
        const workspaceId = activeWorkspace?.id;
        if (!workspaceId) {
          set.status = 403;
          return errorResponse("No active workspace in session", 403);
        }

        const item = await getFeedbackItemById(params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }

        const content = body.content?.trim();
        if (!content) {
          set.status = 400;
          return errorResponse("Comment content is required", 400);
        }

        const previousComments = await getEntityComments("feedback_item", params.id);
        const previousComment = previousComments.find((c) => c.id === params.commentId);
        const previousMentionIds = parseMentionsFromHtml(previousComment?.content ?? "");

        const comment = await updateEntityComment(
          "feedback_item",
          params.id,
          params.commentId,
          currentUser.id,
          content
        );
        if (!comment) {
          set.status = 404;
          return notFoundResponse("Comment");
        }
        broadcastFeedbackCommentUpdated({
          feedbackItemId: params.id,
          commentId: comment.id,
          workspaceId,
        });

        const previousSet = new Set(previousMentionIds);
        const newMentions = parseMentionsFromHtml(comment.content).filter(
          (id) => !previousSet.has(id)
        );
        for (const mentionedUserId of newMentions) {
          void sendMentionNotification({
            mentionedUserId,
            actorUserId: currentUser.id,
            workspaceId,
            entityType: "feedback_item",
            entityId: params.id,
            entityTitle: item.title,
            link: "/backoffice/feedback",
          }).catch(() => {});

          if (mentionedUserId === currentUser.id) continue;
          void enqueueNotification(
            workspaceId,
            mentionedUserId,
            "mention",
            `mention:feedback:${params.id}:${mentionedUserId}`,
            {
              feedbackItemId: params.id,
              feedbackItemTitle: item.title,
              commentContent: content,
              mentionerName: currentUser.name ?? "Someone",
              mentionerId: currentUser.id,
              itemLink: "/backoffice/feedback",
            },
            1
          ).catch(() => {});
        }

        return successResponse(comment);
      } catch (error) {
        if (error instanceof Error && error.message === "COMMENT_NOT_OWNED") {
          ctx.set.status = 403;
          return errorResponse("You can only edit or delete your own comments", 403);
        }
        ctx.set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-items/:id/comments/:commentId" }, "Failed to update comment");
      }
    },
    {
      params: t.Object({ id: t.String(), commentId: t.String() }),
      body: t.Object({ content: t.String({ minLength: 1 }) }),
    }
  )

  // DELETE /feedback-items/:id/comments/:commentId
  .delete(
    "/:id/comments/:commentId",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const currentUser = (ctx as { user?: { id?: string } }).user;
        if (!currentUser?.id) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }

        const item = await getFeedbackItemById(params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }

        const deleted = await deleteEntityComment(
          "feedback_item",
          params.id,
          params.commentId,
          currentUser.id
        );
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Comment");
        }
        const workspaceId = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace?.id;
        broadcastFeedbackCommentDeleted({
          feedbackItemId: params.id,
          commentId: params.commentId,
          workspaceId,
        });
        return successResponse({ deleted: true });
      } catch (error) {
        if (error instanceof Error && error.message === "COMMENT_NOT_OWNED") {
          ctx.set.status = 403;
          return errorResponse("You can only edit or delete your own comments", 403);
        }
        ctx.set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-items/:id/comments/:commentId" }, "Failed to delete comment");
      }
    },
    { params: t.Object({ id: t.String(), commentId: t.String() }) }
  );

// =============================================
// Admin Feedback Sources
// =============================================

const adminFeedbackSourcesRoutes = new Elysia({ prefix: "/feedback-sources" })

  // POST /feedback-sources
  .post(
    "/",
    async (ctx) => {
      const { body, set } = ctx;
      try {
        const activeWorkspace = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace;
        const workspaceId = activeWorkspace?.id;
        if (!workspaceId) {
          set.status = 403;
          return errorResponse("No active workspace in session", 403);
        }

        const created = await createFeedbackSource({
          name: body.name.trim(),
          type: body.type as "widget" | "api" | "telegram" | "email" | "manual",
          allowedDomains: body.allowedDomains,
          isActive: body.isActive,
          config: mergeFeedbackSourceConfig(undefined, body.config, workspaceId),
        });

        set.status = 201;
        return successResponse(created);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-sources" }, "Failed to create feedback source");
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        type: t.String(),
        allowedDomains: t.Optional(t.Array(t.String())),
        isActive: t.Optional(t.Boolean()),
        config: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )

  // GET /feedback-sources?projectId=...
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const pagination = parsePaginationParams(query);
        const { sources, total } = await getAdminFeedbackSources(pagination);
        return successResponse(sources, buildPaginationMeta(pagination.page, pagination.limit, total));
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-sources" }, "Failed to fetch feedback sources");
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // GET /feedback-sources/:id
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const source = await getFeedbackSourceById(params.id);
        if (!source) {
          set.status = 404;
          return notFoundResponse("Feedback source");
        }
        return successResponse(source);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-sources/:id", feedbackSourceId: params.id },
          "Failed to fetch feedback source",
        );
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /feedback-sources/:id/rotate-key
  .post(
    "/:id/rotate-key",
    async ({ params, set }) => {
      try {
        const updated = await rotateFeedbackSourcePublicKey(params.id);
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Feedback source");
        }
        return successResponse(updated);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-sources/:id/rotate-key", feedbackSourceId: params.id },
          "Failed to rotate key",
        );
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // PATCH /feedback-sources/:id
  .patch(
    "/:id",
    async (ctx) => {
      const { params, body, set } = ctx;
      try {
        const activeWorkspace = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace;
        const workspaceId = activeWorkspace?.id;
        if (!workspaceId) {
          set.status = 403;
          return errorResponse("No active workspace in session", 403);
        }

        const existing = await getFeedbackSourceById(params.id);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Feedback source");
        }

        const updated = await updateFeedbackSource(params.id, {
          ...body,
          config: mergeFeedbackSourceConfig(
            existing.config as Record<string, unknown> | null | undefined,
            body.config,
            workspaceId
          ),
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Feedback source");
        }

        return successResponse(updated);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-sources/:id", feedbackSourceId: params.id },
          "Failed to update feedback source",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String()),
        allowedDomains: t.Optional(t.Array(t.String())),
        isActive: t.Optional(t.Boolean()),
        config: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )

  // DELETE /feedback-sources/:id
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deleted = await deleteFeedbackSource(params.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Feedback source");
        }
        return successResponse({ deleted: true });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-sources/:id", feedbackSourceId: params.id },
          "Failed to delete feedback source",
        );
      }
    },
    { params: t.Object({ id: t.String() }) }
  );

// =============================================
// Admin Feedback Clusters
// =============================================

const ACTIVE_DEFAULTS = [
  "open",
  "investigating",
  "fix_ready",
  "regression",
] as const;

/**
 * Parse the `status` CSV query param into an array of valid enum values.
 *
 * Semantics:
 * - `undefined` (param not present) → `undefined` (caller decides default)
 * - `""` (explicit empty string)    → `undefined` (explicit "no filter")
 * - Present CSV with values         → filtered array of valid enum values;
 *                                     if the filter removes everything,
 *                                     falls back to ACTIVE_DEFAULTS.
 */
const parseStatusesCsv = (raw: string | undefined): string[] | undefined => {
  if (raw === undefined) return undefined;
  if (raw === "") return undefined;
  const validValues = feedbackClusterStatusEnum.enumValues as readonly string[];
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && validValues.includes(s));
  if (parsed.length === 0) {
    return [...ACTIVE_DEFAULTS];
  }
  return parsed;
};

const adminFeedbackClustersRoutes = new Elysia({ prefix: "/feedback-clusters" })

  // GET /feedback-clusters?status=open,investigating,fix_ready,regression
  // - status omitted → defaults to active statuses (open, investigating, fix_ready, regression)
  // - status="" (empty) → no status filter (returns all statuses)
  // - status="open" → single value still works (backward-compat)
  // - status="open,resolved" → multiple values via CSV
  //
  // Feedback is mono-project by definition (the Almirant project): the
  // `projectId` query parameter was dropped.
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const pagination = parsePaginationParams(query);
        const parsedStatuses = parseStatusesCsv(query.status);
        // If the param is absent entirely, apply the new default of active statuses.
        // If the param is explicitly empty (""), parsedStatuses is undefined → no filter.
        const statuses =
          query.status === undefined
            ? [...ACTIVE_DEFAULTS]
            : parsedStatuses;
        const { clusters, total } = await getAdminFeedbackClusters(
          {
            statuses,
          },
          pagination
        );
        return successResponse(clusters, buildPaginationMeta(pagination.page, pagination.limit, total));
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-clusters" }, "Failed to fetch feedback clusters");
      }
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // GET /feedback-clusters/:id
  //
  // Returns the full cluster-detail aggregate used by the admin modal:
  //   { cluster, items, bugFixAttempts, activeAttempt, statusHistory,
  //     promotion, timelineEvents }
  //
  // BREAKING CHANGE (A-1829): the previous shape returned only the flat
  // `cluster` row. Backend + frontend must deploy together in the same release.
  //
  // ADDITIVE (A-F-434): `timelineEvents` is an ordered flat list of
  // cluster-lifecycle events derived from the three existing arrays; safe
  // for old clients to ignore.
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const detail = await getFeedbackClusterDetail(params.id);
        if (!detail) {
          set.status = 404;
          return notFoundResponse("Feedback cluster");
        }
        return successResponse(detail);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-clusters/:id", clusterId: params.id },
          "Failed to fetch feedback cluster detail",
        );
      }
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) }
  )

  // PATCH /feedback-clusters/:id
  .patch(
    "/:id",
    async ({ params, body, set }) => {
      try {
        // status is intentionally dropped here: status transitions must go through POST /:id/transitions to run the state machine.
        const { status: _ignoredStatus, ...rest } = body;
        const updated = await updateFeedbackCluster(params.id, {
          ...rest,
          suggestedType: body.suggestedType as "task" | "story" | "feature" | "epic" | undefined,
          suggestedPriority: body.suggestedPriority as "low" | "medium" | "high" | "urgent" | undefined,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Feedback cluster");
        }
        return successResponse(updated);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-clusters/:id", clusterId: params.id },
          "Failed to update feedback cluster",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        title: t.Optional(t.String()),
        summary: t.Optional(t.String()),
        itemCount: t.Optional(t.Number()),
        status: t.Optional(t.String()),
        suggestedType: t.Optional(t.String()),
        suggestedPriority: t.Optional(t.String()),
        metadata: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )

  // DELETE /feedback-clusters/:id
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deleted = await deleteFeedbackCluster(params.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Feedback cluster");
        }
        return successResponse({ deleted: true });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-clusters/:id", clusterId: params.id },
          "Failed to delete feedback cluster",
        );
      }
    },
    { params: t.Object({ id: t.String() }) }
  )

  // POST /feedback-clusters/:id/launch-investigation
  //
  // Launches a bug-fix investigation on a cluster:
  //   1. Calls `launchClusterInvestigation` repo (A-1823) which creates a
  //      bug_fix_attempts row, transitions cluster → investigating, and
  //      appends a status-history row — all in a single transaction.
  //   2. Enqueues an agent job (bug-analysis) with `clusterId` in config so the
  //      skill resolver can scope work to the cluster.
  //   3. Links the newly created agent job back to the attempt via
  //      `updateBugFixAttempt({ agentJobId })`.
  //
  // If enqueue or linking fails, the handler compensates by marking the
  // attempt as failed and rolling the cluster back to `open`, then returns
  // 500 so the caller can retry.
  .post(
    "/:id/launch-investigation",
    async (ctx) => {
      const { params, body, set } = ctx;

      const currentUser = (ctx as { user?: { id?: string } }).user;
      if (!currentUser?.id) {
        set.status = 401;
        return errorResponse("Authentication required", 401);
      }
      const activeWorkspace = (
        ctx as { activeWorkspace?: { id?: string } }
      ).activeWorkspace;
      const workspaceId = activeWorkspace?.id;
      if (!workspaceId) {
        set.status = 403;
        return errorResponse("No active workspace in session", 403);
      }

      const result = await launchClusterInvestigationForUser({
        clusterId: params.id,
        userId: currentUser.id,
        workspaceId,
        domain: body.domain,
      });

      if (result.success) {
        set.status = 201;
        return successResponse({
          bugFixAttempt: result.bugFixAttempt,
          agentJob: result.agentJob,
          cluster: result.cluster,
        });
      }

      switch (result.code) {
        case "CLUSTER_NOT_FOUND": {
          set.status = 404;
          return notFoundResponse("Feedback cluster");
        }
        case "ACTIVE_ATTEMPT_EXISTS": {
          set.status = 409;
          return {
            success: false as const,
            error: result.message,
            data: {
              code: "ACTIVE_ATTEMPT_EXISTS" as const,
              activeAttemptId: result.detail?.activeAttemptId as
                | string
                | undefined,
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }
        case "INVALID_STATE": {
          set.status = 422;
          return {
            success: false as const,
            error: result.message,
            data: {
              code: "INVALID_STATE" as const,
              currentStatus: result.detail?.currentStatus as string | undefined,
              allowedStatuses: result.detail?.allowedStatuses as
                | readonly string[]
                | undefined,
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }
        case "CLUSTER_EMPTY": {
          set.status = 422;
          return {
            success: false as const,
            error: result.message,
            data: { code: "CLUSTER_EMPTY" as const },
            meta: { timestamp: new Date().toISOString() },
          };
        }
        case "MAX_ATTEMPTS_REACHED": {
          set.status = 422;
          return {
            success: false as const,
            error: result.message,
            data: {
              code: "MAX_ATTEMPTS_REACHED" as const,
              budget: result.detail?.budget,
            },
            meta: { timestamp: new Date().toISOString() },
          };
        }
        case "INTERNAL": {
          set.status = 500;
          return errorResponse(
            result.message || "Failed to enqueue investigation job",
            500
          );
        }
        default: {
          // Exhaustiveness guard.
          const _never: never = result.code;
          void _never;
          set.status = 500;
          return errorResponse("Unknown launch-investigation failure", 500);
        }
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      // NOTE: projectId is hard-bound to the Almirant project via
      // getAlmirantProjectId() — do not accept it from the client body.
      body: t.Object({
        domain: t.Optional(
          t.Union([
            t.Literal("frontend"),
            t.Literal("backend"),
            t.Literal("coding-agent"),
            t.Literal("infrastructure"),
            t.Literal("unknown"),
          ])
        ),
      }),
    }
  )

  // POST /feedback-clusters/:id/abort-investigation
  //
  // A-1930: user-driven abort of an active investigation. Delegates to the
  // reusable `abortClusterInvestigation` service, which is also used by the
  // automatic timeout sweeper. Idempotent: calling twice on an already-open
  // cluster returns 200 with `code: "ALREADY_ABORTED"` instead of 422.
  .post(
    "/:id/abort-investigation",
    async (ctx) => {
      const { params, set } = ctx;

      const currentUser = (ctx as { user?: { id?: string } }).user;
      if (!currentUser?.id) {
        set.status = 401;
        return errorResponse("Authentication required", 401);
      }
      const activeWorkspace = (
        ctx as { activeWorkspace?: { id?: string } }
      ).activeWorkspace;
      const workspaceId = activeWorkspace?.id;
      if (!workspaceId) {
        set.status = 403;
        return errorResponse("No active workspace in session", 403);
      }

      try {
        const result = await abortClusterInvestigation({
          clusterId: params.id,
          reason: "aborted_by_user",
          actor: {
            kind: "user",
            userId: currentUser.id,
            workspaceId,
          },
        });

        if (!result.success) {
          switch (result.reason) {
            case "cluster_not_found": {
              set.status = 404;
              return notFoundResponse("Feedback cluster");
            }
            case "invalid_state": {
              set.status = 422;
              return {
                success: false as const,
                error: "Cluster is not in investigating state",
                data: {
                  code: "INVALID_STATE",
                  currentStatus: result.currentStatus,
                  allowedStatuses: ["investigating"],
                },
                meta: { timestamp: new Date().toISOString() },
              };
            }
            default: {
              const _never: never = result;
              void _never;
              set.status = 500;
              return errorResponse(
                "Unknown abort-investigation failure",
                500
              );
            }
          }
        }

        if (result.alreadyAborted) {
          set.status = 200;
          return successResponse({
            code: "ALREADY_ABORTED",
            cluster: result.cluster,
          });
        }

        set.status = 200;
        return successResponse({
          bugFixAttempt: result.attempt,
          cluster: result.cluster,
        });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-clusters/:id/abort-investigation", clusterId: params.id },
          "Failed to abort cluster investigation",
        );
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Optional(t.Object({})),
    }
  )

  // POST /feedback-clusters/:id/dismiss
  //
  // A-1911: user-driven dismissal with free-text reason and cascade to linked
  // feedback items (non-terminal items → `cancelled`). Idempotent: a second
  // call on an already-dismissed cluster returns 200 with
  // `dismissedItemCount: 0` instead of 422, so clients can safely retry.
  .post(
    "/:id/dismiss",
    async (ctx) => {
      const { params, body, set } = ctx;

      const currentUser = (ctx as { user?: { id?: string } }).user;
      if (!currentUser?.id) {
        set.status = 401;
        return errorResponse("Authentication required", 401);
      }
      const activeWorkspace = (
        ctx as { activeWorkspace?: { id?: string } }
      ).activeWorkspace;
      const workspaceId = activeWorkspace?.id;
      if (!workspaceId) {
        set.status = 403;
        return errorResponse("No active workspace in session", 403);
      }

      try {
        const result = await dismissClusterWithReason({
          clusterId: params.id,
          userId: currentUser.id,
          workspaceId,
          reason: body.reason,
        });

        if (!result.success) {
          switch (result.reason) {
            case "cluster_not_found": {
              set.status = 404;
              return notFoundResponse("Feedback cluster");
            }
            case "invalid_state": {
              set.status = 422;
              return {
                success: false as const,
                error: `Cluster cannot be dismissed (current: ${result.currentStatus})`,
                data: {
                  code: "INVALID_STATE",
                  currentStatus: result.currentStatus,
                  allowedStatuses: result.allowedStatuses,
                },
                meta: { timestamp: new Date().toISOString() },
              };
            }
            default: {
              // Exhaustiveness guard — if a new failure reason is added to
              // DismissClusterWithReasonResult, TS forces a case here.
              const _never: never = result;
              void _never;
              set.status = 500;
              return errorResponse("Unknown dismiss failure", 500);
            }
          }
        }

        return successResponse({
          cluster: result.cluster,
          dismissedItemCount: result.dismissedItemCount,
          alreadyDismissed: result.alreadyDismissed,
        });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-clusters/:id/dismiss", clusterId: params.id },
          "Failed to dismiss cluster",
        );
      }
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        reason: t.Optional(t.String({ maxLength: 2000 })),
      }),
    }
  );

// =============================================
// Admin Feedback Promotions (read-only)
// =============================================

const adminFeedbackPromotionsRoutes = new Elysia({ prefix: "/feedback-promotions" })

  // GET /feedback-promotions?feedbackItemId=...&workItemId=...
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const promotions = await getFeedbackPromotions(query.feedbackItemId, query.workItemId);
        return successResponse(promotions);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-promotions" }, "Failed to fetch feedback promotions");
      }
    },
    {
      query: t.Object({
        feedbackItemId: t.Optional(t.String()),
        workItemId: t.Optional(t.String()),
      }),
    }
  );

// =============================================
// Admin Feedback Triage (AI-powered)
// =============================================

const adminFeedbackTriageRoutes = new Elysia({ prefix: "/feedback-triage" })

  // POST /feedback-triage/run
  .post(
    "/run",
    async ({ body, set }) => {
      const { triageFeedback } = await import("../../feedback/services/feedback-triage-service");
      const { isAiConfigured } = await import("../../ai/shared/services/ai-service");
      const { resolveModelFromProviderKey, withAuthErrorDetection } = await import("../../ai/shared/services/model-factory");

      if (!body.providerKeyId && !isAiConfigured()) {
        set.status = 400;
        return errorResponse(
          "AI is not configured. Set the OPENAI_API_KEY environment variable to enable feedback triage."
        );
      }

      let model: import("@langchain/core/language_models/chat_models").BaseChatModel | undefined;
      let connectionId: string | undefined;
      if (body.providerKeyId) {
        try {
          const resolved = await resolveModelFromProviderKey(body.providerKeyId);
          model = resolved.model;
          connectionId = resolved.connectionId;
        } catch (err) {
          set.status = 500;
          return internalErrorResponse(
            err,
            { route: "/feedback-triage/run", keyId: body.providerKeyId },
            "Failed to resolve provider API key",
          );
        }
      }

      try {
        const locale = body.locale ?? "es";
        const run = () => triageFeedback(model, locale);
        const result = connectionId
          ? await withAuthErrorDetection(connectionId, run)
          : await run();
        return successResponse(result);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-triage/run" }, "Failed to run feedback triage");
      }
    },
    {
      body: t.Object({
        providerKeyId: t.Optional(t.String()),
        locale: t.Optional(t.String()),
      }),
    }
  );

// =============================================
// Admin Feedback Stats
// =============================================

const adminFeedbackStatsRoutes = new Elysia()

  // GET /feedback/stats
  .get(
    "/stats",
    async ({ set }) => {
      try {
        const stats = await getAdminFeedbackStats();
        return successResponse(stats);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback/stats" }, "Failed to fetch feedback stats");
      }
    }
  );

// =============================================
// Combined admin feedback export
// =============================================

export const adminFeedbackRoutes = new Elysia({ prefix: "/feedback" })
  .use(adminFeedbackStatsRoutes)
  .use(adminFeedbackItemsRoutes)
  .use(adminFeedbackSourcesRoutes)
  .use(adminFeedbackClustersRoutes)
  .use(adminFeedbackPromotionsRoutes)
  .use(adminFeedbackTriageRoutes)
  .use(adminFeedbackTopicProposalRoutes);
