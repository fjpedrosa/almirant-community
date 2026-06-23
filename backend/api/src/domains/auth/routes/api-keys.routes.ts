import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../shared/services/response";

export const apiKeysRoutes = new Elysia({ prefix: "/api-keys" })
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // POST /api-keys - Create a new API key
  // -------------------------------------------------------
  .post(
    "/",
    async ({ body, set, user, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;

        if (!body.name || body.name.trim() === "") {
          set.status = 400;
          return errorResponse("Name is required");
        }

        const userId = (user as { id: string }).id;
        const result = await createApiKey(orgId, body.name.trim(), { userId });

        set.status = 201;
        return successResponse(result);
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to create API key",
          500
        );
      }
    },
    {
      body: t.Object({
        name: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /api-keys - List all API keys
  // -------------------------------------------------------
  .get("/", async ({ user, activeOrganization }) => {
    try {
      const orgId = activeOrganization!.id;
      const userId = (user as { id: string }).id;
      const keys = await listApiKeys(orgId, userId);
      return successResponse(keys);
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : "Failed to fetch API keys",
        500
      );
    }
  })

  // -------------------------------------------------------
  // DELETE /api-keys/:id - Revoke an API key
  // -------------------------------------------------------
  .delete(
    "/:id",
    async ({ params, set, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const revoked = await revokeApiKey(orgId, params.id);

        if (!revoked) {
          set.status = 404;
          return notFoundResponse("API key");
        }

        return successResponse({ revoked: true });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to revoke API key",
          500
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
