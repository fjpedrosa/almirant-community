import { Elysia, t } from "elysia";
import { successResponse, errorResponse } from "../../../shared/services/response";
import { requireAdmin } from "../../../middleware/require-admin.middleware";
import { getInstanceVersion } from "../services/instance-version-service";
import {
  getActiveUpdateJob,
  getUpdateJob,
  isUpdaterAvailable,
  startUpdate,
} from "../services/instance-update-service";

/**
 * Click-to-update routes (admin-only).
 *
 * The backend cannot rebuild itself — these endpoints proxy to the `updater`
 * sidecar over the internal docker network. The sidecar drives the actual
 * `git pull` + `docker compose build` + `up -d --force-recreate` and
 * survives the rebuild because it excludes itself from the recreate set.
 *
 * UX contract: the frontend banner only shows the "Update now" CTA when
 * GET /instance/update/available returns true. Otherwise it falls back to
 * the existing copy-command UX (no breaking change for installs without
 * the sidecar).
 */
export const instanceUpdateRoutes = new Elysia()
  .use(requireAdmin)

  .get("/instance/update/available", async ({ set }) => {
    const available = await isUpdaterAvailable();
    set.headers["Cache-Control"] = "private, max-age=30";
    return successResponse({ available });
  })

  .get("/instance/update/active", async () => {
    const job = await getActiveUpdateJob();
    return successResponse({ job });
  })

  .post("/instance/update", async ({ set }) => {
    // Pre-flight: don't burn a rebuild if there's nothing new to pull.
    // Re-uses the cached version-check service so it's free.
    const version = await getInstanceVersion();
    if (!version.updateAvailable) {
      set.status = 409;
      return errorResponse(
        "No update available — instance is already at the latest commit.",
        409,
        "no_update_available",
      );
    }

    const result = await startUpdate();
    if (result.ok) {
      set.status = 202;
      return successResponse(result.result);
    }

    set.status = result.status;
    if (result.activeJob) {
      return {
        success: false as const,
        error: "An update is already in progress",
        code: "active_job_exists",
        data: { activeJob: result.activeJob },
        meta: { timestamp: new Date().toISOString() },
      };
    }
    return errorResponse(result.reason, result.status, result.reason);
  })

  .get(
    "/instance/update/:jobId",
    async ({ params, set }) => {
      const job = await getUpdateJob(params.jobId);
      if (!job) {
        set.status = 404;
        return errorResponse("Update job not found", 404, "not_found");
      }
      return successResponse(job);
    },
    {
      params: t.Object({ jobId: t.String({ minLength: 1, maxLength: 64 }) }),
    },
  );
