import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  getSkills,
  getSkillById,
  createSkill,
  updateSkill,
  deleteSkill,
  getSkillsForSelector,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../shared/services/response";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const skillsRoutes = new Elysia({ prefix: "/skills" })
  .use(sessionContextTypes)

  // GET /skills - List with pagination + filters
  .get(
    "/",
    async ({ query, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const pagination = parsePaginationParams(query);

      const filters = {
        projectId: query.projectId || undefined,
        source: query.source as "official" | "custom" | "repo" | undefined,
        search: query.search || undefined,
        archived: query.archived === "true",
      };

      const { items, total } = await getSkills(orgId, pagination, filters);
      const meta = buildPaginationMeta(pagination.page, pagination.limit, total);

      return successResponse(items, meta);
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        source: t.Optional(t.String()),
        search: t.Optional(t.String()),
        archived: t.Optional(t.String()),
      }),
    }
  )

  // GET /skills/selector - Lightweight payload for dropdowns
  // MUST be defined before /:id to avoid matching "selector" as an id
  .get(
    "/selector",
    async ({ query, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const projectId = query.projectId || undefined;

      const items = await getSkillsForSelector(orgId, projectId);
      return successResponse(items);
    },
    {
      query: t.Object({
        projectId: t.Optional(t.String()),
      }),
    }
  )

  // GET /skills/:id - Detail
  .get(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;
      const skill = await getSkillById(orgId, params.id);

      if (!skill) {
        set.status = 404;
        return notFoundResponse("Skill");
      }

      return successResponse(skill);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // POST /skills - Create (auto-generate slug from name)
  .post(
    "/",
    async (ctx) => {
      const { body, set, activeWorkspace } = ctx;
      const orgId = activeWorkspace!.id;
      const user = (ctx as unknown as Record<string, unknown>).user as {
        id: string;
      } | null;

      if (!body.name || body.name.trim() === "") {
        set.status = 400;
        return errorResponse("Name is required");
      }

      if (!body.content || body.content.trim() === "") {
        set.status = 400;
        return errorResponse("Content is required");
      }

      const slug = slugify(body.name);

      const skill = await createSkill(orgId, {
        name: body.name.trim(),
        slug,
        description: body.description?.trim() || null,
        content: body.content,
        source: (body.source as "official" | "custom" | "repo") || "custom",
        projectId: body.projectId || null,
        createdByUserId: user?.id ?? null,
      });

      set.status = 201;
      return successResponse(skill);
    },
    {
      body: t.Object({
        name: t.String(),
        content: t.String(),
        description: t.Optional(t.String()),
        projectId: t.Optional(t.String()),
        source: t.Optional(t.String()),
      }),
    }
  )

  // PATCH /skills/:id - Update (reject official skills)
  .patch(
    "/:id",
    async ({ params, body, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;

      // Fetch existing skill to check source
      const existing = await getSkillById(orgId, params.id);

      if (!existing) {
        set.status = 404;
        return notFoundResponse("Skill");
      }

      if (existing.source === "official") {
        set.status = 403;
        return errorResponse("Official skills cannot be edited");
      }

      // Build update data, auto-generate slug if name changes
      const updateData: Record<string, unknown> = {};

      if (body.name !== undefined) {
        updateData.name = body.name.trim();
        updateData.slug = slugify(body.name);
      }
      if (body.description !== undefined) updateData.description = body.description;
      if (body.content !== undefined) updateData.content = body.content;
      if (body.projectId !== undefined) updateData.projectId = body.projectId;
      if (body.source !== undefined) updateData.source = body.source;

      const updated = await updateSkill(orgId, params.id, updateData);

      if (!updated) {
        set.status = 404;
        return notFoundResponse("Skill");
      }

      return successResponse(updated);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.Nullable(t.String())),
        content: t.Optional(t.String()),
        projectId: t.Optional(t.Nullable(t.String())),
        source: t.Optional(t.String()),
      }),
    }
  )

  // DELETE /skills/:id - Soft delete (reject official skills)
  .delete(
    "/:id",
    async ({ params, set, activeWorkspace }) => {
      const orgId = activeWorkspace!.id;

      // Fetch existing skill to check source
      const existing = await getSkillById(orgId, params.id);

      if (!existing) {
        set.status = 404;
        return notFoundResponse("Skill");
      }

      if (existing.source === "official") {
        set.status = 403;
        return errorResponse("Official skills cannot be deleted");
      }

      const deleted = await deleteSkill(orgId, params.id);

      if (!deleted) {
        set.status = 404;
        return notFoundResponse("Skill");
      }

      return successResponse({ deleted: true });
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
