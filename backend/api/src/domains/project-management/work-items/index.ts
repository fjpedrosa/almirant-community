import { Elysia } from "elysia";
import { workItemsRoutes } from "./routes/work-items.routes";
import { workItemsDodHumanActionRoutes } from "./routes/work-items-dod-human-action.routes";

export const workItemsModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () =>
    new Elysia()
      .use(workItemsRoutes)
      .use(workItemsDodHumanActionRoutes),
};
