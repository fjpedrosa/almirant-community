import { Elysia, t } from "elysia";
import {
  listReviewInbox,
  listClusters,
  promoteClusterToWorkItem,
  getClusterItems,
  transitionCluster,
  createFeedbackCluster,
  assignFeedbackToCluster,
  updateFeedbackItem,
  getFeedbackItemById,
  recalculateClusterItemCount,
  type ClusterTransitionEvent,
} from "@almirant/database";
import {
  ACTIVE_CLUSTER_STATUSES,
  isClusterStatus,
  type ClusterStatus,
} from "@almirant/shared";
import {
  successResponse,
  errorResponse,
  internalErrorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../shared/services/response";
import { broadcastFeedbackItemUpdated } from "../../../shared/ws/feedback-events";
import { launchClusterInvestigationForUser } from "../services/launch-cluster-investigation";

const normalizeError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

// =============================================
// Admin Feedback Triage - Inbox (G1)
// =============================================

const adminFeedbackTriageInboxRoutes = new Elysia({ prefix: "/inbox" })

  // GET /inbox — list feedback items requiring admin review (low-confidence triage)
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const pagination = parsePaginationParams(query);
        const { items, total } = await listReviewInbox(
          {
            status: query.status,
            aiDomain: query.aiDomain,
          },
          pagination
        );
        return successResponse(
          items,
          buildPaginationMeta(pagination.page, pagination.limit, total)
        );
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-triage/inbox" }, "Failed to fetch review inbox");
      }
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        aiDomain: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  );

// =============================================
// Admin Feedback Triage - Clusters (G2)
// =============================================

const adminFeedbackTriageClustersRoutes = new Elysia({ prefix: "/clusters" })

  // GET /clusters — clusters grouped by topic, filtered by status/minItemCount
  // and ordered by impact or recency.
  .get(
    "/",
    async (ctx) => {
      const { query, set } = ctx;
      try {
        // `parsePaginationParams` expects `Record<string, string | undefined>`,
        // but `minItemCount` is typed as `number` after Elysia's `t.Numeric`
        // coercion. Pass only the pagination-relevant string fields to keep
        // the helper's signature happy.
        const pagination = parsePaginationParams({
          page: query.page,
          limit: query.limit,
        });

        // Resolve workspace from the session context. Accepts the current
        // API shape where middleware decorates the request with
        // `activeWorkspace`; falls back to an empty string so the contract
        // does not break in test environments where the decoration is absent.
        const activeWorkspace = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace;
        const workspaceId = activeWorkspace?.id ?? "";

        // Resolve statuses: `statuses` (comma-separated) takes precedence
        // over the legacy single-value `status` param. Unlike the earlier
        // implementation (which silently dropped unknown enum values), we
        // now surface a 400 when the caller explicitly sent a status that
        // isn't part of the `ClusterStatus` enum — silent filtering hid
        // client bugs. Callers that omit both params keep getting the
        // `ACTIVE_CLUSTER_STATUSES` default.
        let resolvedStatuses: ClusterStatus[] | undefined;
        const invalidStatuses: string[] = [];

        if (typeof query.statuses === "string" && query.statuses.length > 0) {
          const candidates = query.statuses
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          resolvedStatuses = [];
          for (const candidate of candidates) {
            if (isClusterStatus(candidate)) {
              resolvedStatuses.push(candidate);
            } else {
              invalidStatuses.push(candidate);
            }
          }
        } else if (
          typeof query.status === "string" &&
          query.status.length > 0
        ) {
          if (isClusterStatus(query.status)) {
            resolvedStatuses = [query.status];
          } else {
            resolvedStatuses = [];
            invalidStatuses.push(query.status);
          }
        }

        if (invalidStatuses.length > 0) {
          set.status = 400;
          return errorResponse(
            `Invalid cluster status value(s): ${invalidStatuses.join(", ")}`,
            400,
            "INVALID_STATUS"
          );
        }

        const statuses =
          resolvedStatuses && resolvedStatuses.length > 0
            ? resolvedStatuses
            : ACTIVE_CLUSTER_STATUSES;

        // `minItemCount` comes off the wire via t.Numeric so it is already a
        // number here; default to 1 to hide clusters with no linked items.
        const minItemCount =
          typeof query.minItemCount === "number" && query.minItemCount > 0
            ? query.minItemCount
            : 1;

        // Default to "updatedAt" — the admin triage UI sorts by recency of
        // the last meaningful change so freshly-regressed or newly-resolved
        // clusters bubble to the top.
        const sortBy: "itemCount" | "createdAt" | "updatedAt" =
          query.sortBy === "createdAt"
            ? "createdAt"
            : query.sortBy === "itemCount"
              ? "itemCount"
              : "updatedAt";

        const { groups, total } = await listClusters(
          {
            workspaceId,
            statuses,
            minItemCount,
            sortBy,
          },
          pagination
        );

        return successResponse(
          groups,
          buildPaginationMeta(pagination.page, pagination.limit, total)
        );
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-triage/clusters" }, "Failed to fetch feedback clusters");
      }
    },
    {
      query: t.Object({
        // Legacy single-status filter — kept for backward compatibility. When
        // both `status` and `statuses` are provided, `statuses` wins.
        status: t.Optional(t.String()),
        // Comma-separated list of cluster statuses. Values are split, trimmed
        // and filtered against the ClusterStatus enum server-side.
        statuses: t.Optional(t.String()),
        minItemCount: t.Optional(t.Numeric()),
        sortBy: t.Optional(
          t.Union([
            t.Literal("itemCount"),
            t.Literal("createdAt"),
            t.Literal("updatedAt"),
          ])
        ),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )

  // POST /clusters — manually create a new cluster (operator action).
  //
  // Backed by `createFeedbackCluster` (embedding-less insert) rather than
  // `createClusterFromFeedback`: the latter REQUIRES a 1536-dim embedding and a
  // single anchor feedback item, neither of which a manual create supplies
  // (`CreateClusterInput` only carries title/summary/topicId + an OPTIONAL list
  // of feedbackItemIds). When items are supplied they are attached via
  // `updateFeedbackItem({ clusterId, status: 'triaged' })` and the cluster's
  // cached `itemCount` is reconciled with `recalculateClusterItemCount`.
  .post(
    "/",
    async (ctx) => {
      const { body, set } = ctx;
      try {
        const workspaceId = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace?.id;

        const cluster = await createFeedbackCluster({
          title: body.title,
          summary: body.summary ?? null,
          topicId: body.topicId ?? null,
        });

        const feedbackItemIds = body.feedbackItemIds ?? [];
        for (const itemId of feedbackItemIds) {
          const updated = await updateFeedbackItem(itemId, {
            clusterId: cluster.id,
            status: "triaged",
          });
          if (updated) {
            broadcastFeedbackItemUpdated({
              item: { id: updated.id, title: updated.title },
              changes: { clusterId: cluster.id, status: "triaged" },
              workspaceId,
            });
          }
        }

        // Reconcile the cached itemCount against the actual linked rows so the
        // response mirrors reality even when some ids referenced missing items.
        const itemCount =
          feedbackItemIds.length > 0
            ? await recalculateClusterItemCount(cluster.id)
            : cluster.itemCount;

        set.status = 201;
        return successResponse({
          id: cluster.id,
          title: cluster.title,
          summary: cluster.summary,
          itemCount,
          createdAt: cluster.createdAt.toISOString(),
        });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/feedback-triage/clusters" }, "Failed to create feedback cluster");
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        summary: t.Optional(t.String()),
        topicId: t.Optional(t.String()),
        feedbackItemIds: t.Optional(t.Array(t.String())),
      }),
    }
  )

  // POST /clusters/:id/promote — promote a cluster to a work item
  .post(
    "/:id/promote",
    async (ctx) => {
      const { params, body, set } = ctx;
      try {
        const currentUser = (
          ctx as { user?: { id?: string; name?: string; email?: string } }
        ).user;
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

        if (!body.boardId) {
          set.status = 400;
          return errorResponse("boardId is required", 400);
        }

        const result = await promoteClusterToWorkItem({
          clusterId: params.id,
          workspaceId,
          boardId: body.boardId,
          boardColumnId: body.boardColumnId,
          workItemType: body.workItemType as
            | "epic"
            | "feature"
            | "story"
            | "task"
            | undefined,
          priority: body.priority as
            | "low"
            | "medium"
            | "high"
            | "urgent"
            | undefined,
          parentWorkItemId: body.parentWorkItemId,
          titleOverride: body.titleOverride,
          notes: body.notes,
          promotedBy: currentUser.name ?? currentUser.email ?? currentUser.id,
          createdByUserId: currentUser.id,
          projectId: body.projectId,
        });

        // Emit WS events for all affected feedback items
        const clusterItems = await getClusterItems(params.id);
        for (const item of clusterItems) {
          broadcastFeedbackItemUpdated({
            item: { id: item.id, title: item.title },
            changes: {
              promotedWorkItemId: result.workItem.id,
              status: "triaged",
            },
            workspaceId,
          });
        }

        // Return 200 if already promoted, 201 if newly created
        if (result.alreadyPromoted) {
          set.status = 200;
        } else {
          set.status = 201;
        }

        return successResponse({
          workItem: result.workItem,
          promotion: result.promotion,
          linkedItemCount: result.linkedItemCount,
          alreadyPromoted: result.alreadyPromoted,
        });
      } catch (error) {
        const message = normalizeError(error);

        if (message.startsWith("CLUSTER_NOT_FOUND")) {
          set.status = 404;
          return errorResponse("Feedback cluster not found", 404);
        }
        if (message.startsWith("CLUSTER_EMPTY")) {
          set.status = 400;
          return errorResponse(
            "Cluster has no feedback items to promote",
            400
          );
        }
        if (
          message.startsWith("BOARD_NOT_IN_ORGANIZATION") ||
          message.startsWith("PROJECT_NOT_IN_ORGANIZATION")
        ) {
          set.status = 400;
          return errorResponse(message, 400);
        }
        if (message.startsWith("WORK_ITEM_TYPE_NOT_ALLOWED")) {
          set.status = 400;
          return errorResponse(message, 400);
        }

        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-triage/clusters/:id/promote" },
          "Failed to promote feedback cluster",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        boardId: t.String(),
        boardColumnId: t.Optional(t.Nullable(t.String())),
        workItemType: t.Optional(t.String()),
        priority: t.Optional(t.String()),
        parentWorkItemId: t.Optional(t.String()),
        titleOverride: t.Optional(t.String()),
        notes: t.Optional(t.String()),
        projectId: t.Optional(t.Nullable(t.String())),
      }),
    }
  )

  // POST /clusters/:id/transitions — apply a manual status transition to a cluster
  .post(
    "/:id/transitions",
    async (ctx) => {
      const { params, body, set } = ctx;
      try {
        const currentUser = (
          ctx as { user?: { id?: string; name?: string; email?: string } }
        ).user;
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

        const { toStatus, reason } = body;

        // Promotion has a dedicated endpoint which performs additional side
        // effects (work-item creation, linking, WS broadcasts). Reject the
        // `promoted` shortcut here with a 422 so clients are directed to the
        // correct route instead of silently skipping those steps.
        if (toStatus === "promoted") {
          set.status = 422;
          return {
            success: false as const,
            error: "PROMOTE_HAS_DEDICATED_ROUTE",
            message:
              "Use POST /admin/feedback-triage/clusters/:id/promote to promote a cluster",
          };
        }

        const event: ClusterTransitionEvent = {
          triggeredByKind: "user" as const,
          triggeredByUserId: currentUser.id,
          reason,
        };

        const result = await transitionCluster(params.id, toStatus, event);

        if (result.success) {
          console.info("cluster.transition.user", {
            clusterId: params.id,
            from: result.cluster?.status,
            to: toStatus,
            userId: currentUser.id,
            reason,
          });
          return successResponse(result.cluster);
        }

        if (result.reason === "cluster_not_found") {
          set.status = 404;
          return notFoundResponse("Cluster");
        }

        // invalid_transition
        set.status = 409;
        return {
          success: false as const,
          error: "INVALID_TRANSITION",
          currentStatus: result.from,
          toStatus: result.to,
          allowed: result.allowed,
        };
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-triage/clusters/:id/transitions", clusterId: params.id },
          "Failed to apply cluster transition",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        toStatus: t.Union([
          t.Literal("open"),
          t.Literal("investigating"),
          t.Literal("fix_ready"),
          t.Literal("resolved"),
          t.Literal("regression"),
          t.Literal("dismissed"),
          t.Literal("promoted"),
        ]),
        reason: t.Optional(t.String({ maxLength: 500 })),
      }),
    }
  )

  // POST /clusters/batch-launch-investigation — launch investigations for
  // multiple clusters sequentially. Always responds 200 with a per-cluster
  // result list plus an aggregate summary; partial failure is the normal
  // case for a batch. Capped at 50 ids per request as a safety guard (see
  // design doc §2.3 for the serial-iteration rationale).
  .post(
    "/batch-launch-investigation",
    async (ctx) => {
      const { body, set } = ctx;

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

      const results: Array<{
        clusterId: string;
        success: boolean;
        code?: string;
        agentJobId?: string;
        attemptId?: string;
      }> = [];
      const codeCounts: Record<string, number> = {};

      // Serial iteration — see design doc §2.3 for rationale.
      for (const clusterId of body.clusterIds) {
        const result = await launchClusterInvestigationForUser({
          clusterId,
          userId: currentUser.id,
          workspaceId,
        });
        if (result.success) {
          results.push({
            clusterId,
            success: true,
            agentJobId: result.agentJobId,
            attemptId: result.attemptId,
          });
        } else {
          results.push({ clusterId, success: false, code: result.code });
          codeCounts[result.code] = (codeCounts[result.code] ?? 0) + 1;
        }
      }

      const launched = results.filter((r) => r.success).length;
      return successResponse({
        results,
        summary: {
          total: results.length,
          launched,
          skipped: results.length - launched,
          codeCounts,
        },
      });
    },
    {
      body: t.Object({
        clusterIds: t.Array(t.String({ format: "uuid" }), {
          minItems: 1,
          maxItems: 50,
        }),
      }),
    }
  );

// =============================================
// Admin Feedback Triage - Inbox item actions (G3)
// =============================================
//
// Per-item triage decisions fired from the moderation inbox. All three actions
// operate on a single feedback item and broadcast a `feedback-item:updated` WS
// event so open moderation views reconcile without a manual refetch (mirroring
// the promote route's broadcast behaviour).
//
// Status mapping note: the `feedback_status` enum has NO literal `dismissed` or
// `confirmed` value. The inbox is defined as `status = 'new' AND aiConfidence IS
// NOT NULL` (see `listReviewInbox`), so the correct terminal transitions that
// remove an item from the queue are:
//   • dismiss  → `cancelled` (rejected; will not be promoted)
//   • confirm  → `triaged`   (accept the AI triage suggestion)

const adminFeedbackTriageItemsRoutes = new Elysia({ prefix: "/items" })

  // POST /items/:id/reassign — move an inbox item to a different cluster.
  .post(
    "/:id/reassign",
    async (ctx) => {
      const { params, body, set } = ctx;
      try {
        const workspaceId = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace?.id;

        const existing = await getFeedbackItemById(params.id);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }
        const previousClusterId = existing.clusterId;

        const result = await assignFeedbackToCluster({
          feedbackItemId: params.id,
          clusterId: body.clusterId,
          // A manual admin reassignment is treated as high-confidence so the
          // item leaves the review queue (status → triaged, requiresReview off).
          aiConfidence: 1,
          aiReasoning: "Manually reassigned by admin",
        });

        // `assignFeedbackToCluster` bumps the target cluster's cached count by
        // +1; reconcile both the target and the previous cluster against the
        // real linked-row counts so no cached count drifts on re-moves.
        await recalculateClusterItemCount(body.clusterId);
        if (previousClusterId && previousClusterId !== body.clusterId) {
          await recalculateClusterItemCount(previousClusterId);
        }

        broadcastFeedbackItemUpdated({
          item: { id: params.id, title: existing.title },
          changes: { clusterId: body.clusterId, status: result.status },
          workspaceId,
        });

        return successResponse({ ok: true });
      } catch (error) {
        const message = normalizeError(error);
        if (message.includes("not found")) {
          set.status = 404;
          return errorResponse(message, 404);
        }
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-triage/items/:id/reassign", feedbackItemId: params.id },
          "Failed to reassign feedback item",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ clusterId: t.String() }),
    }
  )

  // POST /items/:id/dismiss — dismiss an inbox item (will not be promoted).
  .post(
    "/:id/dismiss",
    async (ctx) => {
      const { params, body, set } = ctx;
      try {
        const workspaceId = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace?.id;

        const updated = await updateFeedbackItem(params.id, {
          status: "cancelled",
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }

        if (body.reason) {
          console.info("feedback.item.dismissed", {
            itemId: params.id,
            reason: body.reason,
          });
        }

        broadcastFeedbackItemUpdated({
          item: { id: updated.id, title: updated.title },
          changes: { status: "cancelled" },
          workspaceId,
        });

        return successResponse({ ok: true });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-triage/items/:id/dismiss", feedbackItemId: params.id },
          "Failed to dismiss feedback item",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.Optional(t.String({ maxLength: 500 })) }),
    }
  )

  // POST /items/:id/confirm — confirm the AI triage suggestion for an item.
  .post(
    "/:id/confirm",
    async (ctx) => {
      const { params, set } = ctx;
      try {
        const workspaceId = (
          ctx as { activeWorkspace?: { id?: string } }
        ).activeWorkspace?.id;

        const updated = await updateFeedbackItem(params.id, {
          status: "triaged",
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Feedback item");
        }

        broadcastFeedbackItemUpdated({
          item: { id: updated.id, title: updated.title },
          changes: { status: "triaged" },
          workspaceId,
        });

        return successResponse({ ok: true });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/feedback-triage/items/:id/confirm", feedbackItemId: params.id },
          "Failed to confirm feedback item",
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
    }
  );

// =============================================
// Combined export
// =============================================

export const adminFeedbackTriageRoutes = new Elysia({ prefix: "/feedback-triage" })
  .use(adminFeedbackTriageInboxRoutes)
  .use(adminFeedbackTriageClustersRoutes)
  .use(adminFeedbackTriageItemsRoutes);
