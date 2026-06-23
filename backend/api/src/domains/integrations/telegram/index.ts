import { Elysia } from "elysia";
import { telegramWebhooksRoutes } from "./routes/webhooks.routes";
import { telegramRoutes } from "./routes/telegram.routes";

export const telegramModule = {
  /** Public webhook endpoint — mounted at root level (no session auth) */
  webhooks: () => new Elysia().use(telegramWebhooksRoutes),
  /** Protected routes — mounted inside /api group (session auth) */
  protected: () => new Elysia().use(telegramRoutes),
};
