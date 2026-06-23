import { Elysia, t } from "elysia";
import {
  addTagToIdeaItem,
  assignIdeaItemOwner,
  createIdeaItem,
  createIdeaItemComment,
  createTagIfNotExists,
  createWorkItem,
  deleteIdeaItem,
  deleteIdeaItemComment,
  enqueueNotification,
  getMembersByOrganizationId,
  getCommentMentionUserIds,
  getCommentsByIdeaItem,
  getIdeaItemCommentVersions,
  getIdeaItemById,
  getIdeaItemEventsByIdeaItemId,
  getIdeaItemTraceability,
  getIdeaItems,
  getTagById,
  linkFeedbackToIdeaItem,
  linkWorkItemToIdeaItem,
  removeTagFromIdeaItem,
  setIdeaItemDueDate,
  setIdeaItemStatus,
  toggleIdeaItemDiscussed,
  unlinkFeedbackFromIdeaItem,
  updateIdeaItem,
  updateIdeaItemComment,
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

const IDEA_ITEM_TYPE_SCHEMA = t.Literal("idea");
const IDEA_ITEM_STATUS_SCHEMA = t.Union([
  t.Literal("draft"),
  t.Literal("active"),
  t.Literal("to_review"),
  t.Literal("approved"),
  t.Literal("archived"),
  t.Literal("rejected"),
  t.Literal("pending"),
  t.Literal("done"),
  t.Literal("blocked"),
]);

const PROMOTABLE_WORK_ITEM_TYPE_SCHEMA = t.Union([
  t.Literal("epic"),
  t.Literal("feature"),
  t.Literal("story"),
  t.Literal("task"),
]);

const normalizeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

const getOrganizationIdFromContext = (ctx: unknown): string => {
  const activeOrganization = (ctx as { activeOrganization?: { id?: string } }).activeOrganization;
  if (!activeOrganization?.id) {
    throw new Error("ACTIVE_ORGANIZATION_NOT_FOUND");
  }
  return activeOrganization.id;
};

const mapIdeaErrorToHttp = (errorMessage: string): { status: number; message: string } => {
  if (errorMessage === "ACTIVE_ORGANIZATION_NOT_FOUND") {
    return { status: 403, message: "No active organization in session" };
  }
  if (errorMessage === "IDEA_ITEM_NOT_FOUND") {
    return { status: 404, message: "Idea item not found" };
  }
  if (errorMessage === "OWNER_NOT_MEMBER") {
    return { status: 400, message: "Selected owner does not belong to active organization" };
  }
  if (errorMessage === "INVALID_STATUS_FOR_TYPE") {
    return { status: 400, message: "Invalid status for the selected idea item type" };
  }
  if (errorMessage === "INVALID_IDEA_ITEM_TYPE") {
    return { status: 400, message: "Invalid idea item type. Allowed types: idea" };
  }
  if (errorMessage === "WORK_ITEM_NOT_FOUND") {
    return { status: 404, message: "Work item not found" };
  }
  if (errorMessage === "FEEDBACK_NOT_FOUND") {
    return { status: 404, message: "Feedback item not found" };
  }
  if (errorMessage === "PROJECT_NOT_IN_ORGANIZATION") {
    return { status: 400, message: "Selected project does not belong to active organization" };
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
  return { status: 500, message: errorMessage };
};

export const ideasRoutes = new Elysia({ prefix: "/ideas/items" })
  .get(
    "/",
    async (ctx) => {
      try {
        const { query } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const pagination = parsePaginationParams(query);
        const { items, total } = await getIdeaItems(orgId, pagination, {
          type: query.type,
          status: query.status,
          ownerUserId: query.ownerUserId,
          projectId: query.projectId,
          search: query.search,
          dueDate: query.dueDate,
          discussed: query.discussed === "true" ? true : query.discussed === "false" ? false : undefined,
          showAllDone: query.showAllDone === "true",
          mentionedUserId: query.mentionedUserId,
          tagIds: query.tagIds ?? query.tagId,
          sortBy: query.sortBy as "createdAt" | "updatedAt" | "dueDate" | undefined,
          sortOrder: query.sortOrder as "asc" | "desc" | undefined,
        });
        return successResponse(items, buildPaginationMeta(pagination.page, pagination.limit, total));
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        type: t.Optional(IDEA_ITEM_TYPE_SCHEMA),
        status: t.Optional(IDEA_ITEM_STATUS_SCHEMA),
        ownerUserId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        search: t.Optional(t.String()),
        dueDate: t.Optional(t.String()),
        discussed: t.Optional(t.String()),
        showAllDone: t.Optional(t.String()),
        mentionedUserId: t.Optional(t.String()),
        tagIds: t.Optional(t.String()),
        tagId: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortOrder: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const item = await getIdeaItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }
        return successResponse(item);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  .post(
    "/",
    async (ctx) => {
      try {
        const { body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const title = body.title?.trim();
        if (!title) {
          set.status = 400;
          return errorResponse("Title is required", 400);
        }

        const item = await createIdeaItem(orgId, {
          projectId: body.projectId ?? null,
          type: body.type,
          status: body.status,
          title,
          description: body.description ?? null,
          ownerUserId: body.ownerUserId ?? null,
          dueDate: body.dueDate ?? null,
          metadata: body.metadata ?? {},
        }, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-item:created",
          payload: { ideaItemId: item.id, type: item.type, title: item.title, projectId: item.projectId },
        });

        const members = await getMembersByOrganizationId(orgId);
        const creatorUserId = currentUser?.id ?? item.createdByUserId ?? null;
        const creatorName = (currentUser as { name?: string } | undefined)?.name ?? "Un miembro del equipo";
        const notificationParams = members
          .filter((member) => member.userId !== creatorUserId)
          .map((member) => ({
            recipientUserId: member.userId,
            organizationId: orgId,
            type: "assignment" as const,
            title: "Nueva idea creada",
            body: `${creatorName} creó idea: ${item.title}`,
            link: `/ideas?id=${item.id}`,
            sourceEntityType: "idea_item",
            sourceEntityId: item.id,
            actorUserId: creatorUserId,
            metadata: {
              ideaItemId: item.id,
              ideaItemType: item.type,
              ideaItemTitle: item.title,
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
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      body: t.Object({
        projectId: t.Optional(t.Nullable(t.String())),
        type: IDEA_ITEM_TYPE_SCHEMA,
        status: t.Optional(IDEA_ITEM_STATUS_SCHEMA),
        title: t.String(),
        description: t.Optional(t.Nullable(t.String())),
        ownerUserId: t.Optional(t.Nullable(t.String())),
        dueDate: t.Optional(t.Nullable(t.String())),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
      }),
    }
  )
  .patch(
    "/:id",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await updateIdeaItem(orgId, params.id, {
          projectId: body.projectId,
          type: body.type,
          status: body.status,
          title: body.title,
          description: body.description,
          ownerUserId: body.ownerUserId,
          dueDate: body.dueDate,
          metadata: body.metadata,
          discussed: body.discussed,
        }, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });

        if (!updated) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: body as Record<string, unknown> },
        });

        // Enqueue email notification if ownerUserId changed (fire-and-forget)
        if (body.ownerUserId && currentUser?.id && currentUser.id !== body.ownerUserId) {
          void enqueueNotification(
            orgId,
            body.ownerUserId,
            "assignment",
            `assignment:${body.ownerUserId}`,
            {
              ideaItemId: params.id,
              ideaItemTitle: updated.title,
              assignerName: (currentUser as { name?: string }).name ?? "Someone",
              assignerId: currentUser.id,
            },
            10
          ).catch(() => {});
        }

        return successResponse(updated);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        projectId: t.Optional(t.Nullable(t.String())),
        type: t.Optional(IDEA_ITEM_TYPE_SCHEMA),
        status: t.Optional(IDEA_ITEM_STATUS_SCHEMA),
        title: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
        ownerUserId: t.Optional(t.Nullable(t.String())),
        dueDate: t.Optional(t.Nullable(t.String())),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
        discussed: t.Optional(t.Boolean()),
      }),
    }
  )
  .delete(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const deleted = await deleteIdeaItem(orgId, params.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-item:deleted",
          payload: { ideaItemId: params.id },
        });

        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  .patch(
    "/:id/status",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await setIdeaItemStatus(orgId, params.id, body.status, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { status: body.status } },
        });

        return successResponse(updated);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ status: IDEA_ITEM_STATUS_SCHEMA }),
    }
  )
  .patch(
    "/:id/owner",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await assignIdeaItemOwner(orgId, params.id, body.ownerUserId ?? null, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { ownerUserId: body.ownerUserId } },
        });

        // Enqueue email notification for assignment (fire-and-forget)
        if (body.ownerUserId && currentUser?.id && currentUser.id !== body.ownerUserId) {
          void enqueueNotification(
            orgId,
            body.ownerUserId,
            "assignment",
            `assignment:${body.ownerUserId}`,
            {
              ideaItemId: params.id,
              ideaItemTitle: updated.title,
              assignerName: (currentUser as { name?: string }).name ?? "Someone",
              assignerId: currentUser.id,
            },
            10
          ).catch(() => {});
        }

        return successResponse(updated);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ ownerUserId: t.Nullable(t.String()) }),
    }
  )
  .patch(
    "/:id/due-date",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await setIdeaItemDueDate(orgId, params.id, body.dueDate ?? null, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { dueDate: body.dueDate } },
        });

        return successResponse(updated);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ dueDate: t.Nullable(t.String()) }),
    }
  )
  .patch(
    "/:id/discussed",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await toggleIdeaItemDiscussed(orgId, params.id, body.discussed, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { discussed: body.discussed } },
        });

        return successResponse(updated);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ discussed: t.Boolean() }),
    }
  )
  .post(
    "/:id/promote",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const source = await getIdeaItemById(orgId, params.id);
        if (!source) {
          set.status = 404;
          return notFoundResponse("Idea item");
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
            promotedFromIdeaItem: params.id,
          },
        });

        const link = await linkWorkItemToIdeaItem(
          orgId,
          params.id,
          workItem.id,
          "promoted_to",
          body.promotedBy ?? null,
          {
            notes: body.notes ?? null,
          },
          {
            triggeredBy: body.promotedBy ? "user" : "system",
            triggeredByUserId: body.promotedBy ?? null,
          }
        );

        wsConnectionManager.broadcastToOrganization(orgId, {
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
            type: source.type,
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
            ideaItemId: link.ideaItemId,
            workItemId: link.workItemId,
            linkType: link.linkType,
            createdAt: link.createdAt,
          },
        });
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
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
        priority: t.Optional(
          t.Union([
            t.Literal("low"),
            t.Literal("medium"),
            t.Literal("high"),
            t.Literal("urgent"),
          ])
        ),
        boardId: t.String(),
        boardColumnId: t.Optional(t.Nullable(t.String())),
        projectId: t.String(),
        parentId: t.Optional(t.String()),
        notes: t.Optional(t.String()),
        promotedBy: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/:id/history",
    async (ctx) => {
      try {
        const { params, query, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const item = await getIdeaItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        const pagination = parsePaginationParams(query);
        const { items, total } = await getIdeaItemEventsByIdeaItemId(
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
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
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
  )
  .get(
    "/:id/traceability",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const traceability = await getIdeaItemTraceability(orgId, params.id);
        if (!traceability) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }
        return successResponse(traceability);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )
  .post(
    "/:id/feedback-links/:feedbackItemId",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const link = await linkFeedbackToIdeaItem(
          orgId,
          params.id,
          params.feedbackItemId,
          body.metadata ?? {},
          {
            triggeredBy: currentUser?.id ? "user" : "system",
            triggeredByUserId: currentUser?.id ?? null,
          }
        );
        set.status = 201;
        return successResponse(link);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String(), feedbackItemId: t.String() }),
      body: t.Object({
        metadata: t.Optional(t.Record(t.String(), t.Any())),
      }),
    }
  )
  .delete(
    "/:id/feedback-links/:feedbackItemId",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const deleted = await unlinkFeedbackFromIdeaItem(
          orgId,
          params.id,
          params.feedbackItemId,
          {
            triggeredBy: currentUser?.id ? "user" : "system",
            triggeredByUserId: currentUser?.id ?? null,
          }
        );
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Idea item feedback link");
        }
        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), feedbackItemId: t.String() }) }
  )
  // ── Tags CRUD ──
  .post(
    "/:id/tags",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);

        const item = await getIdeaItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        let tagId = body.tagId;

        if (!tagId && body.name) {
          const tag = await createTagIfNotExists(orgId, body.name.trim(), body.color);
          tagId = tag.id;
        }

        if (!tagId) {
          throw new Error("TAG_ID_OR_NAME_REQUIRED");
        }

        // Verify tag belongs to organization
        const existingTag = await getTagById(orgId, tagId);
        if (!existingTag) {
          throw new Error("TAG_NOT_FOUND");
        }

        await addTagToIdeaItem(params.id, tagId);

        const updated = await getIdeaItemById(orgId, params.id);

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { tagAdded: tagId } },
        });

        set.status = 201;
        return successResponse(updated);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
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
        const orgId = getOrganizationIdFromContext(ctx);

        const item = await getIdeaItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        const deleted = await removeTagFromIdeaItem(params.id, params.tagId);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Tag on idea item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-item:updated",
          payload: { ideaItemId: params.id, changes: { tagRemoved: params.tagId } },
        });

        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), tagId: t.String() }) }
  )
  // ── Comments CRUD ──
  .get(
    "/:id/comments",
    async (ctx) => {
      try {
        const { params } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const comments = await getCommentsByIdeaItem(orgId, params.id);
        return successResponse(comments);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  .get(
    "/:id/comments/:commentId/history",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const ideaItem = await getIdeaItemById(orgId, params.id);
        if (!ideaItem) {
          set.status = 404;
          return notFoundResponse("Idea item");
        }

        const comments = await getCommentsByIdeaItem(orgId, params.id);
        const commentExists = comments.some((comment) => comment.id === params.commentId);
        if (!commentExists) {
          set.status = 404;
          return notFoundResponse("Comment");
        }

        const versions = await getIdeaItemCommentVersions(orgId, params.id, params.commentId);
        return successResponse(versions);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), commentId: t.String() }) }
  )
  .post(
    "/:id/comments",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        if (!currentUser?.id) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }
        const content = body.content?.trim();
        if (!content) {
          set.status = 400;
          return errorResponse("Comment content is required", 400);
        }
        const comment = await createIdeaItemComment(orgId, params.id, currentUser.id, content);

        // Enqueue email notification to idea item owner (fire-and-forget)
        const ideaItem = await getIdeaItemById(orgId, params.id);
        if (
          ideaItem?.ownerUserId &&
          currentUser.id !== ideaItem.ownerUserId
        ) {
          void enqueueNotification(
            orgId,
            ideaItem.ownerUserId,
            "comment",
            `comment:${params.id}:${ideaItem.ownerUserId}`,
            {
              ideaItemId: params.id,
              ideaItemTitle: ideaItem.title,
              commentContent: content,
              commenterName: (currentUser as { name?: string }).name ?? "Someone",
              commenterId: currentUser.id,
            },
            1
          ).catch(() => {});
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-comment:created",
          payload: { ideaItemId: params.id, commentId: comment.id },
        });

        // Trigger in-app notifications for mentioned users (fire-and-forget)
        if (comment.mentionedUserIds.length > 0 && ideaItem) {
          for (const mentionedUserId of comment.mentionedUserIds) {
            void sendMentionNotification({
              mentionedUserId,
              actorUserId: currentUser.id,
              organizationId: orgId,
              entityType: "idea_item",
              entityId: params.id,
              entityTitle: ideaItem.title,
              link: `/ideas?id=${params.id}`,
            }).catch(() => {});
          }

          // Queue mention email notifications (fire-and-forget)
          for (const mentionedUserId of comment.mentionedUserIds) {
            if (mentionedUserId === currentUser.id) continue;
            if (mentionedUserId === ideaItem.ownerUserId) continue;
            void enqueueNotification(
              orgId,
              mentionedUserId,
              "mention",
              `mention:${params.id}:${mentionedUserId}`,
              {
                ideaItemId: params.id,
                ideaItemTitle: ideaItem.title,
                commentContent: content,
                mentionerName: (currentUser as { name?: string }).name ?? "Someone",
                mentionerId: currentUser.id,
                itemLink: `/ideas?id=${params.id}`,
              },
              1
            ).catch(() => {});
          }
        }

        set.status = 201;
        return successResponse(comment);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
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
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        if (!currentUser?.id) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }
        const content = body.content?.trim();
        if (!content) {
          set.status = 400;
          return errorResponse("Comment content is required", 400);
        }
        // Capture existing mentions before update so we only notify NEW mentions
        const previousMentionIds = await getCommentMentionUserIds(params.commentId);

        const comment = await updateIdeaItemComment(orgId, params.commentId, currentUser.id, content);
        if (!comment) {
          set.status = 404;
          return notFoundResponse("Comment");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-comment:updated",
          payload: { ideaItemId: params.id, commentId: params.commentId },
        });

        // Notify only newly added mentions (fire-and-forget)
        const previousSet = new Set(previousMentionIds);
        const newMentions = comment.mentionedUserIds.filter((id) => !previousSet.has(id));
        if (newMentions.length > 0) {
          const ideaItem = await getIdeaItemById(orgId, params.id);
          if (ideaItem) {
            for (const mentionedUserId of newMentions) {
              void sendMentionNotification({
                mentionedUserId,
                actorUserId: currentUser.id,
                organizationId: orgId,
                entityType: "idea_item",
                entityId: params.id,
                entityTitle: ideaItem.title,
                link: `/ideas?id=${params.id}`,
              }).catch(() => {});
            }

            // Queue mention email notifications for new mentions (fire-and-forget)
            for (const mentionedUserId of newMentions) {
              if (mentionedUserId === currentUser.id) continue;
              if (mentionedUserId === ideaItem.ownerUserId) continue;
              void enqueueNotification(
                orgId,
                mentionedUserId,
                "mention",
                `mention:${params.id}:${mentionedUserId}`,
                {
                  ideaItemId: params.id,
                  ideaItemTitle: ideaItem.title,
                  commentContent: content,
                  mentionerName: (currentUser as { name?: string }).name ?? "Someone",
                  mentionerId: currentUser.id,
                  itemLink: `/ideas?id=${params.id}`,
                },
                1
              ).catch(() => {});
            }
          }
        }

        return successResponse(comment);
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
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
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        if (!currentUser?.id) {
          set.status = 401;
          return errorResponse("Authentication required", 401);
        }
        const deleted = await deleteIdeaItemComment(orgId, params.commentId, currentUser.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Comment");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "idea-comment:deleted",
          payload: { ideaItemId: params.id, commentId: params.commentId },
        });

        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapIdeaErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), commentId: t.String() }) }
  );
