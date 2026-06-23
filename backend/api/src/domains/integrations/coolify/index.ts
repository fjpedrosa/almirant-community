import { Elysia } from "elysia";
import { coolifyWebhooksRoutes } from "./routes/webhooks.routes";

export const coolifyModule = {
  /** Public webhook endpoint — mounted at root level (no session auth) */
  webhooks: () => new Elysia().use(coolifyWebhooksRoutes),
};
