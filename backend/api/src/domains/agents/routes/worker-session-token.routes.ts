import { Elysia, t } from "elysia";
import { validateApiKey, db, projects, eq, and, getJobById } from "@almirant/database";
import type { ApiKey } from "@almirant/database";
import { env } from "@almirant/config";
import { requiresInternalMcp } from "@almirant/shared";
import { errorResponse, successResponse } from "../../../shared/services/response";
import {
  AUTOMATION_BOT_USER_ID,
  generateSessionToken,
  computeExpiresAt,
  resolveSessionActorUserId,
} from "../../../shared/services/session-token";

/**
 * Default MCP permissions granted to agent session tokens.
 * These cover the standard read/write operations an agent container needs.
 */
const DEFAULT_AGENT_PERMISSIONS = [
  "mcp:read",
  "mcp:write",
];

/**
 * Worker session token routes.
 *
 * POST /workers/session-token
 *   Authenticated with the worker API key (same as other /workers/* endpoints).
 *   Returns a short-lived JWT scoped to a specific project/organization.
 *   The runner injects this token into the agent container instead of the global API key.
 */
export const workerSessionTokenRoutes = new Elysia({ prefix: "/workers" })
  .derive({ as: "scoped" }, async ({ request }) => {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return { workerApiKey: null as ApiKey | null };
    const raw = authHeader.slice(7);
    const apiKey = await validateApiKey(raw);
    return { workerApiKey: (apiKey ?? null) as ApiKey | null };
  })
  .onBeforeHandle(({ workerApiKey, set }) => {
    if (!workerApiKey) {
      set.status = 401;
      return errorResponse("Unauthorized");
    }
  })

  .post(
    "/session-token",
    async ({ body, set, workerApiKey }) => {
      // Shared/dynamic runners may have an API key from a different org than the
      // job they are processing.  Validate that the requested organization and
      // project are consistent with each other (the project must belong to the
      // requested org), but do NOT require the API key's org to match — that
      // would break the multi-tenant runner model.
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, body.projectId),
            eq(projects.organizationId, body.organizationId)
          )
        )
        .limit(1);
      if (!project) {
        set.status = 403;
        return errorResponse("Project does not belong to the specified organization");
      }

      // Signing secret: reuse ENCRYPTION_KEY or fall back to a dedicated env var.
      // ENCRYPTION_KEY is a 64-char hex string already validated by config.
      const signingSecret = env.ENCRYPTION_KEY;
      if (!signingSecret) {
        set.status = 500;
        return errorResponse(
          "Session token signing not configured. Set ENCRYPTION_KEY env variable.",
          500
        );
      }

      const ttlSeconds = body.ttlSeconds ?? 3600;
      const permissions = body.permissions ?? DEFAULT_AGENT_PERMISSIONS;

      // Validate that the requested permissions are within what this API key is
      // authorized to issue. Prevents privilege escalation via session tokens.
      const allowedByKey: string[] = workerApiKey!.allowedIssuedPermissions ?? DEFAULT_AGENT_PERMISSIONS;
      const unauthorized = permissions.filter((p) => !allowedByKey.includes(p));
      if (unauthorized.length > 0) {
        set.status = 403;
        return errorResponse(`API key not authorized to issue permissions: ${unauthorized.join(", ")}`);
      }

      const wantsInternal = permissions.includes("mcp:internal");

      let actorUserId: string | undefined;
      let jobDetail: Awaited<ReturnType<typeof getJobById>> | null = null;
      if (body.jobId) {
        jobDetail = await getJobById(body.jobId);
        if (!jobDetail) {
          set.status = 404;
          return errorResponse("Job not found", 404);
        }

        if (
          jobDetail.job.organizationId !== body.organizationId ||
          jobDetail.job.projectId !== body.projectId
        ) {
          set.status = 403;
          return errorResponse("Job does not belong to the specified project/organization");
        }

        actorUserId = resolveSessionActorUserId(jobDetail.job);
      }

      // Bypass-proof guard: only emit `mcp:internal` tokens for jobs that
      // (a) target an internal skill AND (b) were created by a system actor
      // (createdByUserId null, or the automation bot). This stops a
      // user-authored job from ever unlocking the `/mcp/internal` mount, even
      // if the runner mistakenly requests the permission.
      if (wantsInternal) {
        if (!body.jobId || !jobDetail) {
          set.status = 403;
          return errorResponse(
            "mcp:internal requires a jobId referencing a system-initiated internal job"
          );
        }

        const templateOrSkill =
          jobDetail.job.promptTemplate ?? jobDetail.job.skillName ?? null;
        const skillIsInternal = requiresInternalMcp(templateOrSkill);
        const createdBy = jobDetail.job.createdByUserId;
        const createdBySystem = createdBy == null || createdBy === AUTOMATION_BOT_USER_ID;

        if (!skillIsInternal || !createdBySystem) {
          set.status = 403;
          return errorResponse(
            "mcp:internal is only issued for system-initiated jobs bound to an internal skill"
          );
        }
      }

      const token = generateSessionToken({
        projectId: body.projectId,
        organizationId: body.organizationId,
        ...(actorUserId ? { userId: actorUserId } : {}),
        ...(body.jobId ? { jobId: body.jobId } : {}),
        permissions,
        sessionType: body.sessionType ?? "agent",
        ttlSeconds,
        signingSecret,
      });

      const expiresAt = computeExpiresAt(ttlSeconds);

      return successResponse({
        token,
        expiresAt: expiresAt.toISOString(),
        projectId: body.projectId,
        organizationId: body.organizationId,
        ...(actorUserId ? { userId: actorUserId } : {}),
      });
    },
    {
      body: t.Object({
        projectId: t.String({ minLength: 1 }),
        organizationId: t.String({ minLength: 1 }),
        jobId: t.Optional(t.String({ minLength: 1 })),
        ttlSeconds: t.Optional(t.Number({ minimum: 60, maximum: 86400 })),
        permissions: t.Optional(
          t.Array(t.Union([
            t.Literal("mcp:read"),
            t.Literal("mcp:write"),
            t.Literal("mcp:internal"),
            t.Literal("mcp:debug"),
          ]))
        ),
        sessionType: t.Optional(
          t.Union([t.Literal("agent"), t.Literal("worker")])
        ),
      }),
    }
  );
