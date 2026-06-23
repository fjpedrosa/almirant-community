import { Elysia } from "elysia";
import { notificationsRoutes } from "./routes/notifications.routes";
import { emailNotificationsRoutes } from "./routes/email-notifications.routes";
import { pushSubscriptionsRoutes } from "./routes/push-subscriptions.routes";
import { resendWebhooksRoutes } from "./routes/resend-webhooks.routes";

export const notificationsModule = {
  /** Public Resend webhook routes (no auth) - mounted outside /api */
  public: () => new Elysia().use(resendWebhooksRoutes),
  /** Protected notification routes (session auth, org-scoped) - mounted under /api */
  protected: () =>
    new Elysia()
      .use(notificationsRoutes)
      .use(emailNotificationsRoutes)
      .use(pushSubscriptionsRoutes),
};
