import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";
import type { ExpenseCategoryUseCases } from "../use-cases/crud.use-cases";

const normalizeErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

export const crudRoutes = (useCases: ExpenseCategoryUseCases) =>
  new Elysia()
    .use(sessionContextTypes)

    // GET /expense-categories - list all active categories
    .get("/", async ({ activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const categories = await useCases.list(orgId);
        return successResponse(categories);
      } catch (error) {
        return errorResponse(normalizeErrorMessage(error));
      }
    })

    // GET /expense-categories/:id
    .get("/:id", async ({ activeOrganization, params }) => {
      try {
        const orgId = activeOrganization!.id;
        const category = await useCases.getById(orgId, params.id);
        if (!category) return notFoundResponse("Expense category not found");
        return successResponse(category);
      } catch (error) {
        return errorResponse(normalizeErrorMessage(error));
      }
    })

    // POST /expense-categories
    .post(
      "/",
      async ({ activeOrganization, body }) => {
        try {
          const orgId = activeOrganization!.id;
          const category = await useCases.create(orgId, {
            name: body.name,
            icon: body.icon,
            color: body.color,
            order: body.order,
            parentId: body.parentId,
          });
          return successResponse(category);
        } catch (error) {
          return errorResponse(normalizeErrorMessage(error));
        }
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          icon: t.Optional(t.Nullable(t.String())),
          color: t.Optional(t.Nullable(t.String())),
          order: t.Optional(t.Number()),
          parentId: t.Optional(t.Nullable(t.String())),
        }),
      }
    )

    // PATCH /expense-categories/:id
    .patch(
      "/:id",
      async ({ activeOrganization, params, body }) => {
        try {
          const orgId = activeOrganization!.id;
          const category = await useCases.update(orgId, params.id, {
            name: body.name,
            icon: body.icon,
            color: body.color,
            order: body.order,
            parentId: body.parentId,
            isActive: body.isActive,
          });
          if (!category) return notFoundResponse("Expense category not found");
          return successResponse(category);
        } catch (error) {
          return errorResponse(normalizeErrorMessage(error));
        }
      },
      {
        body: t.Object({
          name: t.Optional(t.String()),
          icon: t.Optional(t.Nullable(t.String())),
          color: t.Optional(t.Nullable(t.String())),
          order: t.Optional(t.Number()),
          parentId: t.Optional(t.Nullable(t.String())),
          isActive: t.Optional(t.Boolean()),
        }),
      }
    )

    // DELETE /expense-categories/:id
    .delete("/:id", async ({ activeOrganization, params }) => {
      try {
        const orgId = activeOrganization!.id;
        const deleted = await useCases.delete(orgId, params.id);
        if (!deleted) return notFoundResponse("Expense category not found");
        return successResponse({ deleted: true });
      } catch (error) {
        return errorResponse(normalizeErrorMessage(error));
      }
    });
