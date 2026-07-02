import { Elysia, t } from "elysia";
import { updateUserLocale, getMembersByWorkspaceId } from "@almirant/database";
import { successResponse, errorResponse } from "../../../shared/services/response";

const SUPPORTED_LOCALES = ["es", "en"];

export const usersRoutes = new Elysia({ prefix: "/users" })

  // -------------------------------------------------------
  // GET /users/me - Get current user info
  // -------------------------------------------------------
  .get("/me", (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user as Record<string, unknown> | null;
    if (!user) {
      ctx.set.status = 401;
      return errorResponse("Unauthorized", 401);
    }
    return successResponse(user);
  })

  // -------------------------------------------------------
  // GET /users/members - List members of active workspace
  // -------------------------------------------------------
  .get("/members", async (ctx) => {
    const activeWorkspace = (ctx as unknown as Record<string, unknown>).activeWorkspace as { id: string } | null;
    if (!activeWorkspace) {
      ctx.set.status = 403;
      return errorResponse("No active workspace", 403);
    }
    try {
      const members = await getMembersByWorkspaceId(activeWorkspace.id);
      return successResponse(members);
    } catch (error) {
      ctx.set.status = 500;
      return errorResponse(
        error instanceof Error ? error.message : "Failed to fetch members",
        500
      );
    }
  })

  // -------------------------------------------------------
  // PATCH /users/me/locale - Update current user's locale
  // -------------------------------------------------------
  .patch(
    "/me/locale",
    async (ctx) => {
      const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
      const { body, set } = ctx;
      if (!user) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      if (!SUPPORTED_LOCALES.includes(body.locale)) {
        set.status = 400;
        return errorResponse(
          `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(", ")}`,
          400
        );
      }

      try {
        const updated = await updateUserLocale(user.id, body.locale);
        if (!updated) {
          set.status = 404;
          return errorResponse("User not found", 404);
        }
        return successResponse({ locale: updated.locale });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to update locale",
          500
        );
      }
    },
    {
      body: t.Object({
        locale: t.String(),
      }),
    }
  );
