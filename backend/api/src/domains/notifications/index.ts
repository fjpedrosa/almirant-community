import { Elysia } from "elysia";
import { notificationsRoutes } from "./routes/notifications.routes";
import { emailNotificationsRoutes } from "./routes/email-notifications.routes";
import { pushSubscriptionsRoutes } from "./routes/push-subscriptions.routes";
import { resendWebhooksRoutes } from "./routes/resend-webhooks.routes";
import { internalEmailsRoutes } from "./routes/internal-emails.routes";

export const notificationsModule = {
  /**
   * Public routes (no session auth) - mounted outside /api:
   *   - Resend inbound webhooks (signature-verified)
   *   - Internal server-to-server email endpoints (shared-secret guarded)
   */
  public: () =>
    new Elysia().use(resendWebhooksRoutes).use(internalEmailsRoutes),
  /** Protected notification routes (session auth, org-scoped) - mounted under /api */
  protected: () =>
    new Elysia()
      .use(notificationsRoutes)
      .use(emailNotificationsRoutes)
      .use(pushSubscriptionsRoutes),
};
