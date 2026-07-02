import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTags, createTag, deleteTag } from "@almirant/database";
import { assertOrgScope } from "../setup";

export const registerTagsTools = (server: McpServer) => {
  // -------------------------------------------------------
  // list_tags - List all tags with lead count
  // -------------------------------------------------------
  server.tool(
    "list_tags",
    "List all tags in the system",
    {},
    async (_params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const tags = await getTags(workspaceId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(tags, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing tags: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // create_tag - Create a new tag
  // -------------------------------------------------------
  server.tool(
    "create_tag",
    "Create a new tag for organizing work items",
    {
      name: z.string().min(1).describe("Tag name (required, must be unique)"),
      color: z.string().optional().describe("Tag color as hex code (e.g. #ff5733)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const tag = await createTag(workspaceId, {
          name: params.name.trim(),
          color: params.color,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(tag, null, 2) }],
        };
      } catch (error) {
        // Check for unique constraint violation (PostgreSQL SQLSTATE 23505)
        if (error instanceof Error && 'code' in error && error.code === '23505') {
          return {
            content: [{ type: "text" as const, text: `Error: A tag with the name '${params.name}' already exists` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Error creating tag: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // delete_tag - Delete a tag
  // -------------------------------------------------------
  server.tool(
    "delete_tag",
    "Permanently delete a tag by ID. This will remove the tag from all associated entities.",
    {
      id: z.string().uuid().describe("Tag ID to delete"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const deleted = await deleteTag(workspaceId, params.id);

        if (!deleted) {
          return {
            content: [{ type: "text" as const, text: `Error: Tag with ID '${params.id}' not found` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, id: params.id }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error deleting tag: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};
