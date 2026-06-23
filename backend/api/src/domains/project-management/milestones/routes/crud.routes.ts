import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../../shared/services/response";
import type { MilestoneUseCases } from "../use-cases/crud.use-cases";

export const crudRoutes = (useCases: MilestoneUseCases) =>
  new Elysia()
    .use(sessionContextTypes)

    // GET /milestones?projectId=...
    .get(
      "/",
      async ({ query, set, activeOrganization }) => {
        const orgId = activeOrganization!.id;
        if (!query.projectId) {
          set.status = 400;
          return errorResponse("projectId is required");
        }

        const milestones = await useCases.listByProject(orgId, query.projectId);
        return successResponse(milestones);
      },
      {
        query: t.Object({
          projectId: t.String(),
        }),
      }
    )

    // GET /milestones/:id
    .get(
      "/:id",
      async ({ params, set, activeOrganization }) => {
        const orgId = activeOrganization!.id;
        const milestone = await useCases.getById(orgId, params.id);

        if (!milestone) {
          set.status = 404;
          return notFoundResponse("Milestone");
        }

        return successResponse(milestone);
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // POST /milestones
    .post(
      "/",
      async (ctx) => {
        const { body, set, activeOrganization } = ctx;
        const user = (ctx as { user?: { id?: string } }).user;
        const orgId = activeOrganization!.id;

        const result = await useCases.create(
          orgId,
          {
            projectId: body.projectId,
            title: body.title,
            description: body.description,
            priority: body.priority,
            targetDate: body.targetDate,
            workItemIds: body.workItemIds,
          },
          user?.id
        );

        if (!result) {
          set.status = 404;
          return notFoundResponse("Project");
        }

        set.status = 201;
        return successResponse(result);
      },
      {
        body: t.Object({
          projectId: t.String(),
          title: t.String(),
          description: t.Optional(t.Nullable(t.String())),
          priority: t.Union([
            t.Literal("low"),
            t.Literal("medium"),
            t.Literal("high"),
            t.Literal("urgent"),
          ]),
          targetDate: t.String(),
          workItemIds: t.Optional(t.Array(t.String())),
        }),
      }
    )

    // PATCH /milestones/:id
    .patch(
      "/:id",
      async ({ params, body, set, activeOrganization }) => {
        const orgId = activeOrganization!.id;

        const result = await useCases.update(orgId, params.id, {
          title: body.title,
          description: body.description,
          status: body.status,
          priority: body.priority,
          targetDate: body.targetDate,
          completedAt: body.completedAt,
        });

        if (!result) {
          set.status = 404;
          return notFoundResponse("Milestone");
        }

        return successResponse(result);
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          title: t.Optional(t.String()),
          description: t.Optional(t.Nullable(t.String())),
          status: t.Optional(
            t.Union([
              t.Literal("planned"),
              t.Literal("in_progress"),
              t.Literal("completed"),
              t.Literal("on_hold"),
              t.Literal("cancelled"),
            ])
          ),
          priority: t.Optional(
            t.Union([
              t.Literal("low"),
              t.Literal("medium"),
              t.Literal("high"),
              t.Literal("urgent"),
            ])
          ),
          targetDate: t.Optional(t.Nullable(t.String())),
          completedAt: t.Optional(t.Nullable(t.String())),
        }),
      }
    )

    // DELETE /milestones/:id
    .delete(
      "/:id",
      async ({ params, set, activeOrganization }) => {
        const orgId = activeOrganization!.id;
        const deleted = await useCases.delete(orgId, params.id);

        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Milestone");
        }

        return successResponse({ deleted: true });
      },
      {
        params: t.Object({
          id: t.String(),
        }),
      }
    )

    // POST /milestones/:id/work-items
    .post(
      "/:id/work-items",
      async ({ params, body, set, activeOrganization }) => {
        const orgId = activeOrganization!.id;
        if (body.workItemIds.length === 0) {
          set.status = 400;
          return errorResponse("workItemIds is required");
        }

        const result = await useCases.addWorkItems(orgId, params.id, body.workItemIds);
        if (!result) {
          set.status = 404;
          return notFoundResponse("Milestone");
        }

        return successResponse(result);
      },
      {
        params: t.Object({
          id: t.String(),
        }),
        body: t.Object({
          workItemIds: t.Array(t.String()),
        }),
      }
    )

    // DELETE /milestones/:id/work-items/:workItemId
    .delete(
      "/:id/work-items/:workItemId",
      async ({ params, set, activeOrganization }) => {
        const orgId = activeOrganization!.id;

        const result = await useCases.removeWorkItem(orgId, params.id, params.workItemId);
        if (!result) {
          set.status = 404;
          return notFoundResponse("Milestone");
        }

        if (!result.removed) {
          set.status = 404;
          return notFoundResponse("Milestone work item link");
        }

        return successResponse(result);
      },
      {
        params: t.Object({
          id: t.String(),
          workItemId: t.String(),
        }),
      }
    );
