import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";
import type { DocumentCategoryUseCases } from "../use-cases/crud.use-cases";

export const crudRoutes = (useCases: DocumentCategoryUseCases) =>
  new Elysia()
    .use(sessionContextTypes)

    // GET /document-categories - List all with document count
    .get("/", async ({ activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const categories = await useCases.list(orgId);
      return successResponse(categories);
    })

    // POST /document-categories - Create category
    .post(
      "/",
      async ({ body, set, activeWorkspace }) => {
        const orgId = activeWorkspace!.id;

        const result = await useCases.create(orgId, {
          name: body.name,
          color: body.color,
          icon: body.icon,
          parentId: body.parentId,
        });

        if ("error" in result) {
          set.status = 400;
          return errorResponse("Name is required");
        }

        set.status = 201;
        return successResponse(result.data);
      },
      {
        body: t.Object({
          name: t.String(),
          color: t.Optional(t.String()),
          icon: t.Optional(t.String()),
          parentId: t.Optional(t.String()),
        }),
      }
    )

    // GET /document-categories/:id - Get by ID
    .get(
      "/:id",
      async ({ params, set, activeWorkspace }) => {
        const orgId = activeWorkspace!.id;
        const category = await useCases.getById(orgId, params.id);

        if (!category) {
          set.status = 404;
          return notFoundResponse("Document category");
        }

        return successResponse(category);
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // PATCH /document-categories/:id - Update
    .patch(
      "/:id",
      async ({ params, body, set, activeWorkspace }) => {
        const orgId = activeWorkspace!.id;
        const updated = await useCases.update(orgId, params.id, {
          name: body.name,
          color: body.color,
          icon: body.icon,
          parentId: body.parentId,
          status: body.status,
        });

        if (!updated) {
          set.status = 404;
          return notFoundResponse("Document category");
        }

        return successResponse(updated);
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          name: t.Optional(t.String()),
          color: t.Optional(t.String()),
          icon: t.Optional(t.String()),
          parentId: t.Optional(t.Nullable(t.String())),
          status: t.Optional(t.Union([t.Literal("active"), t.Literal("archived")])),
        }),
      }
    )

    // DELETE /document-categories/:id - Delete
    .delete(
      "/:id",
      async ({ params, set, activeWorkspace }) => {
        const orgId = activeWorkspace!.id;
        const deleted = await useCases.delete(orgId, params.id);

        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Document category");
        }

        return successResponse({ deleted: true });
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    );
