import { Elysia } from "elysia";
import { projectsRoutes } from "./routes/projects.routes";

export const projectsModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () => new Elysia().use(projectsRoutes),
};
