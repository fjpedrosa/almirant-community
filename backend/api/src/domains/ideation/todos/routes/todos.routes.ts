import { Elysia, t } from "elysia";
import {
  getTodoItems,
  getTodoItemById,
  createTodoItem,
  updateTodoItem,
  deleteTodoItem,
  setTodoItemStatus,
  assignTodoItemOwner,
  setTodoItemDueDate,
  addTagToTodoItem,
  removeTagFromTodoItem,
  createTagIfNotExists,
  getTagById,
  getEntityComments,
  getEntityCommentVersions,
  createEntityComment,
  updateEntityComment,
  deleteEntityComment,
  getEntityEvents,
  enqueueNotification,
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
import { sendMentionNotification } from "../../../../shared/services/notification-service";

const TODO_STATUS_SCHEMA = t.Union([
  t.Literal("pending"),
  t.Literal("in_progress"),
  t.Literal("done"),
  t.Literal("blocked"),
]);

const PRIORITY_SCHEMA = t.Union([
  t.Literal("low"),
  t.Literal("medium"),
  t.Literal("high"),
  t.Literal("urgent"),
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

const mapTodoErrorToHttp = (errorMessage: string): { status: number; message: string } => {
  if (errorMessage === "ACTIVE_ORGANIZATION_NOT_FOUND") {
    return { status: 403, message: "No active organization in session" };
  }
  if (errorMessage === "TODO_ITEM_NOT_FOUND") {
    return { status: 404, message: "Todo item not found" };
  }
  if (errorMessage === "OWNER_NOT_MEMBER") {
    return { status: 400, message: "Selected owner does not belong to active organization" };
  }
  if (errorMessage === "PROJECT_NOT_IN_ORGANIZATION") {
    return { status: 400, message: "Selected project does not belong to active organization" };
  }
  if (errorMessage === "COMMENT_NOT_OWNED") {
    return { status: 403, message: "You can only edit or delete your own comments" };
  }
  return { status: 500, message: errorMessage };
};

export const todosRoutes = new Elysia({ prefix: "/todos" })
  // ── List todos ──────────────────────────────────────────────────────
  .get(
    "/",
    async (ctx) => {
      try {
        const { query } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const pagination = parsePaginationParams(query);
        const { items, total } = await getTodoItems(orgId, pagination, {
          status: query.status,
          priority: query.priority,
          ownerUserId: query.ownerUserId,
          projectId: query.projectId,
          search: query.search,
          dueDate: query.dueDate,
          showAllDone: query.showAllDone === "true",
          sortBy: query.sortBy as "priority" | "createdAt" | "updatedAt" | "dueDate" | undefined,
          sortOrder: query.sortOrder as "asc" | "desc" | undefined,
        });
        return successResponse(items, buildPaginationMeta(pagination.page, pagination.limit, total));
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        status: t.Optional(TODO_STATUS_SCHEMA),
        priority: t.Optional(PRIORITY_SCHEMA),
        ownerUserId: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        search: t.Optional(t.String()),
        dueDate: t.Optional(t.String()),
        showAllDone: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortOrder: t.Optional(t.String()),
      }),
    }
  )
  // ── Get todo by id ──────────────────────────────────────────────────
  .get(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const item = await getTodoItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }
        return successResponse(item);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  // ── Create todo ─────────────────────────────────────────────────────
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

        const item = await createTodoItem(
          orgId,
          {
            projectId: body.projectId ?? null,
            title,
            description: body.description ?? null,
            status: body.status,
            priority: body.priority ?? null,
            ownerUserId: body.ownerUserId ?? null,
            dueDate: body.dueDate ?? null,
            metadata: body.metadata ?? {},
          },
          {
            triggeredBy: currentUser?.id ? "user" : "system",
            triggeredByUserId: currentUser?.id ?? null,
          }
        );

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "todo-item:created",
          payload: { todoItemId: item.id, title: item.title, projectId: item.projectId },
        });

        set.status = 201;
        return successResponse(item);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      body: t.Object({
        projectId: t.Optional(t.Nullable(t.String())),
        title: t.String(),
        description: t.Optional(t.Nullable(t.String())),
        status: t.Optional(TODO_STATUS_SCHEMA),
        priority: t.Optional(t.Nullable(PRIORITY_SCHEMA)),
        ownerUserId: t.Optional(t.Nullable(t.String())),
        dueDate: t.Optional(t.Nullable(t.String())),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
      }),
    }
  )
  // ── Update todo ─────────────────────────────────────────────────────
  .patch(
    "/:id",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await updateTodoItem(
          orgId,
          params.id,
          {
            projectId: body.projectId,
            title: body.title,
            description: body.description,
            status: body.status,
            priority: body.priority,
            ownerUserId: body.ownerUserId,
            dueDate: body.dueDate,
            metadata: body.metadata,
          },
          {
            triggeredBy: currentUser?.id ? "user" : "system",
            triggeredByUserId: currentUser?.id ?? null,
          }
        );

        if (!updated) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "todo-item:updated",
          payload: { todoItemId: params.id, changes: body as Record<string, unknown> },
        });

        return successResponse(updated);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        projectId: t.Optional(t.Nullable(t.String())),
        title: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
        status: t.Optional(TODO_STATUS_SCHEMA),
        priority: t.Optional(t.Nullable(PRIORITY_SCHEMA)),
        ownerUserId: t.Optional(t.Nullable(t.String())),
        dueDate: t.Optional(t.Nullable(t.String())),
        metadata: t.Optional(t.Record(t.String(), t.Any())),
      }),
    }
  )
  // ── Delete todo ─────────────────────────────────────────────────────
  .delete(
    "/:id",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const deleted = await deleteTodoItem(orgId, params.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "todo-item:deleted",
          payload: { todoItemId: params.id },
        });

        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String() }) }
  )
  // ── Set status ──────────────────────────────────────────────────────
  .patch(
    "/:id/status",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await setTodoItemStatus(orgId, params.id, body.status, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "todo-item:updated",
          payload: { todoItemId: params.id, changes: { status: body.status } },
        });

        return successResponse(updated);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ status: TODO_STATUS_SCHEMA }),
    }
  )
  // ── Assign owner ────────────────────────────────────────────────────
  .patch(
    "/:id/owner",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await assignTodoItemOwner(orgId, params.id, body.ownerUserId ?? null, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "todo-item:updated",
          payload: { todoItemId: params.id, changes: { ownerUserId: body.ownerUserId } },
        });

        return successResponse(updated);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ ownerUserId: t.Nullable(t.String()) }),
    }
  )
  // ── Set due date ────────────────────────────────────────────────────
  .patch(
    "/:id/due-date",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        const currentUser = (ctx as { user?: { id?: string } }).user;
        const updated = await setTodoItemDueDate(orgId, params.id, body.dueDate ?? null, {
          triggeredBy: currentUser?.id ? "user" : "system",
          triggeredByUserId: currentUser?.id ?? null,
        });
        if (!updated) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "todo-item:updated",
          payload: { todoItemId: params.id, changes: { dueDate: body.dueDate } },
        });

        return successResponse(updated);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ dueDate: t.Nullable(t.String()) }),
    }
  )
  // ── Add tag ────────────────────────────────────────────────────────
  .post(
    "/:id/tags",
    async (ctx) => {
      try {
        const { params, body, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);

        const item = await getTodoItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }

        let tagId = body.tagId;

        if (!tagId && body.name) {
          const tag = await createTagIfNotExists(orgId, body.name.trim(), body.color);
          tagId = tag.id;
        }

        if (!tagId) {
          set.status = 400;
          return errorResponse("Either tagId or name is required", 400);
        }

        // Verify tag belongs to organization
        const existingTag = await getTagById(orgId, tagId);
        if (!existingTag) {
          set.status = 404;
          return errorResponse("Tag not found", 404);
        }

        await addTagToTodoItem(params.id, tagId);

        const updated = await getTodoItemById(orgId, params.id);

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "todo-item:updated",
          payload: { todoItemId: params.id, changes: { tagAdded: tagId } },
        });

        set.status = 201;
        return successResponse(updated);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
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
  // ── Remove tag ────────────────────────────────────────────────────
  .delete(
    "/:id/tags/:tagId",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);

        const item = await getTodoItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }

        const deleted = await removeTagFromTodoItem(params.id, params.tagId);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Tag on todo item");
        }

        wsConnectionManager.broadcastToOrganization(orgId, {
          type: "todo-item:updated",
          payload: { todoItemId: params.id, changes: { tagRemoved: params.tagId } },
        });

        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), tagId: t.String() }) }
  )
  // ── List comments ───────────────────────────────────────────────────
  .get(
    "/:id/comments",
    async (ctx) => {
      try {
        const { params, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        // Verify todo belongs to org
        const item = await getTodoItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }
        const comments = await getEntityComments("todo", params.id);
        return successResponse(comments);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
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
        const item = await getTodoItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }

        const comments = await getEntityComments("todo", params.id);
        const commentExists = comments.some((comment) => comment.id === params.commentId);
        if (!commentExists) {
          set.status = 404;
          return notFoundResponse("Comment");
        }

        const versions = await getEntityCommentVersions("todo", params.id, params.commentId);
        return successResponse(versions);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), commentId: t.String() }) }
  )
  // ── Create comment ──────────────────────────────────────────────────
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
        // Verify todo belongs to org
        const item = await getTodoItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }
        const content = body.content?.trim();
        if (!content) {
          set.status = 400;
          return errorResponse("Comment content is required", 400);
        }
        const comment = await createEntityComment("todo", params.id, currentUser.id, content);

        const mentionedUserIds = parseMentionsFromHtml(comment.content);
        if (mentionedUserIds.length > 0) {
          for (const mentionedUserId of mentionedUserIds) {
            void sendMentionNotification({
              mentionedUserId,
              actorUserId: currentUser.id,
              organizationId: orgId,
              entityType: "todo_item",
              entityId: params.id,
              entityTitle: item.title,
              link: `/todos?todoId=${params.id}`,
            }).catch(() => {});

            if (mentionedUserId === currentUser.id) continue;
            void enqueueNotification(
              orgId,
              mentionedUserId,
              "mention",
              `mention:todo:${params.id}:${mentionedUserId}`,
              {
                ideaItemId: params.id,
                ideaItemTitle: item.title,
                commentContent: content,
                mentionerName: (currentUser as { name?: string }).name ?? "Someone",
                mentionerId: currentUser.id,
                itemLink: `/todos?todoId=${params.id}`,
              },
              1,
            ).catch(() => {});
          }
        }

        set.status = 201;
        return successResponse(comment);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ content: t.String({ minLength: 1 }) }),
    }
  )
  // ── Update comment ──────────────────────────────────────────────────
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
        // Verify todo belongs to org
        const item = await getTodoItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }
        const content = body.content?.trim();
        if (!content) {
          set.status = 400;
          return errorResponse("Comment content is required", 400);
        }
        const previousComments = await getEntityComments("todo", params.id);
        const previousComment = previousComments.find((candidate) => candidate.id === params.commentId);
        const previousMentionIds = parseMentionsFromHtml(previousComment?.content ?? "");
        const comment = await updateEntityComment("todo", params.id, params.commentId, currentUser.id, content);
        if (!comment) {
          set.status = 404;
          return notFoundResponse("Comment");
        }

        const previousSet = new Set(previousMentionIds);
        const newMentions = parseMentionsFromHtml(comment.content).filter((id) => !previousSet.has(id));
        if (newMentions.length > 0) {
          for (const mentionedUserId of newMentions) {
            void sendMentionNotification({
              mentionedUserId,
              actorUserId: currentUser.id,
              organizationId: orgId,
              entityType: "todo_item",
              entityId: params.id,
              entityTitle: item.title,
              link: `/todos?todoId=${params.id}`,
            }).catch(() => {});

            if (mentionedUserId === currentUser.id) continue;
            void enqueueNotification(
              orgId,
              mentionedUserId,
              "mention",
              `mention:todo:${params.id}:${mentionedUserId}`,
              {
                ideaItemId: params.id,
                ideaItemTitle: item.title,
                commentContent: content,
                mentionerName: (currentUser as { name?: string }).name ?? "Someone",
                mentionerId: currentUser.id,
                itemLink: `/todos?todoId=${params.id}`,
              },
              1,
            ).catch(() => {});
          }
        }

        return successResponse(comment);
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String(), commentId: t.String() }),
      body: t.Object({ content: t.String({ minLength: 1 }) }),
    }
  )
  // ── Delete comment ──────────────────────────────────────────────────
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
        // Verify todo belongs to org
        const item = await getTodoItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }
        const deleted = await deleteEntityComment("todo", params.id, params.commentId, currentUser.id);
        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Comment");
        }
        return successResponse({ deleted: true });
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    { params: t.Object({ id: t.String(), commentId: t.String() }) }
  )
  // ── History (entity events) ─────────────────────────────────────────
  .get(
    "/:id/history",
    async (ctx) => {
      try {
        const { params, query, set } = ctx;
        const orgId = getOrganizationIdFromContext(ctx);
        // Verify todo belongs to org
        const item = await getTodoItemById(orgId, params.id);
        if (!item) {
          set.status = 404;
          return notFoundResponse("Todo item");
        }

        const pagination = parsePaginationParams(query);
        const { items, total } = await getEntityEvents(
          "todo",
          params.id,
          pagination,
          { eventType: query.eventType }
        );

        return successResponse(
          items,
          buildPaginationMeta(pagination.page, pagination.limit, total)
        );
      } catch (error) {
        const mapped = mapTodoErrorToHttp(normalizeErrorMessage(error));
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
