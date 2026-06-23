import { Elysia } from "elysia";
import { getPublicInstanceConfig } from "../services/instance-config-service";
import { successResponse } from "../../../shared/services/response";

export const instancePublicRoutes = new Elysia()
  .get("/instance/public-config", async ({ set }) => {
    const config = await getPublicInstanceConfig();

    set.headers["Cache-Control"] = "public, max-age=30";

    return successResponse(config);
  });
