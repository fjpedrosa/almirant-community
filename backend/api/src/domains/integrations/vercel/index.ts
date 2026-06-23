import { Elysia } from "elysia";
import { vercelWebhooksRoutes } from "./routes/webhooks.routes";
import { vercelRoutes } from "./routes/vercel.routes";

export const vercelModule = {
  /** Public webhook endpoint — mounted at root level (no session auth) */
  webhooks: () => new Elysia().use(vercelWebhooksRoutes),
  /** Protected routes — mounted inside /api group (session auth) */
  protected: () => new Elysia().use(vercelRoutes),
};
