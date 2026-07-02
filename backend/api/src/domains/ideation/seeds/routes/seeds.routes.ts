import { Elysia, t } from "elysia";
import {
  getSeeds,
  getSeedById,
  createSeed,
  updateSeed,
  deleteSeed,
  setSeedStatus,
  assignSeedOwner,
  toggleSeedSelectedForIdeation,
  bulkSelectSeedsForIdeation,
  getSelectedSeedsForIdeation,
  linkFeedbackToSeed,
  unlinkFeedbackFromSeed,
  linkWorkItemToSeed,
  addTagToSeed,
  removeTagFromSeed,
  getSeedEvents,
  createWorkItem,
  createTagIfNotExists,
  getTagById,
  getEntityComments,
  createEntityComment,
  updateEntityComment,
  deleteEntityComment,
  enqueueNotification,
  getMembersByWorkspaceId,
  parseMentionsFromHtml,
} from "@almirant/database";
import {
  buildPaginationMeta,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  successResponse,
} from "../../../../shared/services/response";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";
import { sendMentionNotification, sendNotificationBatch } from "../../../../shared/services/notification-service";

// ── Schemas ────────────────────────────────────────────────────────────────

const SEED_STATUS_SCHEMA = t.Union([
  t.Literal("draft"),
  t.Literal("active"),
  t.Literal("to_review"),
  t.Literal("approved"),
  t.Literal("archived"),
  t.Literal("rejected"),
]);

const SEED_STATUS_GROUP_SCHEMA = t.Union([
  t.Literal("active"),
  t.Literal("finished"),
]);

const SEED_SOURCE_SCHEMA = t.Union([
  t.Literal("manual"),
  t.Literal("feedback"),
  t.Literal("ai_generated"),
  t.Literal("import"),
]);

const PRIORITY_SCHEMA = t.Union([
  t.Literal("low"),
  t.Literal("medium"),
  t.Literal("high"),
  t.Literal("urgent"),
]);

const PROMOTABLE_WORK_ITEM_TYPE_SCHEMA = t.Union([
  t.Literal("epic"),
  t.Literal("feature"),
  t.Literal("story"),
  t.Literal("task"),
]);

// ── Helpers ────────────────────────────────────────────────────────────────

const normalizeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

const getWorkspaceIdFromContext = (ctx: unknown): string => {
  const activeWorkspace = (ctx as { activeWorkspace?: { id?: string } }).activeWorkspace;
  if (!activeWorkspace?.id) {
    throw new Error("ACTIVE_WORKSPACE_NOT_FOUND");
  }
  return activeWorkspace.id;
};

const mapSeedErrorToHttp = (errorMessage: string): { status: number; message: string } => {
  if (errorMessage === "ACTIVE_WORKSPACE_NOT_FOUND") {
    return { status: 403, message: "No active workspace in session" };
  }
  if (errorMessage === "SEED_NOT_FOUND") {
    return { status: 404, message: "Seed not found" };
  }
  if (errorMessage === "OWNER_NOT_MEMBER") {
    return { status: 400, message: "Selected owner does not belong to active workspace" };
  }
  if (errorMessage === "INVALID_SEED_STATUS") {
    return { status: 400, message: "Invalid seed status" };
  }
  if (errorMessage === "PROJECT_NOT_IN_WORKSPACE") {
    return { status: 400, message: "Selected project does not belong to active workspace" };
  }
  if (errorMessage === "WORK_ITEM_NOT_FOUND") {
    return { status: 404, message: "Work item not found" };
  }
  if (errorMessage === "FEEDBACK_NOT_FOUND") {
    return { status: 404, message: "Feedback item not found" };
  }
  if (errorMessage === "COMMENT_NOT_OWNED") {
    return { status: 403, message: "You can only edit or delete your own comments" };
  }
  if (errorMessage === "TAG_NOT_FOUND") {
    return { status: 404, message: "Tag not found" };
  }
  if (errorMessage === "TAG_ID_OR_NAME_REQUIRED") {
    return { status: 400, message: "Either tagId or name is required" };
  }
  if (errorMessage === "FAILED_TO_CREATE_SEED") {
    return { status: 500, message: "Failed to create seed" };
  }
  return { status: 500, message: errorMessage };
};

// ── Routes ─────────────────────────────────────────────────────────────────

export const seedsRoutes = new Elysia({ prefix: "/seeds" })
  // ── GET / — List seeds with filters ──────────────────────────────────
  .get(
    "/",
    async (ctx) => {
      try {
        const { query } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const pagination = parsePaginationParams(query);
        const statuses = query.statuses
          ? (query.statuses.split(",").map((s) => s.trim()).filter(Boolean) as import("@almirant/database").SeedStatus[])
          : undefined;
        const { items, total } = await getSeeds(orgId, pagination, {
          status: query.status,
          statuses,
          statusGroup: query.statusGroup,
          projectId: query.projectId,
          search: query.search,
          ownerUserId: query.ownerUserId,
          tagIds: query.tagIds ?? query.tagId,
          selectedForIdeation:
            query.selectedForIdeation === "true"
              ? true
              : query.selectedForIdeation === "false"
                ? false
                : undefined,
          sortBy: query.sortBy as "priority" | "createdAt" | "updatedAt" | undefined,
          sortOrder: query.sortOrder as "asc" | "desc" | undefined,
        });
        return successResponse(items, buildPaginationMeta(pagination.page, pagination.limit, total));
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        status: t.Optional(SEED_STATUS_SCHEMA),
        statuses: t.Optional(t.String()),
        statusGroup: t.Optional(SEED_STATUS_GROUP_SCHEMA),
        projectId: t.Optional(t.String()),
        search: t.Optional(t.String()),
        ownerUserId: t.Optional(t.String()),
        tagIds: t.Optional(t.String()),
        tagId: t.Optional(t.String()),
        selectedForIdeation: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortOrder: t.Optional(t.String()),
      }),
    }
  )
  // ── GET /selected — Seeds selected for planning ─────────────────────
  .get(
    "/selected",
    async (ctx) => {
      try {
        const { query } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const seeds = await getSelectedSeedsForIdeation(orgId, query.projectId);
        return successResponse(seeds);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
      }),
    }
  )
  // ── GET /:id — Single seed with relations ───────────────────────────
  .get(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const item = await getSeedById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Seed");
        }
        return successResponse(item);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  // ── POST / — Create seed ────────────────────────────────────────────
  .post(
    "/",
    async (ctx) => {
      try {
        const { body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const title = body.title?.trim();
        if (!title) {
          set.status = 400;
          return errorResponse("Title is required", 400);
        }

        const item = await createSeed(
          orgId,
          {
            projectId: body.projectId ?? undefined,
            title,
            description: body.description ?? undefined,
            source: body.source ?? undefined,
            priority: body.priority ?? undefined,
            ownerUserId: body.ownerUserId ?? undefined,
            selectedForIdeation: body.selectedForIdeation ?? undefined,
            metadata: body.metadata ?? {},
          },
          {
            triggeredBy: currentUser?.id ? "user" : "system",
            triggeredByUserId: currentUser?.id ?? null,
          }
        );

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "seed:created",
          payload: { seedId: item.id, title: item.title, projectId: item.projectId },
        });

        // Notify all org members about new seed (fire-and-forget)
        const members = await getMembersByWorkspaceId(orgId);
        const creatorUserId = currentUser?.id ?? item.createdByUserId ?? null;
        const creatorName = (currentUser as { name?: string } | undefined)?.name ?? "Un miembro del equipo";

        const notificationParams = members
          .filter((m) => m.userId !== creatorUserId)
          .map((m) => ({
            recipientUserId: m.userId,
            workspaceId: orgId,
            type: "assignment" as const,
            title: "Nuevo seed creado",
            body: `${creatorName} creo seed: ${item.title}`,
            link: `/seeds?id=${item.id}`,
            sourceEntityType: "seed",
            sourceEntityId: item.id,
            actorUserId: creatorUserId,
            metadata: {
              seedId: item.id,
              seedTitle: item.title,
              creatorUserId,
              projectId: item.projectId,
            },
          }));

        if (notificationParams.length > 0) {
          void sendNotificationBatch(notificationParams).catch(() => {});
        }

        set.status = 201;
        return successResponse(item);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      body: t.Object({
        projectId: t.Optional(t.Nullable(t.String())),
        title: t.String(),
        description: t.Optional(t.Nullable(t.String())),
        source: t.Optional(SEED_SOURCE_SCHEMA),
        priority: t.Optional(t.Nullable(PRIORITY_SCHEMA)),
        ownerUserId: t.Optional(t.Nullable(t.String())),
        selectedForIdeation: t.Optional(t.Boolean()),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
      }),
    }
  )
  // ── PATCH /:id — Update seed ────────────────────────────────────────
  .patch(
    "/:id",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await updateSeed(
          orgId,
          params.id,
          {
            projectId: body.projectId,
            status: body.status,
            title: body.title,
            description: body.description ?? undefined,
            source: body.source,
            priority: body.priority,
            ownerUserId: body.ownerUserId,
            selectedForIdeation: body.selectedForIdeation,
            metadata: body.metadata,
          },
          {
            triggeredBy: currentUser?.id ? "user" : "system",
            triggeredByUserId: currentUser?.id ?? null,
          }
        );

        if (!updated) {
          set.status = 404;
          return notFoundResponse("Seed");
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "seed:updated",
          payload: { seedId: params.id, changes: body as Record<string, unknown> },
        });

        // Enqueue email notification if ownerUserId changed (fire-and-forget)
        if (body.ownerUserId && currentUser?.id && currentUser.id !== body.ownerUserId) {
          void enqueueNotification(
            orgId,
            body.ownerUserId,
            "assignment",
            `assignment:seed:${body.ownerUserId}`,
            {
              seedId: params.id,
              seedTitle: updated.title,
              assignerName: (currentUser as { name?: string }).name ?? "Someone",
              assignerId: currentUser.id,
            },
            10
          ).catch(() => {});
        }

        return successResponse(updated);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        projectId: t.Optional(t.Nullable(t.String())),
        status: t.Optional(SEED_STATUS_SCHEMA),
        title: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
        source: t.Optional(SEED_SOURCE_SCHEMA),
        priority: t.Optional(t.Nullable(PRIORITY_SCHEMA)),
        ownerUserId: t.Optional(t.Nullable(t.String())),
        selectedForIdeation: t.Optional(t.Boolean()),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
      }),
    }
  )
  // ── DELETE /:id — Delete seed ───────────────────────────────────────
  .delete(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const deleted = await deleteSeed(orgId, params.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Seed");
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "seed:deleted",
          payload: { seedId: params.id },
        });

        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  // ── PATCH /:id/status — Change status ──────────────────────────────
  .patch(
    "/:id/status",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await setSeedStatus(orgId, params.id, body.status, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Seed");
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "seed:updated",
          payload: { seedId: params.id, changes: { status: body.status } },
        });

        return successResponse(updated);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ status: SEED_STATUS_SCHEMA }),
    }
  )
  // ── PATCH /:id/owner — Assign owner ────────────────────────────────
  .patch(
    "/:id/owner",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await assignSeedOwner(orgId, params.id, body.ownerUserId ?? null, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Seed");
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "seed:updated",
          payload: { seedId: params.id, changes: { ownerUserId: body.ownerUserId } },
        });

        // Enqueue email notification for assignment (fire-and-forget)
        if (body.ownerUserId && currentUser?.id && currentUser.id !== body.ownerUserId) {
          void enqueueNotification(
            orgId,
            body.ownerUserId,
            "assignment",
            `assignment:seed:${body.ownerUserId}`,
            {
              seedId: params.id,
              seedTitle: updated.title,
              assignerName: (currentUser as { name?: string }).name ?? "Someone",
              assignerId: currentUser.id,
            },
            10
          ).catch(() => {});
        }

        return successResponse(updated);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ ownerUserId: t.Nullable(t.String()) }),
    }
  )
  // ── PATCH /:id/select-for-planning — Toggle selection ──────────────
  .patch(
    "/:id/select-for-planning",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const updated = await toggleSeedSelectedForIdeation(orgId, params.id, body.selected);
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Seed");
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "seed:updated",
          payload: { seedId: params.id, changes: { selectedForIdeation: body.selected } },
        });

        return successResponse(updated);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ selected: t.Boolean() }),
    }
  )
  // ── POST /bulk-select-for-planning — Bulk toggle ───────────────────
  .post(
    "/bulk-select-for-planning",
    async (ctx) => {
      try {
        const { body } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const count = await bulkSelectSeedsForIdeation(orgId, body.ids, body.selected);

        for (const id of body.ids) {
          wsConnectionManager.broadcastToWorkspace(orgId, {
            type: "seed:updated",
            payload: { seedId: id, changes: { selectedForIdeation: body.selected } },
          });
        }

        return successResponse({ updated: count });
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      body: t.Object({
        ids: t.Array(t.String(), { minItems: 1 }),
        selected: t.Boolean(),
      }),
    }
  )
  // ── POST /:id/promote — Promote seed to work item ─────────────────
  .post(
    "/:id/promote",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const source = await getSeedById(orgId, params.id);
        if (!source) {
          set.status = 404;
          return notFoundResponse("Seed");
        }

        const promotedTitle = body.title.trim();
        if (!promotedTitle) {
          set.status = 400;
          return errorResponse("Title is required", 400);
        }

        const workItem = await createWorkItem(orgId, {
          projectId: body.projectId,
          boardId: body.boardId,
          boardColumnId: body.boardColumnId ?? null,
          parentId: body.parentId,
          type: body.workItemType,
          title: promotedTitle,
          description: body.description,
          priority: body.priority,
          metadata: {
            promotedFromSeed: params.id,
          },
        });

        const link = await linkWorkItemToSeed(
          orgId,
          params.id,
          workItem.id,
          "promoted_to",
          body.promotedBy ?? null,
          {
            triggeredBy: body.promotedBy ? "user" : "system",
            triggeredByUserId: body.promotedBy ?? null,
          }
        );

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "work-item:created",
          payload: {
            workItemId: workItem.id,
            boardId: workItem.boardId,
            title: workItem.title,
            taskId: workItem.taskId ?? undefined,
          },
        });

        set.status = 201;
        return successResponse({
          source: {
            id: source.id,
            status: source.status,
          },
          workItem: {
            id: workItem.id,
            taskId: workItem.taskId,
            title: workItem.title,
            type: workItem.type,
          },
          link: {
            id: link.id,
            seedId: link.seedId,
            workItemId: link.workItemId,
            linkType: link.linkType,
            createdAt: link.createdAt,
          },
        });
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        workItemType: PROMOTABLE_WORK_ITEM_TYPE_SCHEMA,
        title: t.String(),
        description: t.Optional(t.String()),
        priority: t.Optional(PRIORITY_SCHEMA),
        boardId: t.String(),
        boardColumnId: t.Optional(t.Nullable(t.String())),
        projectId: t.String(),
        parentId: t.Optional(t.String()),
        notes: t.Optional(t.String()),
        promotedBy: t.Optional(t.String()),
      }),
    }
  )
  // ── Feedback links ──────────────────────────────────────────────────
  .post(
    "/:id/feedback-links/:feedbackItemId",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const link = await linkFeedbackToSeed(orgId, params.id, params.feedbackItemId, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        set.status = 201;
        return successResponse(link);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), feedbackItemId: t.String() }) }
  )
  .delete(
    "/:id/feedback-links/:feedbackItemId",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const deleted = await unlinkFeedbackFromSeed(orgId, params.id, params.feedbackItemId, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Seed feedback link");
        }
        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), feedbackItemId: t.String() }) }
  )
  // ── Tags CRUD ───────────────────────────────────────────────────────
  .post(
    "/:id/tags",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);

        const item = await getSeedById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Seed");
        }

        let tagId = body.tagId;

        if (!tagId && body.name) {
          const tag = await createTagIfNotExists(orgId, body.name.trim(), body.color);
          tagId = tag.id;
        }

        if (!tagId) {
          throw new Error("TAG_ID_OR_NAME_REQUIRED");
        }

        // Verify tag belongs to workspace
        const existingTag = await getTagById(orgId, tagId);
        if (!existingTag) {
          throw new Error("TAG_NOT_FOUND");
        }

        await addTagToSeed(params.id, tagId);

        const updated = await getSeedById(orgId, params.id);

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "seed:updated",
          payload: { seedId: params.id, changes: { tagAdded: tagId } },
        });

        set.status = 201;
        return successResponse(updated);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        tagId: t.Optional(t.String()),
        name: t.Optional(t.String()),
        color: t.Optional(t.String()),
      }),
    }
  )
  .delete(
    "/:id/tags/:tagId",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);

        const item = await getSeedById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Seed");
        }

        const deleted = await removeTagFromSeed(params.id, params.tagId);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Tag on seed");
        }

        wsConnectionManager.broadcastToWorkspace(orgId, {
          type: "seed:updated",
          payload: { seedId: params.id, changes: { tagRemoved: params.tagId } },
        });

        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), tagId: t.String() }) }
  )
  // ── Comments CRUD ───────────────────────────────────────────────────
  .get(
    "/:id/comments",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        // Verify seed belongs to org
        const item = await getSeedById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Seed");
        }
        const comments = await getEntityComments("seed", params.id);
        return successResponse(comments);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  .post(
    "/:id/comments",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        if (!currentUser?.id) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }
        // Verify seed belongs to org
        const item = await getSeedById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Seed");
        }
        const content = body.content?.trim();
        if (!content) {
          set.status = 400;
          return errorResponse("Comment content is required", 400);
        }
        const comment = await createEntityComment("seed", params.id, currentUser.id, content);

        // Notify seed owner about new comment (fire-and-forget)
        if (item.ownerUserId && currentUser.id !== item.ownerUserId) {
          void enqueueNotification(
            orgId,
            item.ownerUserId,
            "comment",
            `comment:seed:${params.id}:${item.ownerUserId}`,
            {
              seedId: params.id,
              seedTitle: item.title,
              commentContent: content,
              commenterName: (currentUser as { name?: string }).name ?? "Someone",
              commenterId: currentUser.id,
            },
            1
          ).catch(() => {});
        }

        // Trigger in-app + email notifications for mentioned users (fire-and-forget)
        const mentionedUserIds = parseMentionsFromHtml(content);
        if (mentionedUserIds.length > 0) {
          for (const mentionedUserId of mentionedUserIds) {
            void sendMentionNotification({
              mentionedUserId,
              actorUserId: currentUser.id,
              workspaceId: orgId,
              entityType: "seed",
              entityId: params.id,
              entityTitle: item.title,
              link: `/seeds?id=${params.id}`,
            }).catch(() => {});

            if (mentionedUserId === currentUser.id) continue;
            if (mentionedUserId === item.ownerUserId) continue;
            void enqueueNotification(
              orgId,
              mentionedUserId,
              "mention",
              `mention:seed:${params.id}:${mentionedUserId}`,
              {
                seedId: params.id,
                seedTitle: item.title,
                commentContent: content,
                mentionerName: (currentUser as { name?: string }).name ?? "Someone",
                mentionerId: currentUser.id,
                itemLink: `/seeds?id=${params.id}`,
              },
              1
            ).catch(() => {});
          }
        }

        set.status = 201;
        return successResponse(comment);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ content: t.String({ minLength: 1 }) }),
    }
  )
  .patch(
    "/:id/comments/:commentId",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        if (!currentUser?.id) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }
        // Verify seed belongs to org
        const item = await getSeedById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Seed");
        }
        const content = body.content?.trim();
        if (!content) {
          set.status = 400;
          return errorResponse("Comment content is required", 400);
        }

        // Capture existing mentions before update so we only notify NEW mentions
        const previousComments = await getEntityComments("seed", params.id);
        const previousComment = previousComments.find((c) => c.id === params.commentId);
        const previousMentionIds = parseMentionsFromHtml(previousComment?.content ?? "");

        const comment = await updateEntityComment("seed", params.id, params.commentId, currentUser.id, content);
        if (!comment) {
          set.status = 404;
          return notFoundResponse("Comment");
        }

        // Notify only newly added mentions (fire-and-forget)
        const previousSet = new Set(previousMentionIds);
        const newMentions = parseMentionsFromHtml(comment.content).filter((id) => !previousSet.has(id));
        if (newMentions.length > 0) {
          for (const mentionedUserId of newMentions) {
            void sendMentionNotification({
              mentionedUserId,
              actorUserId: currentUser.id,
              workspaceId: orgId,
              entityType: "seed",
              entityId: params.id,
              entityTitle: item.title,
              link: `/seeds?id=${params.id}`,
            }).catch(() => {});

            if (mentionedUserId === currentUser.id) continue;
            if (mentionedUserId === item.ownerUserId) continue;
            void enqueueNotification(
              orgId,
              mentionedUserId,
              "mention",
              `mention:seed:${params.id}:${mentionedUserId}`,
              {
                seedId: params.id,
                seedTitle: item.title,
                commentContent: content,
                mentionerName: (currentUser as { name?: string }).name ?? "Someone",
                mentionerId: currentUser.id,
                itemLink: `/seeds?id=${params.id}`,
              },
              1
            ).catch(() => {});
          }
        }

        return successResponse(comment);
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String(), commentId: t.String() }),
      body: t.Object({ content: t.String({ minLength: 1 }) }),
    }
  )
  .delete(
    "/:id/comments/:commentId",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        if (!currentUser?.id) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }
        // Verify seed belongs to org
        const item = await getSeedById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Seed");
        }
        const deleted = await deleteEntityComment("seed", params.id, params.commentId, currentUser.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Comment");
        }
        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), commentId: t.String() }) }
  )
  // ── GET /:id/traceability — Feedback + work item links ─────────────
  .get(
    "/:id/traceability",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const item = await getSeedById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Seed");
        }
        return successResponse({
          feedbackLinks: item.feedbackLinks,
          workItemLinks: item.workItemLinks,
        });
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  // ── GET /:id/history — Event history ───────────────────────────────
  .get(
    "/:id/history",
    async (ctx) => {
      try {
        const { params, query, set } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        // Verify seed belongs to org
        const item = await getSeedById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Seed");
        }

        const pagination = parsePaginationParams(query);
        const { items, total } = await getSeedEvents(
          orgId,
          params.id,
          pagination,
          { eventType: query.eventType }
        );

        return successResponse(
          items,
          buildPaginationMeta(pagination.page, pagination.limit, total)
        );
      } catch (error) {
        const mapped = mapSeedErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        eventType: t.Optional(t.String()),
      }),
    }
  );
