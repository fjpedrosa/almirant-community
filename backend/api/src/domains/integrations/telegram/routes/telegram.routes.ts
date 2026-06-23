import { Elysia, t } from "elysia";
import {
  createTelegramLinkCode,
  getTelegramAccountByUserId,
  getOrCreateTelegramNotificationSettings,
  unlinkTelegramAccount,
  upsertTelegramNotificationSettings,
} from "@almirant/database";
import { successResponse, errorResponse } from "../../../../shared/services/response";

export const telegramRoutes = new Elysia({ prefix: "/telegram" })
  // -------------------------------------------------------
  // GET /telegram/status - Get Telegram link status for current user
  // -------------------------------------------------------
  .get("/status", async (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
    if (!user) {
      ctx.set.status = 401;
      return errorResponse("Unauthorized", 401);
    }

    try {
      const account = await getTelegramAccountByUserId(user.id);
      return successResponse({
        linked: Boolean(account),
        account: account
          ? {
              chatId: account.chatId,
              username: account.username,
              firstName: account.firstName,
              lastName: account.lastName,
              linkedAt: account.linkedAt,
            }
          : null,
      });
    } catch (err) {
      ctx.set.status = 500;
      return errorResponse(err instanceof Error ? err.message : "Failed to fetch Telegram status", 500);
    }
  })

  // -------------------------------------------------------
  // POST /telegram/link-code - Generate a short-lived linking code
  // -------------------------------------------------------
  .post("/link-code", async (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
    if (!user) {
      ctx.set.status = 401;
      return errorResponse("Unauthorized", 401);
    }

    try {
      const result = await createTelegramLinkCode(user.id);
      return successResponse(result);
    } catch (err) {
      ctx.set.status = 500;
      return errorResponse(err instanceof Error ? err.message : "Failed to generate link code", 500);
    }
  })

  // -------------------------------------------------------
  // POST /telegram/unlink - Unlink Telegram account from current user
  // -------------------------------------------------------
  .post("/unlink", async (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
    if (!user) {
      ctx.set.status = 401;
      return errorResponse("Unauthorized", 401);
    }

    try {
      const deleted = await unlinkTelegramAccount(user.id);
      return successResponse({ unlinked: Boolean(deleted) });
    } catch (err) {
      ctx.set.status = 500;
      return errorResponse(err instanceof Error ? err.message : "Failed to unlink Telegram account", 500);
    }
  }, { body: t.Optional(t.Object({})) })

  // -------------------------------------------------------
  // GET /telegram/notifications - Get Telegram notification preferences for current user
  // -------------------------------------------------------
  .get("/notifications", async (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
    if (!user) {
      ctx.set.status = 401;
      return errorResponse("Unauthorized", 401);
    }

    try {
      const settings = await getOrCreateTelegramNotificationSettings(user.id);
      return successResponse(settings);
    } catch (err) {
      ctx.set.status = 500;
      return errorResponse(
        err instanceof Error ? err.message : "Failed to fetch notification settings",
        500
      );
    }
  })

  // -------------------------------------------------------
  // PUT /telegram/notifications - Update Telegram notification preferences for current user
  // -------------------------------------------------------
  .put(
    "/notifications",
    async ({ body, set, ...ctx }) => {
      const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      try {
        const updated = await upsertTelegramNotificationSettings(user.id, body);
        return successResponse(updated);
      } catch (err) {
        set.status = 500;
        return errorResponse(
          err instanceof Error ? err.message : "Failed to update notification settings",
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
