import { Elysia } from "elysia";
import { handbookRoutes } from "./routes/handbook.routes";

export const handbookModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () => new Elysia().use(handbookRoutes),
};
