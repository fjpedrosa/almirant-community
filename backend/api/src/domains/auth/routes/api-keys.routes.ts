import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  and,
  createApiKey,
  db,
  eq,
  listApiKeys,
  revokeApiKey,
  schema,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../shared/services/response";
import {
  ApiKeyWorkspaceError,
  resolveApiKeyWorkspaceId,
} from "./api-key-workspace";

const isWorkspaceMember = async (
  userId: string,
  workspaceId: string,
): Promise<boolean> => {
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.member.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return rows.length > 0;
};

export const apiKeysRoutes = new Elysia({ prefix: "/api-keys" })
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // POST /api-keys - Create a new API key
  // -------------------------------------------------------
  .post(
    "/",
    async ({ body, set, user, activeWorkspace }) => {
      try {
        if (!body.name || body.name.trim() === "") {
          set.status = 400;
          return errorResponse("Name is required");
        }

        const userId = (user as { id: string }).id;
        const orgId = await resolveApiKeyWorkspaceId({
          activeWorkspace,
          requestedWorkspaceId: body.workspaceId,
          userId,
          isWorkspaceMember,
        });
        const result = await createApiKey(orgId, body.name.trim(), { userId });

        set.status = 201;
        return successResponse(result);
      } catch (error) {
        if (error instanceof ApiKeyWorkspaceError) {
          set.status = error.status;
          return errorResponse(error.message, error.status);
        }
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
        workspaceId: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /api-keys - List all API keys
  // -------------------------------------------------------
  .get("/", async ({ user, activeWorkspace }) => {
    try {
      const orgId = activeWorkspace!.id;
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
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
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
