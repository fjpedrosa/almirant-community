import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  db,
  boards,
  getBoardById,
  desc,
  eq,
} from "@almirant/database";
import { assertOrgScope } from "../setup";

// Helper: list boards scoped to workspaceId
const listBoards = async (workspaceId: string) => {
  const boardsResult = await db
    .select({
      id: boards.id,
      name: boards.name,
      description: boards.description,
      area: boards.area,
      isDefault: boards.isDefault,
      createdAt: boards.createdAt,
      updatedAt: boards.updatedAt,
    })
    .from(boards)
    .where(eq(boards.workspaceId, workspaceId))
    .orderBy(desc(boards.createdAt));

  return boardsResult.map((b) => ({
    ...b,
    isDefault: b.isDefault ?? false,
  }));
};

export const registerBoardsTools = (server: McpServer) => {
  // -------------------------------------------------------
  // list_boards - List all boards (filtered by project if projectId is configured)
  // -------------------------------------------------------
  server.tool(
    "list_boards",
    "List all boards in the workspace, including area. Boards are workspace-scoped.",
    {},
    async (_params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const allBoards = await listBoards(workspaceId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(allBoards, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing boards: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_board - Get a single board by ID with columns
  // -------------------------------------------------------
  server.tool(
    "get_board",
    "Get a single board by ID, including its columns and work item count",
    {
      id: z.string().uuid().describe("Board ID"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const board = await getBoardById(params.id, workspaceId);

        if (!board) {
          return {
            content: [{ type: "text" as const, text: `Error: Board with ID '${params.id}' not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(board, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error fetching board: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};
