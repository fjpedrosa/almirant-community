import { Elysia, t } from "elysia";
import { requireAdmin } from "../../../middleware/require-admin.middleware";
import { successResponse, errorResponse } from "../../../shared/services/response";
import {
  connectTailnetDatabaseAccess,
  disableTailnetDatabaseAccess,
  getTailnetDatabaseAccessStatus,
  testTailnetDatabaseAccess,
} from "../services/tailnet-database-access-service";

export const tailnetDatabaseRoutes = new Elysia({ prefix: "/instance/tailnet/database" })
  .use(requireAdmin)

  .get("/status", async () => {
    const status = await getTailnetDatabaseAccessStatus();
    return successResponse(status);
  })

  .post(
    "/connect",
    async ({ body, set }) => {
      try {
        const status = await connectTailnetDatabaseAccess(body);
        set.status = status.status === "provisioning" ? 202 : 200;
        return successResponse(status);
      } catch (error) {
        set.status = 400;
        return errorResponse(
          error instanceof Error ? error.message : String(error),
          400,
          "tailnet_database_connect_failed",
        );
      }
    },
    {
      body: t.Object({
        authMethod: t.Union([t.Literal("auth_key"), t.Literal("oauth_client")]),
        authKey: t.Optional(t.String({ minLength: 1, maxLength: 4096 })),
        oauthClientId: t.Optional(t.String({ minLength: 1, maxLength: 512 })),
        oauthClientSecret: t.Optional(t.String({ minLength: 1, maxLength: 4096 })),
        hostname: t.Optional(t.String({ minLength: 1, maxLength: 63 })),
        tag: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
      }),
    },
  )

  .post("/test", async () => {
    const status = await testTailnetDatabaseAccess();
    return successResponse(status);
  })

  .delete("/", async () => {
    const status = await disableTailnetDatabaseAccess();
    return successResponse(status);
  });
