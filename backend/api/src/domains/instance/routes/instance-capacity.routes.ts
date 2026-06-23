import { Elysia } from "elysia";
import { requireAdmin } from "../../../middleware/require-admin.middleware";
import { successResponse, errorResponse } from "../../../shared/services/response";
import { getInstanceCapacityDiagnostics } from "../services/instance-capacity-service";

export const instanceCapacityRoutes = new Elysia({ prefix: "/instance" })
  .use(requireAdmin)
  .get("/capacity", async ({ set }) => {
    try {
      const diagnostics = await getInstanceCapacityDiagnostics();
      set.headers["Cache-Control"] = "no-store";
      return successResponse(diagnostics);
    } catch (error) {
      set.status = 500;
      return errorResponse(
        `Failed to load instance capacity diagnostics: ${
          error instanceof Error ? error.message : String(error)
        }`,
        500,
      );
    }
  });
