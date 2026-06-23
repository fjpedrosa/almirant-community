import { Elysia, t } from "elysia";
import {
  validateApiKey,
  importSkillsFromRepo,
  getOrganizationIdByProjectId,
  getSkillById,
  getSkillBySlug,
} from "@almirant/database";
import { successResponse, errorResponse } from "../../../shared/services/response";
import { logger } from "@almirant/config";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

const requireSyncApiKey = async (request: Request): Promise<boolean> => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const raw = authHeader.slice(7);
  const apiKey = await validateApiKey(raw);
  return !!apiKey;
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Resolves the effective organizationId for a request.
 *
 * Service account API keys (used by runners) may override the org via the
 * `organizationId` parameter.  This is necessary because runners are shared
 * infrastructure — a single runner can claim jobs from any org, but its own
 * API key belongs to a single org.  The override is only allowed when the
 * key has a serviceAccountId (i.e. is a trusted SA key).
 *
 * Regular user API keys always resolve to their own org — the override
 * parameter is ignored to prevent cross-org skill access.
 */
const resolveOrgFromApiKey = async (
  request: Request,
  organizationIdOverride?: string,
): Promise<string | null> => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw = authHeader.slice(7);
  const apiKey = await validateApiKey(raw);
  if (!apiKey) return null;

  // Allow org override only for service account keys (trusted infrastructure)
  if (organizationIdOverride && apiKey.serviceAccountId) {
    return organizationIdOverride;
  }

  return apiKey.organizationId;
};

export const skillsSyncRoutes = new Elysia({ prefix: "/api/skills" })

  // GET /api/skills/resolve — Worker-only endpoint (API key auth)
  // Resolves a skill by ID or by slug (with optional projectId scope).
  // Used by the runner when it needs to fetch skill content.
  .get(
    "/resolve",
    async ({ query, request, set }) => {
      const orgId = await resolveOrgFromApiKey(request, query.organizationId);
      if (!orgId) {
        set.status = 401;
        return errorResponse("Unauthorized — valid API key required");
      }

      const { id, slug, projectId } = query;

      if (!id && !slug) {
        set.status = 400;
        return errorResponse("Either id or slug query parameter is required");
      }

      let skill = null;

      // Try by ID first
      if (id) {
        skill = await getSkillById(orgId, id);
      }

      // Fallback to slug
      if (!skill && slug) {
        skill = await getSkillBySlug(orgId, slug, projectId);
      }

      if (!skill) {
        set.status = 404;
        return errorResponse("Skill not found");
      }

      return successResponse({
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        content: skill.content,
        source: skill.source,
      });
    },
    {
      query: t.Object({
        id: t.Optional(t.String()),
        slug: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        organizationId: t.Optional(t.String()),
      }),
    },
  )

  // POST /api/skills/import-from-repo — Worker-only endpoint (API key auth)
  .post(
    "/import-from-repo",
    async ({ body, request, set }) => {
      // Auth: require a valid API key (used by runners)
      const authorized = await requireSyncApiKey(request);
      if (!authorized) {
        set.status = 401;
        return errorResponse("Unauthorized — valid API key required");
      }

      const { projectId, skills } = body;

      if (!skills.length) {
        return successResponse({ created: 0, updated: 0, skipped: 0 });
      }

      // Resolve organizationId from the projectId
      let orgId: string | null;
      try {
        orgId = await getOrganizationIdByProjectId(projectId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[skills-sync] Failed to resolve orgId for project ${projectId}: ${msg}`);
        set.status = 400;
        return errorResponse(`Could not resolve organization for project ${projectId}`);
      }

      if (!orgId) {
        set.status = 404;
        return errorResponse(`Project ${projectId} not found or has no organization`);
      }

      try {
        const result = await importSkillsFromRepo(orgId, projectId, skills);
        logger.info(
          `[skills-sync] Import completed for project ${projectId}: created=${result.created}, updated=${result.updated}, skipped=${result.skipped}`,
        );
        return successResponse(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[skills-sync] Import failed for project ${projectId}: ${msg}`);
        set.status = 500;
        return errorResponse(`Skill import failed: ${msg}`);
      }
    },
    {
      body: t.Object({
        projectId: t.String(),
        skills: t.Array(
          t.Object({
            name: t.String(),
            slug: t.String(),
            content: t.String(),
            contentHash: t.String(),
            sizeBytes: t.Number(),
            sourcePath: t.String(),
          }),
        ),
      }),
    },
  );
