import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";
import type { SavedViewUseCases } from "../use-cases/crud.use-cases";

export const boardViewRoutes = (useCases: SavedViewUseCases) =>
  new Elysia({ prefix: "/boards" })
    .use(sessionContextTypes)

    // GET /boards/:id/views - List saved views for a board
    .get(
      "/:id/views",
      async ({ user, activeWorkspace, params, set }) => {
        if (!user) {
          set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        const orgId = activeWorkspace!.id;
        const views = await useCases.listByBoard(user.id, params.id, orgId);

        if (views === null) {
          set.status = 404;
          return notFoundResponse("Board");
        }

        return successResponse(views);
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // POST /boards/:id/views - Create a saved view
    .post(
      "/:id/views",
      async ({ user, activeWorkspace, body, set, params }) => {
        if (!user) {
          set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        const orgId = activeWorkspace!.id;
        const result = await useCases.create(user.id, params.id, orgId, {
          name: body.name,
          config: body.config,
        });

        if ("error" in result) {
          if (result.error === "board_not_found") {
            set.status = 404;
            return notFoundResponse("Board");
          }
          if (result.error === "name_required") {
            set.status = 400;
            return errorResponse("Name is required");
          }
        }

        set.status = 201;
        return successResponse((result as { data: any }).data);
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          name: t.String(),
          config: t.Record(t.String(), t.Any()),
        }),
      }
    )

    // PATCH /boards/:id/views/:viewId - Update a saved view
    .patch(
      "/:id/views/:viewId",
      async ({ user, set, params, body }) => {
        if (!user) {
          set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        const result = await useCases.update(user.id, params.id, params.viewId, {
          name: body.name,
          config: body.config,
        });

        if ("error" in result) {
          if (result.error === "not_found") {
            set.status = 404;
            return notFoundResponse("Saved view");
          }
          if (result.error === "forbidden") {
            set.status = 403;
            return errorResponse("Forbidden: You can only update your own views");
          }
          if (result.error === "wrong_board") {
            set.status = 400;
            return errorResponse("View does not belong to this board");
          }
        }

        return successResponse((result as { data: any }).data);
      },
      {
        params: t.Object({
          id: t.String(),
          viewId: t.String(),
        }),
        body: t.Object({
          name: t.Optional(t.String()),
          config: t.Optional(t.Record(t.String(), t.Any())),
        }),
      }
    )

    // DELETE /boards/:id/views/:viewId - Delete a saved view
    .delete(
      "/:id/views/:viewId",
      async ({ user, set, params }) => {
        if (!user) {
          set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        const result = await useCases.delete(user.id, params.id, params.viewId);

        if ("error" in result) {
          if (result.error === "not_found") {
            set.status = 404;
            return notFoundResponse("Saved view");
          }
          if (result.error === "forbidden") {
            set.status = 403;
            return errorResponse("Forbidden: You can only delete your own views");
          }
          if (result.error === "wrong_board") {
            set.status = 400;
            return errorResponse("View does not belong to this board");
          }
        }

        return successResponse({ deleted: true });
      },
      {
        params: t.Object({
          id: t.String(),
          viewId: t.String(),
        }),
      }
    );

export const userPreferenceRoutes = (useCases: SavedViewUseCases) =>
  new Elysia({ prefix: "/users" })

    // GET /users/me/view-preferences/:pageKey
    .get(
      "/me/view-preferences/:pageKey",
      async (ctx) => {
        const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
        if (!user) {
          ctx.set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        const config = await useCases.getPreference(user.id, ctx.params.pageKey);
        return successResponse(config);
      },
      {
        params: t.Object({
          pageKey: t.String({ minLength: 1, maxLength: 100 }),
        }),
      }
    )

    // PUT /users/me/view-preferences/:pageKey
    .put(
      "/me/view-preferences/:pageKey",
      async (ctx) => {
        const user = (ctx as unknown as Record<string, unknown>).user as { id: string } | null;
        const { body, set } = ctx;

        if (!user) {
          set.status = 401;
          return errorResponse("Unauthorized", 401);
        }

        try {
          await useCases.upsertPreference(user.id, ctx.params.pageKey, body.config);
          return successResponse({ saved: true });
        } catch (error) {
          set.status = 500;
          return errorResponse(
            error instanceof Error ? error.message : "Failed to save view preference",
            500
          );
        }
      },
      {
        params: t.Object({
          pageKey: t.String({ minLength: 1, maxLength: 100 }),
        }),
        body: t.Object({
          config: t.Record(t.String(), t.Unknown()),
        }),
      }
    );
