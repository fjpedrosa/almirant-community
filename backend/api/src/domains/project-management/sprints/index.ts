import { Elysia } from "elysia";
import { sprintsRoutes } from "./routes/sprints.routes";

export const sprintsModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () => new Elysia().use(sprintsRoutes),
};
