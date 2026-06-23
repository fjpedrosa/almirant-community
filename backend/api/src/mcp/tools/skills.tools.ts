import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getSkills,
  getSkillById,
  getSkillBySlug,
  createSkill,
  updateSkill,
  deleteSkill,
} from "@almirant/database";
import { assertOrgScope, getProjectIdFromExtra, getUserIdFromExtra } from "../setup";

const SOURCE_VALUES = ["official", "custom", "repo"] as const;

export const registerSkillsTools = (server: McpServer) => {
  // -------------------------------------------------------
  // list_skills - List skills with pagination and filters
  // -------------------------------------------------------
  server.tool(
    "list_skills",
    "List agent skills available to the active organization. Returns official, workspace and project-scoped skills (when a projectId is configured). Supports search and source filters.",
    {
      page: z.number().int().min(1).optional().describe("Page number (default: 1)"),
      limit: z.number().int().min(1).max(100).optional().describe("Items per page (default: 50)"),
      search: z.string().optional().describe("Filter by name or description"),
      source: z.enum(SOURCE_VALUES).optional().describe("Filter by skill source"),
      projectId: z.string().uuid().optional().describe("Project ID; falls back to MCP session projectId when omitted"),
      archived: z.boolean().optional().describe("If true, returns only archived skills"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const page = params.page ?? 1;
        const limit = params.limit ?? 50;
        const offset = (page - 1) * limit;

        const projectId = params.projectId ?? getProjectIdFromExtra(extra) ?? undefined;

        const { items, total } = await getSkills(
          organizationId,
          { page, limit, offset },
          {
            projectId,
            source: params.source,
            search: params.search,
            archived: params.archived,
          },
        );

        const result = {
          skills: items,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1,
          },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing skills: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // get_skill - Get a single skill (by id or slug)
  // -------------------------------------------------------
  server.tool(
    "get_skill",
    "Get a single skill by ID, or by slug if `slug` is provided instead. Slug lookup honours scoping (project > workspace > official) and skips archived skills.",
    {
      id: z.string().uuid().optional().describe("Skill ID"),
      slug: z.string().optional().describe("Skill slug (alternative to id)"),
      projectId: z.string().uuid().optional().describe("Project ID for slug scope; falls back to MCP session projectId"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        if (!params.id && !params.slug) {
          return {
            content: [{ type: "text" as const, text: "Error: provide either `id` or `slug`" }],
            isError: true,
          };
        }

        const skill = params.id
          ? await getSkillById(organizationId, params.id)
          : await getSkillBySlug(
              organizationId,
              params.slug!,
              params.projectId ?? getProjectIdFromExtra(extra) ?? undefined,
            );

        if (!skill) {
          return {
            content: [{ type: "text" as const, text: `Error: skill not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(skill, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching skill: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // create_skill - Create a new skill
  // -------------------------------------------------------
  server.tool(
    "create_skill",
    "Create a new agent skill. The slug must be unique within the (organization, project) scope. Content stores the SKILL.md body verbatim.",
    {
      name: z.string().min(1).describe("Display name"),
      slug: z.string().min(1).describe("Unique slug within the scope"),
      content: z.string().min(1).describe("SKILL.md body"),
      description: z.string().optional().describe("Short description"),
      source: z.enum(SOURCE_VALUES).optional().describe("Skill source (default: 'custom')"),
      sourcePath: z.string().optional().describe("Path to the skill file when imported from a repo"),
      projectId: z.string().uuid().optional().describe("Project scope; omit for workspace scope. Falls back to MCP session projectId"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const skill = await createSkill(organizationId, {
          name: params.name,
          slug: params.slug,
          description: params.description ?? null,
          content: params.content,
          source: params.source,
          sourcePath: params.sourcePath ?? null,
          projectId: params.projectId ?? getProjectIdFromExtra(extra) ?? null,
          createdByUserId: getUserIdFromExtra(extra) ?? null,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(skill, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating skill: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // update_skill - Update an existing skill
  // -------------------------------------------------------
  server.tool(
    "update_skill",
    "Update an existing skill. Official skills (organizationId IS NULL) cannot be edited via this tool. Bumps the version when content changes.",
    {
      id: z.string().uuid().describe("Skill ID"),
      name: z.string().min(1).optional().describe("Updated display name"),
      slug: z.string().min(1).optional().describe("Updated slug"),
      content: z.string().optional().describe("Updated SKILL.md body"),
      description: z.string().optional().describe("Updated description"),
      source: z.enum(SOURCE_VALUES).optional(),
      sourcePath: z.string().optional(),
      projectId: z.string().uuid().nullable().optional().describe("Move to a new project scope; null = workspace scope"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const { id, ...rest } = params;
        const skill = await updateSkill(organizationId, id, rest);

        if (!skill) {
          return {
            content: [{ type: "text" as const, text: `Error: skill ${id} not found or read-only` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(skill, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating skill: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // -------------------------------------------------------
  // delete_skill - Soft-delete (archive) a skill
  // -------------------------------------------------------
  server.tool(
    "delete_skill",
    "Archive a skill (soft delete). The skill is preserved with `archivedAt` set and excluded from default list queries.",
    {
      id: z.string().uuid().describe("Skill ID"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const archived = await deleteSkill(organizationId, params.id);
        if (!archived) {
          return {
            content: [{ type: "text" as const, text: `Error: skill ${params.id} not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(archived, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deleting skill: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
};
