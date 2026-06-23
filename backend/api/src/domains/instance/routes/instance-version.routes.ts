import { Elysia } from "elysia";
import { getInstanceVersion } from "../services/instance-version-service";
import { successResponse } from "../../../shared/services/response";
import { requireAdmin } from "../../../middleware/require-admin.middleware";

/**
 * GET /instance/version
 *
 * Admin-only endpoint. Returns the current build SHA (injected at build
 * time via ALMIRANT_BUILD_SHA), the latest SHA on `main` in the public
 * GitHub repo, and whether an update is available.
 *
 * Used by the "update available" banner in the dashboard. Results are
 * cached server-side for 30 min to avoid hitting GitHub's 60 req/hr
 * unauthenticated rate limit.
 */
export const instanceVersionRoutes = new Elysia()
  .use(requireAdmin)
  .get("/instance/version", async ({ set }) => {
    const info = await getInstanceVersion();
    set.headers["Cache-Control"] = "private, max-age=60";
    return successResponse(info);
  });
