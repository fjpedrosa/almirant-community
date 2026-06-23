import { Elysia } from "elysia";
import { webhooksRoutes } from "./routes/webhooks.routes";

export const webhooksModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () => new Elysia().use(webhooksRoutes),
};
