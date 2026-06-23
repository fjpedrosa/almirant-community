import { Elysia } from "elysia";
import { importsRoutes } from "./routes/imports.routes";

export const importsModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () => new Elysia().use(importsRoutes),
};
