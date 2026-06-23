import { Elysia, t } from "elysia";
import {
  getOrCreateEmailNotificationSettings,
  upsertEmailNotificationSettings,
} from "@almirant/database";
import { successResponse, errorResponse } from "../../../shared/services/response";

export const emailNotificationsRoutes = new Elysia({ prefix: "/email-notifications" })
  // -------------------------------------------------------
  // GET /email-notifications/settings - Get email notification preferences for current user
  // -------------------------------------------------------
  .get("/settings", async (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
    if (!user) {
      ctx.set.status = 401;
      return errorResponse("Unauthorized", 401);
    }

    try {
      const settings = await getOrCreateEmailNotificationSettings(user.id);
      return successResponse(settings);
    } catch (err) {
      ctx.set.status = 500;
      return errorResponse(
        err instanceof Error ? err.message : "Failed to fetch email notification settings",
        500
      );
    }
  })

  // -------------------------------------------------------
  // PUT /email-notifications/settings - Update email notification preferences for current user
  // -------------------------------------------------------
  .put(
    "/settings",
    async ({ body, set, ...ctx }) => {
      const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      try {
        const updated = await upsertEmailNotificationSettings(user.id, body);
        return successResponse(updated);
      } catch (err) {
        set.status = 500;
        return errorResponse(
          err instanceof Error ? err.message : "Failed to update email notification settings",
          500
        );
      }
    },
    {
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        notifyWorkItemMoved: t.Optional(t.Boolean()),
        notifyWorkItemAssigned: t.Optional(t.Boolean()),
        notifyWorkItemDone: t.Optional(t.Boolean()),
        notifyReviewCompleted: t.Optional(t.Boolean()),
        notifySprintClosed: t.Optional(t.Boolean()),
        notifyUserActions: t.Optional(t.Boolean()),
      }),
    }
  );
