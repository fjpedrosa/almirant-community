import { Elysia, t } from "elysia";
import {
  db,
  desc,
  eq,
  effortEstimationRequests,
  getActiveConfig,
  projects,
  updateActiveConfig,
  workItems,
} from "@almirant/database";
import type { EffortEstimatorConfigPatch } from "@almirant/database";
import { requireAdmin } from "../../../middleware/require-admin.middleware";
import {
  errorResponse,
  notFoundResponse,
  successResponse,
} from "../../../shared/services/response";
import {
  invalidateConfigCache,
  runEffortEstimation,
} from "../../agents/services/effort-estimator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_REQUESTS_LIMIT = 50;
const MAX_REQUESTS_LIMIT = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Loads the work item + direct children needed to invoke runEffortEstimation.
 * Returns null when the work item does not exist so the caller can respond
 * with a 404. We do not filter out `idea` types here because the admin test
 * endpoint is intentionally more permissive than the background sweeper —
 * operators may want to preview estimations against any work item.
 */
const loadRunParamsForAdminTest = async (
  workItemId: string,
): Promise<Parameters<typeof runEffortEstimation>[0] | null> => {
  const [row] = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      description: workItems.description,
      type: workItems.type,
      parentId: workItems.parentId,
      workspaceId: projects.workspaceId,
    })
    .from(workItems)
    .leftJoin(projects, eq(projects.id, workItems.projectId))
    .where(eq(workItems.id, workItemId))
    .limit(1);

  if (!row) return null;

  const childRows = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      type: workItems.type,
    })
    .from(workItems)
    .where(eq(workItems.parentId, workItemId));

  const config = await getActiveConfig();
  if (!config) {
    throw new Error(
      "No active effort-estimator config found. Configure one before running a test.",
    );
  }

  return {
    workItem: {
      id: row.id,
      title: row.title,
      description: row.description,
      type: row.type,
      parentId: row.parentId,
      workspaceId: row.workspaceId ?? null,
    },
    children: childRows.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
    })),
    config: {
      provider: config.provider,
      model: config.model,
      temperature: Number(config.temperature),
      maxTokens: config.maxTokens,
      systemPrompt: config.systemPrompt,
    },
    dryRun: true,
  };
};

// ---------------------------------------------------------------------------
// Routes — instance-admin surface (community has no separate backoffice, so
// the effort-estimator config lives with the rest of the instance admin API
// under /instance/effort-estimator, gated by requireAdmin).
// ---------------------------------------------------------------------------

export const effortEstimatorRoutes = new Elysia({
  prefix: "/instance/effort-estimator",
})
  .use(requireAdmin)

  // -------------------------------------------------------
  // GET /instance/effort-estimator/config - active singleton row
  // -------------------------------------------------------
  .get("/config", async ({ set }) => {
    try {
      const config = await getActiveConfig();
      if (!config) {
        set.status = 404;
        return notFoundResponse("Effort estimator config");
      }
      return successResponse(config);
    } catch (error) {
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to fetch effort estimator config",
        500,
      );
    }
  })

  // -------------------------------------------------------
  // PATCH /instance/effort-estimator/config - in-place update of singleton
  // -------------------------------------------------------
  .patch(
    "/config",
    async (ctx) => {
      try {
        const user = (ctx as unknown as Record<string, unknown>).user as {
          id: string;
        };

        const patch: EffortEstimatorConfigPatch = {};
        if (ctx.body.provider !== undefined) patch.provider = ctx.body.provider;
        if (ctx.body.model !== undefined) patch.model = ctx.body.model;
        if (ctx.body.temperature !== undefined)
          patch.temperature = ctx.body.temperature;
        if (ctx.body.maxTokens !== undefined)
          patch.maxTokens = ctx.body.maxTokens;
        if (ctx.body.systemPrompt !== undefined)
          patch.systemPrompt = ctx.body.systemPrompt;

        const updated = await updateActiveConfig(patch, user.id);
        if (!updated) {
          ctx.set.status = 404;
          return notFoundResponse("Effort estimator config");
        }

        // Drop the in-memory cache so the next estimation reads fresh values.
        invalidateConfigCache();

        return successResponse(updated);
      } catch (error) {
        ctx.set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to update effort estimator config",
          500,
        );
      }
    },
    {
      body: t.Object({
        provider: t.Optional(
          t.Union([
            t.Literal("anthropic"),
            t.Literal("openai"),
            t.Literal("google"),
            t.Literal("zai"),
            t.Literal("xai"),
          ]),
        ),
        model: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        temperature: t.Optional(t.Number({ minimum: 0, maximum: 2 })),
        maxTokens: t.Optional(
          t.Integer({ minimum: 256, maximum: 4096 }),
        ),
        systemPrompt: t.Optional(t.String({ minLength: 1 })),
      }),
    },
  )

  // -------------------------------------------------------
  // POST /instance/effort-estimator/test - dry-run estimation for a work item
  // -------------------------------------------------------
  .post(
    "/test",
    async ({ body, set }) => {
      try {
        const params = await loadRunParamsForAdminTest(body.workItemId);
        if (!params) {
          set.status = 404;
          return notFoundResponse("Work item");
        }

        const outcome = await runEffortEstimation(params);

        // The current runEffortEstimation contract returns
        //   { result, tokensUsed, latencyMs, contentHash, source }
        // where `source` is "llm" or "fallback_heuristic". When the fallback
        // heuristic was applied we surface a `heuristic: true` flag so an
        // admin UI can render a warning banner. If a future version of
        // runEffortEstimation already includes a `heuristic`-shaped field we
        // pass it through unchanged.
        const outcomeRecord = outcome as unknown as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(outcomeRecord, "heuristic")) {
          return successResponse({
            result: outcome.result,
            latencyMs: outcome.latencyMs,
            tokensUsed: outcome.tokensUsed,
            heuristic: outcomeRecord.heuristic,
          });
        }

        return successResponse({
          result: outcome.result,
          latencyMs: outcome.latencyMs,
          tokensUsed: outcome.tokensUsed,
          source: outcome.source,
          contentHash: outcome.contentHash,
          heuristic: outcome.source === "fallback_heuristic",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        // Defensive 404: if loadRunParamsForAdminTest or a nested call throws
        // a NotFound-shaped error, translate it to a 404 response.
        if (/not[\s_-]?found/i.test(message)) {
          set.status = 404;
          return notFoundResponse("Work item");
        }

        set.status = 500;
        return errorResponse(message, 500);
      }
    },
    {
      body: t.Object({
        workItemId: t.String({ minLength: 1 }),
      }),
    },
  )

  // -------------------------------------------------------
  // GET /instance/effort-estimator/requests - recent estimation requests
  // -------------------------------------------------------
  .get(
    "/requests",
    async ({ query, set }) => {
      try {
        const limit = Math.min(
          MAX_REQUESTS_LIMIT,
          Math.max(1, query.limit ?? DEFAULT_REQUESTS_LIMIT),
        );

        const rows = query.status
          ? await db
              .select()
              .from(effortEstimationRequests)
              .where(eq(effortEstimationRequests.status, query.status))
              .orderBy(desc(effortEstimationRequests.createdAt))
              .limit(limit)
          : await db
              .select()
              .from(effortEstimationRequests)
              .orderBy(desc(effortEstimationRequests.createdAt))
              .limit(limit);

        return successResponse(rows);
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to list effort estimation requests",
          500,
        );
      }
    },
    {
      query: t.Object({
        status: t.Optional(
          t.Union([
            t.Literal("pending"),
            t.Literal("processing"),
            t.Literal("done"),
            t.Literal("failed"),
          ]),
        ),
        limit: t.Optional(
          t.Integer({ minimum: 1, maximum: MAX_REQUESTS_LIMIT }),
        ),
      }),
    },
  );
