import { Elysia } from "elysia";
import { debugRoutes } from "./routes/debug.routes";

/**
 * Debug domain — incident-bundle read/refresh/analyze surface.
 *
 * Mounted under the `/api` workspace-scoped group (see `api/src/index.ts`) so
 * `activeWorkspace` is present; tenant isolation is enforced per-query via the
 * workspace-scoped incident-bundle repository.
 */
export const debugModule = {
  /** Protected debug routes (session auth, workspace-scoped). */
  protected: () => new Elysia().use(debugRoutes),
};
