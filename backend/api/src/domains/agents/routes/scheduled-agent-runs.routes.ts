import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  getScheduledAgentRunsByConfigId,
  getScheduledAgentRunById,
} from "@almirant/database";
import { logger } from "@almirant/config";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../shared/services/response";

export const scheduledAgentRunsRoutes = new Elysia({ prefix: "/scheduled-agents" })
  .use(sessionContextTypes)

  // GET /scheduled-agents/:id/runs - List runs for a config (paginated)
  .get(
    "/:id/runs",
    async ({ params, query, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const { limit, offset, page } = parsePaginationParams(query as Record<string, string | undefined>);

        const { runs, total } = await getScheduledAgentRunsByConfigId(params.id, {
          limit,
          offset,
        });

        // Filter runs to only return those belonging to the user's workspace
        const orgRuns = runs.filter((run) => run.workspaceId === orgId);

        return successResponse(orgRuns, buildPaginationMeta(page, limit, total));
      } catch (error) {
        logger.error({ error }, "Failed to list scheduled agent runs");
        return errorResponse("Failed to list scheduled agent runs");
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Optional(
        t.Object({
          page: t.Optional(t.String()),
          limit: t.Optional(t.String()),
        })
      ),
    }
  )

  // GET /scheduled-agents/runs/:runId - Get a single run by ID
  .get(
    "/runs/:runId",
    async ({ params, set, activeWorkspace }) => {
      try {
        const orgId = activeWorkspace!.id;
        const run = await getScheduledAgentRunById(params.runId, orgId);

        if (!run) {
          set.status = 404;
          return notFoundResponse("Scheduled agent run");
        }

        return successResponse(run);
      } catch (error) {
        logger.error({ error }, "Failed to get scheduled agent run");
        return errorResponse("Failed to get scheduled agent run");
      }
    },
    {
      params: t.Object({
        runId: t.String(),
      }),
    }
  );
