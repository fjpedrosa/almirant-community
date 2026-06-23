import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getMilestonesByProject,
  getMilestoneById,
  getMilestoneProgress,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  addWorkItemsToMilestone,
  removeWorkItemFromMilestone,
} from "@almirant/database";
import { getProjectIdFromExtra, getOrganizationIdFromExtra } from "../setup";

const MILESTONE_STATUS_SCHEMA = z.enum(["planned", "in_progress", "completed", "on_hold", "cancelled"]);
const MILESTONE_PRIORITY_SCHEMA = z.enum(["low", "medium", "high", "urgent"]);

export const registerMilestonesTools = (server: McpServer) => {
  // -------------------------------------------------------
  // list_milestones - List all milestones for a project
  // -------------------------------------------------------
  server.tool(
    "list_milestones",
    "List all milestones (goals) for a project, including progress stats. Uses the session default projectId if none is provided.",
    {
      projectId: z.string().uuid().optional().describe("Project ID to list milestones for. Falls back to session default if omitted."),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required. Provide it as a parameter or configure it in the MCP session." }],
            isError: true,
          };
        }

        const milestones = await getMilestonesByProject(organizationId, projectId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(milestones, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing milestones: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_milestone - Get a single milestone by ID with work items
  // -------------------------------------------------------
  server.tool(
    "get_milestone",
    "Get a milestone (goal) by ID including its linked work items and progress stats.",
    {
      milestoneId: z.string().uuid().describe("Milestone ID (required)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const milestone = await getMilestoneById(organizationId, params.milestoneId);

        if (!milestone) {
          return {
            content: [{ type: "text" as const, text: `Error: Milestone with ID '${params.milestoneId}' not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(milestone, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting milestone: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_milestone_progress - Get progress stats for a milestone
  // -------------------------------------------------------
  server.tool(
    "get_milestone_progress",
    "Get progress stats (total items, completed items, percentage) for a milestone. Validates the milestone exists first.",
    {
      milestoneId: z.string().uuid().describe("Milestone ID (required)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        // Validate milestone exists
        const milestone = await getMilestoneById(organizationId, params.milestoneId);
        if (!milestone) {
          return {
            content: [{ type: "text" as const, text: `Error: Milestone with ID '${params.milestoneId}' not found` }],
            isError: true,
          };
        }

        const progress = await getMilestoneProgress(params.milestoneId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(progress, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting milestone progress: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // create_milestone - Create a new milestone
  // -------------------------------------------------------
  server.tool(
    "create_milestone",
    "Create a new milestone (goal) in a project. Optionally link work items to it at creation time. Uses the session default projectId if none is provided.",
    {
      projectId: z.string().uuid().optional().describe("Project ID. Falls back to session default if omitted."),
      title: z.string().min(1).describe("Milestone title (required)"),
      description: z.string().optional().describe("Milestone description"),
      priority: MILESTONE_PRIORITY_SCHEMA.optional().describe("Priority: low, medium, high, urgent (default: medium)"),
      targetDate: z.string().optional().describe("Target completion date (ISO 8601 format, e.g. '2026-03-15')"),
      workItemIds: z.array(z.string().uuid()).optional().describe("Work item IDs to link to this milestone at creation time"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [{ type: "text" as const, text: "Error: projectId is required. Provide it as a parameter or configure it in the MCP session." }],
            isError: true,
          };
        }

        const milestone = await createMilestone(organizationId, {
          projectId,
          title: params.title,
          description: params.description,
          priority: params.priority,
          targetDate: params.targetDate ? new Date(params.targetDate) : undefined,
        });

        if (!milestone) {
          return {
            content: [{ type: "text" as const, text: "Error: could not create milestone. The project may not exist or does not belong to the organization." }],
            isError: true,
          };
        }

        // Link work items if provided
        if (params.workItemIds && params.workItemIds.length > 0) {
          const linkedCount = await addWorkItemsToMilestone(milestone.id, params.workItemIds);
          const result = {
            ...milestone,
            linkedWorkItems: linkedCount,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(milestone, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating milestone: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // update_milestone - Update an existing milestone
  // -------------------------------------------------------
  server.tool(
    "update_milestone",
    "Update an existing milestone (goal). Only provided fields will be updated. Validates the milestone exists first.",
    {
      milestoneId: z.string().uuid().describe("Milestone ID to update (required)"),
      title: z.string().min(1).optional().describe("Updated title"),
      description: z.string().nullable().optional().describe("Updated description (null to clear)"),
      status: MILESTONE_STATUS_SCHEMA.optional().describe("Updated status: planned, in_progress, completed, on_hold, cancelled"),
      priority: MILESTONE_PRIORITY_SCHEMA.optional().describe("Updated priority: low, medium, high, urgent"),
      targetDate: z.string().nullable().optional().describe("Updated target date (ISO 8601 format, null to clear)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        // Validate milestone exists
        const existing = await getMilestoneById(organizationId, params.milestoneId);
        if (!existing) {
          return {
            content: [{ type: "text" as const, text: `Error: Milestone with ID '${params.milestoneId}' not found` }],
            isError: true,
          };
        }

        const updated = await updateMilestone(organizationId, params.milestoneId, {
          title: params.title,
          description: params.description,
          status: params.status,
          priority: params.priority,
          targetDate: params.targetDate === null ? null : params.targetDate ? new Date(params.targetDate) : undefined,
        });

        if (!updated) {
          return {
            content: [{ type: "text" as const, text: `Error: could not update milestone '${params.milestoneId}'` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(updated, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error updating milestone: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // delete_milestone - Delete a milestone
  // -------------------------------------------------------
  server.tool(
    "delete_milestone",
    "Delete a milestone (goal) by ID. Also removes all work item associations. Validates the milestone exists first.",
    {
      milestoneId: z.string().uuid().describe("Milestone ID to delete (required)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        // Validate milestone exists
        const existing = await getMilestoneById(organizationId, params.milestoneId);
        if (!existing) {
          return {
            content: [{ type: "text" as const, text: `Error: Milestone with ID '${params.milestoneId}' not found` }],
            isError: true,
          };
        }

        const deleted = await deleteMilestone(organizationId, params.milestoneId);

        if (!deleted) {
          return {
            content: [{ type: "text" as const, text: `Error: could not delete milestone '${params.milestoneId}'` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, milestoneId: params.milestoneId }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting milestone: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // add_work_items_to_milestone - Link work items to a milestone
  // -------------------------------------------------------
  server.tool(
    "add_work_items_to_milestone",
    "Link one or more work items to a milestone (goal). Duplicates are silently ignored. Validates the milestone exists first.",
    {
      milestoneId: z.string().uuid().describe("Milestone ID (required)"),
      workItemIds: z.array(z.string().uuid()).min(1).describe("Array of work item IDs to link (required, at least one)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        // Validate milestone exists
        const existing = await getMilestoneById(organizationId, params.milestoneId);
        if (!existing) {
          return {
            content: [{ type: "text" as const, text: `Error: Milestone with ID '${params.milestoneId}' not found` }],
            isError: true,
          };
        }

        const linkedCount = await addWorkItemsToMilestone(params.milestoneId, params.workItemIds);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ milestoneId: params.milestoneId, linkedCount }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error adding work items to milestone: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // remove_work_item_from_milestone - Unlink a work item from a milestone
  // -------------------------------------------------------
  server.tool(
    "remove_work_item_from_milestone",
    "Remove a work item from a milestone (goal). Validates the milestone exists first.",
    {
      milestoneId: z.string().uuid().describe("Milestone ID (required)"),
      workItemId: z.string().uuid().describe("Work item ID to remove (required)"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }

        // Validate milestone exists
        const existing = await getMilestoneById(organizationId, params.milestoneId);
        if (!existing) {
          return {
            content: [{ type: "text" as const, text: `Error: Milestone with ID '${params.milestoneId}' not found` }],
            isError: true,
          };
        }

        const removed = await removeWorkItemFromMilestone(params.milestoneId, params.workItemId);

        if (!removed) {
          return {
            content: [{ type: "text" as const, text: `Error: Work item '${params.workItemId}' is not linked to milestone '${params.milestoneId}'` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ removed: true, milestoneId: params.milestoneId, workItemId: params.workItemId }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error removing work item from milestone: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};
