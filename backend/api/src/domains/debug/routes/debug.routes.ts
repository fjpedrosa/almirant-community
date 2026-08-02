/**
 * Debug incident routes (HTTP surface for the debug pipeline)
 *
 * POST /debug/incidents                    — Build bundle on-demand (requires jobId)
 * GET  /debug/incidents/:bundleId          — Retrieve bundle + projected timeline
 * POST /debug/incidents/:bundleId/refresh  — Rebuild bundle from canonical sources
 * POST /debug/incidents/:bundleId/analyze  — Re-analyze with a fresh bundle
 *
 * Ported from the enterprise `domains/debug` module. Adaptations for cloud:
 *  - organization → workspace: `getIncidentBundleForWorkspace` /
 *    `updateIncidentBundleDataForWorkspace`, and the session context reads
 *    `activeWorkspace` instead of `activeOrganization`.
 *  - The unused `runAllInvariants` import (dead in the enterprise source) is
 *    dropped — cloud has no invariants module.
 *
 * Auth: mounted under the `/api` workspace-scoped group, so every request has
 * already passed `requireAuth` + `requireWorkspace` and carries a resolved
 * `activeWorkspace`. Tenant isolation is enforced per-query via
 * `getIncidentBundleForWorkspace` (a bundle from another workspace reads as
 * 404). This matches the enterprise debug module, which is workspace-session
 * scoped rather than admin-gated; we intentionally do NOT re-`.use` the named
 * `requireAdmin` singleton here to avoid Elysia's same-name plugin dedup
 * interfering with the sibling `/api/admin` guard.
 *
 * The frontend client hits `/debug/incidents/*`, which the API-base resolver
 * rewrites to `/api/debug/incidents/*`.
 */

import { Elysia, t } from "elysia";
import { env } from "@almirant/config";
import {
  createIncidentBundle,
  getIncidentBundleForWorkspace,
  updateIncidentBundleDataForWorkspace,
  createJob,
  db,
  feedbackItems,
  agentJobs,
  eq,
  sql,
} from "@almirant/database";
import { buildIncidentBundle } from "../services/build-incident-bundle";
import { projectIncidentTimeline } from "../services/project-incident-timeline";
import { successResponse, errorResponse, internalErrorResponse } from "../../../shared/services/response";
import { broadcastFeedbackItemUpdated } from "../../../shared/ws/feedback-events";
import { broadcastAgentJobStatusChanged } from "../../../shared/ws/agent-job-events";

const resolveWorkspaceId = (ctx: unknown): string =>
  (ctx as { activeWorkspace?: { id?: string } }).activeWorkspace?.id ?? "";

export const debugRoutes = new Elysia({ prefix: "/debug" })

  // --------------------------------------------------------------------------
  // POST /debug/incidents — Build an incident bundle on-demand.
  // Requires agentJobId to prove the caller owns the bundle's data source.
  // --------------------------------------------------------------------------
  .post(
    "/incidents",
    async (ctx) => {
      const { body, set } = ctx;
      const workspaceId = resolveWorkspaceId(ctx);

      try {
        // Require an explicit jobId — feedback-only creation is not permitted
        // because feedback_items has no workspaceId column and ownership
        // cannot be verified through feedback alone.
        if (!body.jobId) {
          set.status = 400;
          return errorResponse("jobId is required to create an incident bundle", 400);
        }

        // Verify the job belongs to the caller's workspace.
        const [job] = await db
          .select({ id: agentJobs.id, workspaceId: agentJobs.workspaceId })
          .from(agentJobs)
          .where(eq(agentJobs.id, body.jobId))
          .limit(1);

        if (!job) {
          set.status = 404;
          return errorResponse("Agent job not found", 404);
        }

        if (job.workspaceId !== workspaceId) {
          set.status = 403;
          return errorResponse("Forbidden: job belongs to a different workspace", 403);
        }

        const bundleData = await buildIncidentBundle({
          feedbackItemId: body.feedbackItemId ?? undefined,
          agentJobId: body.jobId,
          traceId: body.traceId ?? undefined,
          workspaceId,
        });

        const bundle = await createIncidentBundle({
          feedbackItemId: body.feedbackItemId ?? null,
          agentJobId: body.jobId,
          traceId: body.traceId ?? null,
          workspaceId,
          data: bundleData,
        });

        set.status = 201;
        return successResponse({ bundleId: bundle.id });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(error, { route: "/debug/incidents" }, "Failed to create bundle");
      }
    },
    {
      body: t.Object({
        feedbackItemId: t.Optional(t.String()),
        jobId: t.Optional(t.String()),
        traceId: t.Optional(t.String()),
      }),
    }
  )

  // --------------------------------------------------------------------------
  // GET /debug/incidents/:bundleId — Retrieve bundle + timeline (read-only)
  // --------------------------------------------------------------------------
  .get(
    "/incidents/:bundleId",
    async (ctx) => {
      const { params, set } = ctx;
      const workspaceId = resolveWorkspaceId(ctx);

      try {
        const bundleRow = await getIncidentBundleForWorkspace(workspaceId, params.bundleId);
        if (!bundleRow) {
          set.status = 404;
          return errorResponse("Incident bundle not found", 404);
        }

        const timeline = projectIncidentTimeline(bundleRow.data, params.bundleId);

        return successResponse({ bundle: bundleRow.data, timeline });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/debug/incidents/:bundleId", bundleId: params.bundleId },
          "Failed to get bundle",
        );
      }
    },
    { params: t.Object({ bundleId: t.String() }) }
  )

  // --------------------------------------------------------------------------
  // POST /debug/incidents/:bundleId/refresh — Rebuild bundle in place
  // --------------------------------------------------------------------------
  .post(
    "/incidents/:bundleId/refresh",
    async (ctx) => {
      const { params, set } = ctx;
      const workspaceId = resolveWorkspaceId(ctx);

      try {
        const bundleRow = await getIncidentBundleForWorkspace(workspaceId, params.bundleId);
        if (!bundleRow) {
          set.status = 404;
          return errorResponse("Incident bundle not found", 404);
        }

        const freshData = await buildIncidentBundle({
          feedbackItemId: bundleRow.feedbackItemId ?? undefined,
          agentJobId: bundleRow.agentJobId ?? undefined,
          traceId: bundleRow.traceId ?? undefined,
          workspaceId,
        });

        await updateIncidentBundleDataForWorkspace(workspaceId, params.bundleId, freshData);

        const timeline = projectIncidentTimeline(freshData, params.bundleId);

        return successResponse({ bundle: freshData, timeline });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/debug/incidents/:bundleId/refresh", bundleId: params.bundleId },
          "Failed to refresh bundle",
        );
      }
    },
    { params: t.Object({ bundleId: t.String() }) }
  )

  // --------------------------------------------------------------------------
  // POST /debug/incidents/:bundleId/analyze — Re-analyze with a fresh bundle.
  // Persists a new bundle row and, when DEBUG_SKILLS_ENABLED, enqueues an
  // `incident-analyze` agent job. Otherwise returns the new bundleId with no
  // jobId (the panel treats a missing jobId as "analysis unavailable").
  // --------------------------------------------------------------------------
  .post(
    "/incidents/:bundleId/analyze",
    async (ctx) => {
      const { params, set } = ctx;
      const workspaceId = resolveWorkspaceId(ctx);

      try {
        // 1. Load the existing bundle row to get filter columns
        const existingRow = await getIncidentBundleForWorkspace(workspaceId, params.bundleId);
        if (!existingRow) {
          set.status = 404;
          return errorResponse("Incident bundle not found", 404);
        }

        // 2. Build a new bundle from canonical sources
        const freshData = await buildIncidentBundle({
          feedbackItemId: existingRow.feedbackItemId ?? undefined,
          agentJobId: existingRow.agentJobId ?? undefined,
          traceId: existingRow.traceId ?? undefined,
          workspaceId,
        });

        // 3. Persist new bundle row
        const newBundle = await createIncidentBundle({
          feedbackItemId: existingRow.feedbackItemId,
          agentJobId: existingRow.agentJobId,
          traceId: existingRow.traceId,
          workspaceId,
          data: freshData,
        });

        // 4. Enqueue incident-analyze job when debug skills are enabled
        let jobId: string | undefined;
        if (env.DEBUG_SKILLS_ENABLED === "true") {
          if (existingRow.feedbackItemId) {
            const now = new Date().toISOString();
            await db
              .update(feedbackItems)
              .set({
                metadata: sql`jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      COALESCE(${feedbackItems.metadata}, '{}'::jsonb),
                      '{debugBundleId}',
                      to_jsonb(${newBundle.id}::text)
                    ),
                    '{debugAnalysisStatus}',
                    '"queued"'
                  ),
                  '{debugAnalysisStartedAt}',
                  to_jsonb(${now}::text)
                )`,
              })
              .where(eq(feedbackItems.id, existingRow.feedbackItemId));

            broadcastFeedbackItemUpdated({
              item: { id: existingRow.feedbackItemId },
              workspaceId,
              changes: {
                metadata: {
                  debugBundleId: newBundle.id,
                  debugAnalysisStatus: "queued",
                  debugAnalysisStartedAt: now,
                },
              },
            });
          }

          const job = await createJob({
            projectId: "00000000-0000-0000-0000-000000000000",
            workspaceId,
            jobType: "incident-analyze",
            provider: "claude-code",
            priority: "low",
            skillName: "incident-analyze",
            config: {
              repoPath: "/workspace/repo",
              baseBranch: "main",
              skillName: "incident-analyze",
              workspaceIntent: "read-only",
              postSessionPushPolicy: "never",
              bundleId: newBundle.id,
              feedbackItemId: existingRow.feedbackItemId ?? undefined,
              traceId: existingRow.traceId ?? undefined,
            },
          });
          broadcastAgentJobStatusChanged({
            workspaceId: job.workspaceId,
            jobId: job.id,
            status: job.status,
            workItemId: job.workItemId ?? null,
            planningSessionId: job.planningSessionId ?? null,
          });
          jobId = job.id;
        } else if (existingRow.feedbackItemId) {
          await db
            .update(feedbackItems)
            .set({
              metadata: sql`jsonb_set(
                COALESCE(${feedbackItems.metadata}, '{}'::jsonb)
                  - 'debugAnalysisStatus'
                  - 'debugAnalysisStartedAt',
                '{debugBundleId}',
                to_jsonb(${newBundle.id}::text)
              )`,
            })
            .where(eq(feedbackItems.id, existingRow.feedbackItemId));

          broadcastFeedbackItemUpdated({
            item: { id: existingRow.feedbackItemId },
            workspaceId,
            changes: {
              metadata: {
                debugBundleId: newBundle.id,
                debugAnalysisStatus: null,
                debugAnalysisStartedAt: null,
              },
            },
          });
        }

        set.status = 201;
        return successResponse({ bundleId: newBundle.id, jobId });
      } catch (error) {
        set.status = 500;
        return internalErrorResponse(
          error,
          { route: "/debug/incidents/:bundleId/analyze", bundleId: params.bundleId },
          "Failed to trigger analysis",
        );
      }
    },
    { params: t.Object({ bundleId: t.String() }) }
  );
