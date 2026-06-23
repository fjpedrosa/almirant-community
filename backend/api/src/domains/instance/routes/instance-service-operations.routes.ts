import { Elysia, t } from "elysia";
import { requireAdmin } from "../../../middleware/require-admin.middleware";
import { successResponse, errorResponse } from "../../../shared/services/response";
import {
  getInstanceServiceOperationsStatus,
  getServiceOperationJob,
  isControllableInstanceService,
  startExitedAgentContainerCleanup,
  startInstanceServiceRestart,
} from "../services/instance-service-operations-service";

export const instanceServiceOperationsRoutes = new Elysia({ prefix: "/instance" })
  .use(requireAdmin)
  .get("/services/status", async ({ set }) => {
    const status = await getInstanceServiceOperationsStatus();
    set.headers["Cache-Control"] = "no-store";
    return successResponse(status);
  })
  .post(
    "/services/:service/restart",
    async ({ params, body, set }) => {
      if (!isControllableInstanceService(params.service)) {
        set.status = 400;
        return errorResponse(
          "Service is not controllable from the instance operations panel.",
          400,
          "service_not_controllable",
        );
      }

      const result = await startInstanceServiceRestart({
        service: params.service,
        force: body.force,
      });
      if (result.ok) {
        set.status = 202;
        return successResponse(result.result);
      }

      set.status = result.status;
      if (result.activeJob) {
        return {
          success: false as const,
          error: "An operation is already in progress",
          code: "active_job_exists",
          data: { activeJob: result.activeJob },
          meta: { timestamp: new Date().toISOString() },
        };
      }

      return errorResponse(result.reason, result.status, result.reason);
    },
    {
      params: t.Object({
        service: t.String({ minLength: 1, maxLength: 64 }),
      }),
      body: t.Object({
        force: t.Optional(t.Boolean()),
      }),
    },
  )
  .post("/services/agent-containers/cleanup-exited", async ({ set }) => {
    const result = await startExitedAgentContainerCleanup();
    if (result.ok) {
      set.status = 202;
      return successResponse(result.result);
    }

    set.status = result.status;
    if (result.activeJob) {
      return {
        success: false as const,
        error: "An operation is already in progress",
        code: "active_job_exists",
        data: { activeJob: result.activeJob },
        meta: { timestamp: new Date().toISOString() },
      };
    }

    return errorResponse(result.reason, result.status, result.reason);
  })
  .get(
    "/service-operations/:jobId",
    async ({ params, set }) => {
      const job = await getServiceOperationJob(params.jobId);
      if (!job) {
        set.status = 404;
        return errorResponse("Service operation job not found", 404, "not_found");
      }

      return successResponse(job);
    },
    {
      params: t.Object({ jobId: t.String({ minLength: 1, maxLength: 64 }) }),
    },
  );
