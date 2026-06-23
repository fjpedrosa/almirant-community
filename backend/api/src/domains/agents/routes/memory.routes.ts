import { Elysia, t } from "elysia";
import {
  archiveObservation,
  countObservationsByOrg,
  deleteObservation,
  getObservationById,
  getObservationsByOrg,
  searchObservations,
  verifyObservation,
} from "@almirant/database";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  buildPaginationMeta,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  successResponse,
} from "../../../shared/services/response";
import { assertSafeMemoryText } from "../../../lib/memory/scrubber";
import { rankObservationResults } from "../../../lib/memory/ranker";

export const memoryRoutes = new Elysia({ prefix: "/memory" })
  .use(sessionContextTypes)
  .get(
    "/",
    async ({ query, activeOrganization }) => {
      try {
        const orgId = activeOrganization!.id;
        const pagination = parsePaginationParams(query);
        const filters = {
          projectId: query.projectId || undefined,
          workItemId: query.workItemId || undefined,
          type: query.type || undefined,
          visibility:
            query.visibility === "personal" ||
            query.visibility === "project" ||
            query.visibility === "org"
              ? query.visibility
              : undefined,
          archived: query.archived === "true",
          includeArchived: query.archived === "true",
          includeQuarantined: query.includeQuarantined === "true",
          minConfidence: query.minConfidence
            ? Number(query.minConfidence)
            : undefined,
          limit: pagination.limit,
          offset: pagination.offset,
        } as const;

        if (query.search && query.search.trim().length > 0) {
          const safeQuery = assertSafeMemoryText(query.search, "search");
          const results = await searchObservations(orgId, safeQuery, filters);
          const ranked = rankObservationResults(results, safeQuery);
          return successResponse(
            ranked,
            buildPaginationMeta(
              pagination.page,
              pagination.limit,
              ranked.length
            )
          );
        }

        const [items, total] = await Promise.all([
          getObservationsByOrg(orgId, filters),
          countObservationsByOrg(orgId, {
            ...filters,
            limit: undefined,
            offset: undefined,
          }),
        ]);

        return successResponse(
          items,
          buildPaginationMeta(pagination.page, pagination.limit, total)
        );
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Failed to list memory",
          500
        );
      }
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        search: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        workItemId: t.Optional(t.String()),
        type: t.Optional(t.String()),
        visibility: t.Optional(t.String()),
        archived: t.Optional(t.String()),
        includeQuarantined: t.Optional(t.String()),
        minConfidence: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/:id",
    async ({ params, set, activeOrganization }) => {
      const orgId = activeOrganization!.id;
      const observation = await getObservationById(params.id, {
        includeArchived: true,
        includeExpired: true,
      });
      if (!observation || observation.organizationId !== orgId) {
        set.status = 404;
        return notFoundResponse("Memory observation");
      }
      return successResponse(observation);
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )
  .post(
    "/:id/verify",
    async ({ params, body, set, user, activeOrganization }) => {
      if (!user?.id) {
        set.status = 401;
        return errorResponse("Unauthorized", 401);
      }

      const existing = await getObservationById(params.id, {
        includeArchived: true,
        includeExpired: true,
      });
      if (!existing || existing.organizationId !== activeOrganization!.id) {
        set.status = 404;
        return notFoundResponse("Memory observation");
      }

      const updated = await verifyObservation(
        params.id,
        user.id,
        body.confidence ?? 1
      );
      if (!updated) {
        set.status = 404;
        return notFoundResponse("Memory observation");
      }
      return successResponse(updated);
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        confidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
      }),
    }
  )
  .post(
    "/:id/archive",
    async ({ params, set, activeOrganization }) => {
      const existing = await getObservationById(params.id, {
        includeArchived: true,
        includeExpired: true,
      });
      if (!existing || existing.organizationId !== activeOrganization!.id) {
        set.status = 404;
        return notFoundResponse("Memory observation");
      }

      const updated = await archiveObservation(params.id);
      if (!updated) {
        set.status = 404;
        return notFoundResponse("Memory observation");
      }
      return successResponse(updated);
    },
    {
      params: t.Object({ id: t.String() }),
    }
  )
  .delete(
    "/:id",
    async ({ params, query, set, user, activeOrganization }) => {
      const existing = await getObservationById(params.id, {
        includeArchived: true,
        includeExpired: true,
      });
      if (!existing || existing.organizationId !== activeOrganization!.id) {
        set.status = 404;
        return notFoundResponse("Memory observation");
      }

      if (query.permanent === "true" && user?.role !== "admin") {
        set.status = 403;
        return errorResponse("Forbidden: admin role required", 403);
      }

      const result =
        query.permanent === "true"
          ? await deleteObservation(params.id)
          : await archiveObservation(params.id);

      if (!result) {
        set.status = 404;
        return notFoundResponse("Memory observation");
      }

      return successResponse({
        deleted: true,
        permanent: query.permanent === "true",
      });
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ permanent: t.Optional(t.String()) }),
    }
  );
