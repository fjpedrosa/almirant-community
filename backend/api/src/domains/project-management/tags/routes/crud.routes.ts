import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";
import type { TagUseCases } from "../use-cases/crud.use-cases";

export const crudRoutes = (useCases: TagUseCases) =>
  new Elysia()
    .use(sessionContextTypes)

    // GET /tags - List all tags
    .get("/", async ({ activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const tags = await useCases.list(orgId);
        return successResponse(tags);
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Failed to fetch tags",
          500
        );
      }
    })

    // POST /tags - Create tag
    .post(
      "/",
      async ({ body, set, activeOrganization }) => {
        try {
          const orgId = activeOrganization!.id;

          if (!body.name || body.name.trim() === "") {
            set.status = 400;
            return errorResponse("Name is required");
          }

          const tag = await useCases.create(orgId, {
            name: body.name,
            color: body.color,
          });

          set.status = 201;
          return successResponse(tag);
        } catch (error) {
          // Check for unique constraint violation (PostgreSQL SQLSTATE 23505)
          if (error instanceof Error && 'code' in error && (error as any).code === '23505') {
            set.status = 409;
            return errorResponse("Tag with this name already exists", 409);
          }
          set.status = 500;
          return errorResponse(
            error instanceof Error ? error.message : "Failed to create tag",
            500
          );
        }
      },
      {
        body: t.Object({
          name: t.String(),
          color: t.Optional(t.String()),
        }),
      }
    )

    // GET /tags/:id - Get tag by ID
    .get(
      "/:id",
      async ({ params, set, activeOrganization }) => {
        try {
          const orgId = activeOrganization!.id;
          const tag = await useCases.getById(orgId, params.id);

          if (!tag) {
            set.status = 404;
            return notFoundResponse("Tag");
          }

          return successResponse(tag);
        } catch (error) {
          set.status = 500;
          return errorResponse(
            error instanceof Error ? error.message : "Failed to fetch tag",
            500
          );
        }
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // PATCH /tags/:id - Update tag
    .patch(
      "/:id",
      async ({ params, body, set, activeOrganization }) => {
        try {
          const orgId = activeOrganization!.id;
          const tag = await useCases.update(orgId, params.id, {
            name: body.name,
            color: body.color,
          });

          if (!tag) {
            set.status = 404;
            return notFoundResponse("Tag");
          }

          return successResponse(tag);
        } catch (error) {
          // Check for unique constraint violation (PostgreSQL SQLSTATE 23505)
          if (error instanceof Error && 'code' in error && (error as any).code === '23505') {
            set.status = 409;
            return errorResponse("Tag with this name already exists", 409);
          }
          set.status = 500;
          return errorResponse(
            error instanceof Error ? error.message : "Failed to update tag",
            500
          );
        }
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          name: t.Optional(t.String()),
          color: t.Optional(t.String()),
        }),
      }
    )

    // DELETE /tags/:id - Delete tag
    .delete(
      "/:id",
      async ({ params, set, activeOrganization }) => {
        try {
          const orgId = activeOrganization!.id;
          const deleted = await useCases.delete(orgId, params.id);

          if (!deleted) {
            set.status = 404;
            return notFoundResponse("Tag");
          }

          return successResponse({ deleted: true });
        } catch (error) {
          set.status = 500;
          return errorResponse(
            error instanceof Error ? error.message : "Failed to delete tag",
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
