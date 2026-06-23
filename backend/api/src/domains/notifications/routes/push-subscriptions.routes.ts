import { Elysia, t } from "elysia";
import {
  createPushSubscription,
  deletePushSubscriptionById,
  getPushSubscriptionsByUserId,
} from "@almirant/database";
import { env } from "@almirant/config";
import { successResponse, errorResponse, notFoundResponse } from "../../../shared/services/response";

export const pushSubscriptionsRoutes = new Elysia({ prefix: "/push-subscriptions" })
  .get("/vapid-key", async ({ set }) => {
    if (!env.VAPID_PUBLIC_KEY) {
      set.status = 404;
      return notFoundResponse("VAPID public key");
    }
    return successResponse({ publicKey: env.VAPID_PUBLIC_KEY });
  })
  .get("/", async (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
    if (!user) {
      ctx.set.status = 401;
      return errorResponse("Unauthorized", 401);
    }

    try {
      const subscriptions = await getPushSubscriptionsByUserId(user.id);
      return successResponse(subscriptions);
    } catch (err) {
      ctx.set.status = 500;
      return errorResponse(
        err instanceof Error ? err.message : "Failed to fetch push subscriptions",
        500
      );
    }
  })
  .post(
    "/subscribe",
    async ({ body, set, ...ctx }) => {
      const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      try {
        const subscription = await createPushSubscription({
          userId: user.id,
          endpoint: body.endpoint,
          p256dhKey: body.p256dhKey,
          authKey: body.authKey,
          userAgent: body.userAgent,
          deviceLabel: body.deviceLabel,
        });
        set.status = 201;
        return successResponse(subscription);
      } catch (err) {
        set.status = 500;
        return errorResponse(
          err instanceof Error ? err.message : "Failed to create push subscription",
          500
        );
      }
    },
    {
      body: t.Object({
        endpoint: t.String({ minLength: 1 }),
        p256dhKey: t.String({ minLength: 1 }),
        authKey: t.String({ minLength: 1 }),
        userAgent: t.Optional(t.String()),
        deviceLabel: t.Optional(t.String()),
      }),
    }
  )
  .delete("/:id", async ({ params, set, ...ctx }) => {
    const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
    if (!user) {
      set.status = 401;
      return errorResponse("Unauthorized", 401);
    }

    try {
      const deleted = await deletePushSubscriptionById(params.id, user.id);
      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Push subscription");
      }
      return successResponse({ deleted: true });
    } catch (err) {
      set.status = 500;
      return errorResponse(
        err instanceof Error ? err.message : "Failed to delete push subscription",
        500
      );
    }
  });
