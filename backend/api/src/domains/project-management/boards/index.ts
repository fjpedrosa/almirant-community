import { Elysia } from "elysia";
import { boardsRoutes } from "./routes/boards.routes";

export const boardsModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () => new Elysia().use(boardsRoutes),
};
