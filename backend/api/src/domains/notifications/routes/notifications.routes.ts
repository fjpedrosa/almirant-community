import { Elysia, t } from "elysia";
import {
  getNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getNotificationPreferences,
  upsertNotificationPreference,
} from "@almirant/database";
import {
  buildPaginationMeta,
  errorResponse,
  parsePaginationParams,
  successResponse,
} from "../../../shared/services/response";
import { wsConnectionManager } from "../../../shared/ws/ws-connection-manager";

const normalizeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

const getWorkspaceIdFromContext = (ctx: unknown): string => {
  const activeWorkspace = (ctx as { activeWorkspace?: { id?: string } }).activeWorkspace;
  if (!activeWorkspace?.id) {
    throw new Error("ACTIVE_WORKSPACE_NOT_FOUND");
  }
  return activeWorkspace.id;
};

const getUserIdFromContext = (ctx: unknown): string => {
  const currentUser = (ctx as { user?: { id?: string } }).user;
  if (!currentUser?.id) {
    throw new Error("AUTH_REQUIRED");
  }
  return currentUser.id;
};

const mapNotificationErrorToHttp = (errorMessage: string): { status: number; message: string } => {
  if (errorMessage === "ACTIVE_WORKSPACE_NOT_FOUND") {
    return { status: 403, message: "No active workspace in session" };
  }
  if (errorMessage === "AUTH_REQUIRED") {
    return { status: 401, message: "Authentication required" };
  }
  return { status: 500, message: errorMessage };
};

export const notificationsRoutes = new Elysia({ prefix: "/notifications" })
  // GET / -- list notifications (paginated, filterable)
  .get(
    "/",
    async (ctx) => {
      try {
        const { query } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const userId = getUserIdFromContext(ctx);
        const pagination = parsePaginationParams(query);

        const filters: { type?: string; isRead?: boolean } = {};
        if (query.type) {
          filters.type = query.type;
        }
        if (query.isRead !== undefined) {
          filters.isRead = query.isRead === "true";
        }

        const { items, total } = await getNotifications(userId, orgId, filters, pagination);

        return successResponse(items, buildPaginationMeta(pagination.page, pagination.limit, total));
      } catch (error) {
        const mapped = mapNotificationErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        type: t.Optional(t.String()),
        isRead: t.Optional(t.String()),
      }),
    }
  )
  // GET /unread-count -- efficient count of unread notifications
  .get(
    "/unread-count",
    async (ctx) => {
      try {
        const orgId = getWorkspaceIdFromContext(ctx);
        const userId = getUserIdFromContext(ctx);
        const count = await getUnreadCount(userId, orgId);
        return successResponse({ count });
      } catch (error) {
        const mapped = mapNotificationErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    }
  )
  // PATCH /:id/read -- mark a single notification as read
  .patch(
    "/:id/read",
    async (ctx) => {
      try {
        const { params } = ctx;
        const userId = getUserIdFromContext(ctx);
        const updated = await markNotificationAsRead(params.id, userId);
        if (!updated) {
          ctx.set.status = 404;
          return errorResponse("Notification not found or not owned by user", 404);
        }
        wsConnectionManager.sendToUser(userId, {
          type: "notification:read",
          payload: { notificationId: params.id },
        });
        return successResponse({ updated: true });
      } catch (error) {
        const mapped = mapNotificationErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )
  // PATCH /read-all -- mark all notifications as read for the current user
  .patch(
    "/read-all",
    async (ctx) => {
      try {
        const orgId = getWorkspaceIdFromContext(ctx);
        const userId = getUserIdFromContext(ctx);
        const count = await markAllNotificationsAsRead(userId, orgId);
        wsConnectionManager.sendToUser(userId, {
          type: "notification:read-all",
          payload: {},
        });
        return successResponse({ updated: count });
      } catch (error) {
        const mapped = mapNotificationErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    }
  )
  // GET /preferences -- list notification preferences for the current user
  .get(
    "/preferences",
    async (ctx) => {
      try {
        const orgId = getWorkspaceIdFromContext(ctx);
        const userId = getUserIdFromContext(ctx);
        const preferences = await getNotificationPreferences(userId, orgId);
        return successResponse(preferences);
      } catch (error) {
        const mapped = mapNotificationErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    }
  )
  // PATCH /preferences -- upsert a notification preference
  .patch(
    "/preferences",
    async (ctx) => {
      try {
        const { body } = ctx;
        const orgId = getWorkspaceIdFromContext(ctx);
        const userId = getUserIdFromContext(ctx);
        const preference = await upsertNotificationPreference(
          userId,
          orgId,
          body.notificationType,
          body.inAppEnabled,
          body.emailEnabled
        );
        return successResponse(preference);
      } catch (error) {
        const mapped = mapNotificationErrorToHttp(normalizeErrorMessage(error));
        ctx.set.status = mapped.status;
        return errorResponse(mapped.message, mapped.status);
      }
    },
    {
      body: t.Object({
        notificationType: t.String(),
        inAppEnabled: t.Boolean(),
        emailEnabled: t.Boolean(),
      }),
    }
  );
