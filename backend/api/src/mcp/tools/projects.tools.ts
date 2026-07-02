import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  getProjectRoadmap,
} from "@almirant/database";
import { getProjectIdFromExtra, assertOrgScope } from "../setup";

export const registerProjectsTools = (server: McpServer) => {
  // -------------------------------------------------------
  // list_projects - List projects with pagination
  // -------------------------------------------------------
  server.tool(
    "list_projects",
    "List all projects with optional pagination. If a projectId is configured in the MCP session, only that project is returned.",
    {
      page: z.number().int().min(1).optional().describe("Page number (default: 1)"),
      limit: z.number().int().min(1).max(100).optional().describe("Items per page (default: 50, max: 100)"),
      includeArchived: z.boolean().optional().describe("Include archived projects in results (default: false)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const page = params.page ?? 1;
        const limit = params.limit ?? 50;
        const offset = (page - 1) * limit;

        // If a default projectId is configured, return only that project
        const defaultProjectId = getProjectIdFromExtra(extra);
        if (defaultProjectId) {
          const project = await getProjectById(workspaceId, defaultProjectId);
          if (!project) {
            return {
              content: [{ type: "text" as const, text: `Error: Configured project with ID '${defaultProjectId}' not found` }],
              isError: true,
            };
          }
          const result = {
            projects: [project],
            pagination: { page: 1, limit: 1, total: 1, totalPages: 1 },
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        const filters = params.includeArchived ? { includeArchived: true } : undefined;
        const { projects, total } = await getProjects(workspaceId, { page, limit, offset }, filters);

        const result = {
          projects,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing projects: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_project - Get a single project by ID with relations
  // -------------------------------------------------------
  server.tool(
    "get_project",
    "Get a single project by ID, including boards, doc links, and notes",
    {
      id: z.string().uuid().describe("Project ID"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const project = await getProjectById(workspaceId, params.id);

        if (!project) {
          return {
            content: [{ type: "text" as const, text: `Error: Project with ID '${params.id}' not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error fetching project: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // create_project - Create a new project
  // -------------------------------------------------------
  server.tool(
    "create_project",
    "Create a new project. Name is required.",
    {
      name: z.string().min(1).describe("Project name (required)"),
      description: z.string().optional().describe("Project description"),
      status: z.string().optional().describe("Project status (e.g. active, archived)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const project = await createProject(workspaceId, {
          name: params.name,
          description: params.description,
          status: params.status as "active" | "archived" | "on_hold" | undefined,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating project: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // update_project - Update an existing project
  // -------------------------------------------------------
  server.tool(
    "update_project",
    "Update an existing project's fields. Only provided fields will be updated.",
    {
      id: z.string().uuid().describe("Project ID to update"),
      name: z.string().min(1).optional().describe("Updated project name"),
      description: z.string().optional().describe("Updated description"),
      status: z.string().optional().describe("Updated status"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const { id, ...updateData } = params;

        const project = await updateProject(workspaceId, id, {
          ...updateData,
          status: updateData.status as "active" | "archived" | "on_hold" | undefined,
        });

        if (!project) {
          return {
            content: [{ type: "text" as const, text: `Error: Project with ID '${id}' not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(project, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating project: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_project_roadmap - Get project roadmap with hierarchy and dates
  // -------------------------------------------------------
  server.tool(
    "get_project_roadmap",
    "Get the project roadmap with hierarchical structure (epics → features → stories/tasks) and calculated dates from work item activity. Dates are computed from board column move events: startDate is when an item first moved to an active column, endDate is when it moved to a done column. Parent items aggregate dates from their children.",
    {
      projectId: z.string().uuid().describe("Project ID (required)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        // Use the provided projectId, or fall back to the session-configured one
        const projectId = params.projectId || getProjectIdFromExtra(extra);

        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required. Provide it as a parameter or configure it in the MCP session." }],
            isError: true,
          };
        }

        // Verify project belongs to the workspace
        const project = await getProjectById(workspaceId, projectId);
        if (!project) {
          return {
            content: [{ type: "text" as const, text: `Error: Project with ID '${projectId}' not found or does not belong to your workspace` }],
            isError: true,
          };
        }

        const roadmap = await getProjectRoadmap(projectId);

        if (!roadmap) {
          return {
            content: [{ type: "text" as const, text: `Error: Project with ID '${projectId}' not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(roadmap, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error fetching project roadmap: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};
