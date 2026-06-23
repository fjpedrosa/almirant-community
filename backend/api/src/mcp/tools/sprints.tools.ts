import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getSprintsByBoard,
  getSprintById,
  getActiveSprint,
  createSprint,
  closeSprint,
  closeSprintAdHoc,
  closeSprintByDate,
  getSprintWorkItems,
  getDoneItemsPreview,
  getBoardById,
} from "@almirant/database";
import { notifySprintClosed } from "../../domains/integrations/telegram/services/telegram/notifications";
import { emailNotifySprintClosed } from "../../shared/services/email/notifications";
import { kickoffSprintVisualReportGeneration } from "../../domains/project-management/sprints/services/sprint-visual-report-service";
import { kickoffSprintChangelogGeneration, generateSprintChangelog } from "../../domains/project-management/sprints/services/sprint-changelog-service";
import { assertOrgScope } from "../setup";

export const registerSprintsTools = (server: McpServer) => {
  // -------------------------------------------------------
  // list_sprints - List all sprints for a board
  // -------------------------------------------------------
  server.tool(
    "list_sprints",
    "List all sprints for a board. Open sprint appears first, then closed sprints by most recent.",
    {
      boardId: z.string().uuid().describe("Board ID to list sprints for (required)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const sprints = await getSprintsByBoard(organizationId, params.boardId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(sprints, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing sprints: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_sprint - Get a sprint by ID
  // -------------------------------------------------------
  server.tool(
    "get_sprint",
    "Get a sprint by its ID, including work item count",
    {
      id: z.string().uuid().describe("Sprint ID (required)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const sprint = await getSprintById(organizationId, params.id);

        if (!sprint) {
          return {
            content: [{ type: "text" as const, text: `Error: Sprint with ID '${params.id}' not found` }],
            isError: true,
          };
        }

        const board = await getBoardById(sprint.boardId, organizationId);
        if (!board) {
          return { content: [{ type: "text" as const, text: `Error: Sprint does not belong to your organization` }], isError: true };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(sprint, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting sprint: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_active_sprint - Get the active (open) sprint for a board
  // -------------------------------------------------------
  server.tool(
    "get_active_sprint",
    "Get the currently active (open) sprint for a board. Returns null if no sprint is open.",
    {
      boardId: z.string().uuid().describe("Board ID to check for active sprint (required)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const sprint = await getActiveSprint(organizationId, params.boardId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(sprint, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting active sprint: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // create_sprint - Create a new sprint on a board
  // -------------------------------------------------------
  server.tool(
    "create_sprint",
    "Create a new sprint on a board. Only one sprint can be open at a time per board.",
    {
      boardId: z.string().uuid().describe("Board ID to create the sprint in (required)"),
      name: z.string().min(1).describe("Sprint name (required)"),
      startDate: z.string().optional().describe("Sprint start date (ISO 8601 format, optional)"),
      endDate: z.string().optional().describe("Sprint end date (ISO 8601 format, optional)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const sprint = await createSprint(organizationId, {
          boardId: params.boardId,
          name: params.name,
          startDate: params.startDate,
          endDate: params.endDate,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(sprint, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating sprint: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // close_sprint - Close an existing sprint and archive done items
  // -------------------------------------------------------
  server.tool(
    "close_sprint",
    "Close an open sprint. Archives all work items in 'done' columns and records them as sprint work items. Optionally filter by date range to only include items completed within that period.",
    {
      sprintId: z.string().uuid().describe("Sprint ID to close (required)"),
      boardId: z.string().uuid().describe("Board ID the sprint belongs to (required)"),
      startDate: z.string().optional().describe("Optional start date (ISO 8601) to filter items by finishedAt >= startDate"),
      endDate: z.string().optional().describe("Optional end date (ISO 8601) to filter items by finishedAt <= endDate"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const preview = await getDoneItemsPreview(organizationId, params.boardId);
        const options = params.startDate || params.endDate
          ? { startDate: params.startDate, endDate: params.endDate }
          : undefined;
        const sprint = await closeSprint(organizationId, params.sprintId, params.boardId, options);
        kickoffSprintVisualReportGeneration({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
        });
        kickoffSprintChangelogGeneration({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
        });

        notifySprintClosed({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
          completedCount: sprint.workItemCount ?? 0,
          totalCount: preview.length,
        });
        emailNotifySprintClosed({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
          completedCount: sprint.workItemCount ?? 0,
          totalCount: preview.length,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(sprint, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error closing sprint: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // close_sprint_adhoc - Create and close a sprint in one step
  // -------------------------------------------------------
  server.tool(
    "close_sprint_adhoc",
    "Create and immediately close a sprint in a single transaction. Useful for retroactively recording a sprint. Optionally filter by date range to only include items completed within that period.",
    {
      boardId: z.string().uuid().describe("Board ID to create the ad-hoc sprint in (required)"),
      name: z.string().min(1).describe("Sprint name (required)"),
      startDate: z.string().optional().describe("Optional start date (ISO 8601) to filter items by finishedAt >= startDate"),
      endDate: z.string().optional().describe("Optional end date (ISO 8601) to filter items by finishedAt <= endDate"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const preview = await getDoneItemsPreview(organizationId, params.boardId);
        const options = params.startDate || params.endDate
          ? { startDate: params.startDate, endDate: params.endDate }
          : undefined;
        const sprint = await closeSprintAdHoc(organizationId, params.boardId, params.name, options);
        kickoffSprintVisualReportGeneration({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
        });
        kickoffSprintChangelogGeneration({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
        });

        notifySprintClosed({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
          completedCount: sprint.workItemCount ?? 0,
          totalCount: preview.length,
        });
        emailNotifySprintClosed({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
          completedCount: sprint.workItemCount ?? 0,
          totalCount: preview.length,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(sprint, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error closing ad-hoc sprint: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // close_sprint_by_date - Create and close a sprint with explicit dates
  // -------------------------------------------------------
  server.tool(
    "close_sprint_by_date",
    "Create and immediately close a sprint with explicit start and end dates in a single transaction. Useful for retroactively recording a sprint that covered a specific date range. Archives all work items currently in 'done' columns.",
    {
      boardId: z.string().uuid().describe("Board ID to create the sprint in (required)"),
      name: z.string().min(1).describe("Sprint name (required)"),
      startDate: z.string().describe("Sprint start date in ISO 8601 format, e.g. '2025-01-01' (required)"),
      endDate: z.string().describe("Sprint end date in ISO 8601 format, e.g. '2025-01-14' (required)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const preview = await getDoneItemsPreview(organizationId, params.boardId);
        const sprint = await closeSprintByDate(organizationId, params.boardId, params.name, params.startDate, params.endDate);
        kickoffSprintVisualReportGeneration({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
        });
        kickoffSprintChangelogGeneration({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
        });

        notifySprintClosed({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
          completedCount: sprint.workItemCount ?? 0,
          totalCount: preview.length,
        });
        emailNotifySprintClosed({
          sprintId: sprint.id,
          boardId: params.boardId,
          sprintName: sprint.name,
          completedCount: sprint.workItemCount ?? 0,
          totalCount: preview.length,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(sprint, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error closing sprint by date: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_sprint_work_items - List work items archived in a sprint
  // -------------------------------------------------------
  server.tool(
    "get_sprint_work_items",
    "List all work items that were completed and archived in a specific sprint",
    {
      sprintId: z.string().uuid().describe("Sprint ID to get work items for (required)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const items = await getSprintWorkItems(organizationId, params.sprintId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting sprint work items: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // preview_done_items - Preview items that would be archived when closing a sprint
  // -------------------------------------------------------
  server.tool(
    "preview_done_items",
    "Preview work items in 'done' columns that would be archived when closing a sprint. Use before close_sprint to review.",
    {
      boardId: z.string().uuid().describe("Board ID to preview done items for (required)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const items = await getDoneItemsPreview(organizationId, params.boardId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(items, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error previewing done items: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // regenerate_sprint_changelog - Regenerate changelog for a closed sprint
  // -------------------------------------------------------
  server.tool(
    "regenerate_sprint_changelog",
    "Regenerate the changelog document for a closed sprint. Useful to regenerate after prompt improvements or for older sprints that lack a changelog. Waits for completion and returns the document ID.",
    {
      sprintId: z.string().uuid().describe("Sprint ID to regenerate changelog for (required)"),
      fallbackStrategy: z.enum(["list-only", "ai-analyze", "skip"]).optional().describe("Strategy for items without AI documentation: 'list-only' (default) lists them without summary, 'ai-analyze' generates AI summaries on the fly, 'skip' omits undocumented items entirely"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const sprint = await getSprintById(organizationId, params.sprintId);

        if (!sprint) {
          return {
            content: [{ type: "text" as const, text: `Error: Sprint with ID '${params.sprintId}' not found` }],
            isError: true,
          };
        }

        const board = await getBoardById(sprint.boardId, organizationId);
        if (!board) {
          return { content: [{ type: "text" as const, text: `Error: Sprint does not belong to your organization` }], isError: true };
        }

        if (sprint.status !== "closed") {
          return {
            content: [{ type: "text" as const, text: `Error: Sprint '${sprint.name}' is not closed (status: ${sprint.status}). Only closed sprints can have changelogs generated.` }],
            isError: true,
          };
        }

        const result = await generateSprintChangelog({
          sprintId: sprint.id,
          boardId: sprint.boardId,
          sprintName: sprint.name,
          fallbackStrategy: params.fallbackStrategy,
        });

        if (!result) {
          return {
            content: [{ type: "text" as const, text: `No changelog generated for sprint '${sprint.name}'. The sprint may have no completed items.` }],
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            message: `Changelog generated successfully for sprint '${sprint.name}'`,
            documentId: result.documentId,
          }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error regenerating changelog: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};
