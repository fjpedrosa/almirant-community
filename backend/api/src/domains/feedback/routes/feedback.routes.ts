import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import { successResponse, errorResponse, internalErrorResponse } from "../../../shared/services/response";
import { createFeedbackItemWithPipeline } from "../services/feedback-item-service";
import { broadcastFeedbackItemCreated } from "../../../shared/ws/feedback-events";
import { enqueueFeedbackTriageBatchJob } from "../services/feedback-triage-enqueue";

// =============================================
// Feedback Items — Widget submission only
// =============================================

const feedbackItemsRoutes = new Elysia({ prefix: "/feedback-items" })
  .use(sessionContextTypes)

  // POST /feedback-items
  .post(
    "/",
    async ({ body, set, activeWorkspace }) => {
      try {
        if (!body.title?.trim()) {
          set.status = 400;
          return errorResponse("Title is required");
        }
        const workspaceId = activeWorkspace?.id;
        if (!workspaceId) {
          set.status = 403;
          return errorResponse("No active workspace in session", 403);
        }
        const item = await createFeedbackItemWithPipeline({
          sourceId: body.sourceId ?? null,
          clusterId: body.clusterId ?? null,
          status: (body.status as "new") ?? "new",
          category: (body.category as "other") ?? "other",
          title: body.title.trim(),
          content: body.content ?? null,
          authorName: body.authorName ?? null,
          authorEmail: body.authorEmail ?? null,
          authorMeta: body.authorMeta ?? null,
          sentiment: body.sentiment ?? null,
          metadata: {
            ...(body.metadata ?? {}),
            workspaceId,
          },
          promotedWorkItemId: null,
        });
        broadcastFeedbackItemCreated({ item, workspaceId });
        set.status = 201;
        return successResponse(item);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "POST /feedback-items" }, "Failed to create feedback item");
      }
    },
    {
      // NOTE: projectId is hard-bound to the Almirant project via
      // getAlmirantProjectId() in feedback-item-service — do not accept
      // it from the client body.
      body: t.Object({
        sourceId: t.Optional(t.String()),
        clusterId: t.Optional(t.String()),
        status: t.Optional(t.String()),
        category: t.Optional(t.String()),
        title: t.String(),
        content: t.Optional(t.String()),
        authorName: t.Optional(t.String()),
        authorEmail: t.Optional(t.String()),
        authorMeta: t.Optional(t.Record(t.String(), t.Unknown())),
        sentiment: t.Optional(t.String()),
        metadata: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )

  // POST /feedback-items/batch-triage
  //
  // Admin endpoint invoked from the moderation UI when an operator selects
  // multiple `new` feedback items and asks for a one-shot batch triage.
  // Delegates to `enqueueFeedbackTriageBatchJob`, which enforces the
  // minimum of 2 items and idempotency on overlapping active batches.
  //
  // Responses:
  //   202 { status: "enqueued", jobId }
  //   200 { status: "already_active", alreadyActiveJobId }
  //   400 { status: "error", error } -- validation
  //   500 { status: "error", error } -- createJob failure
  .post(
    "/batch-triage",
    async ({ body, set, activeWorkspace }) => {
      try {
        const workspaceId = activeWorkspace?.id;
        if (!workspaceId) {
          set.status = 403;
          return errorResponse("No active workspace in session", 403);
        }

        const ids = Array.isArray(body.feedbackItemIds)
          ? body.feedbackItemIds.filter((id) => typeof id === "string" && id.trim().length > 0)
          : [];
        if (ids.length < 2) {
          set.status = 400;
          return errorResponse("At least 2 feedbackItemIds are required", 400);
        }
        if (ids.length > 50) {
          set.status = 400;
          return errorResponse("Batch triage is limited to 50 items per request", 400);
        }

        const result = await enqueueFeedbackTriageBatchJob({
          feedbackItemIds: ids,
          workspaceId,
        });

        if (result.status === "enqueued") {
          set.status = 202;
          return successResponse({ jobId: result.jobId, status: "enqueued" });
        }
        if (result.status === "already_active") {
          set.status = 200;
          return successResponse({
            status: "already_active",
            alreadyActiveJobId: result.alreadyActiveJobId,
          });
        }
        set.status = 500;
        return errorResponse(result.error, 500);
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "POST /feedback-items/batch-triage" },
          "Failed to enqueue batch triage",
        );
      }
    },
    {
      body: t.Object({
        feedbackItemIds: t.Array(t.String()),
      }),
    },
  );

// =============================================
// Combined export
// =============================================

export const feedbackRoutes = new Elysia()
  .use(sessionContextTypes)
  .use(feedbackItemsRoutes);
