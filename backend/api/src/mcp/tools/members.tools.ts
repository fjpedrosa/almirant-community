import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMembersByOrganizationId } from "@almirant/database";
import { getOrganizationIdFromExtra } from "../setup";

export const registerMembersTools = (server: McpServer) => {
  server.tool(
    "list_members",
    "List all members of the current workspace. Returns userId, name, email, image, and role for each member. Use this to discover user IDs before assigning tasks or ideas to specific people.",
    {},
    async (_params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
            isError: true,
          };
        }
        const members = await getMembersByOrganizationId(organizationId);
        return { content: [{ type: "text" as const, text: JSON.stringify(members, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing members: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};
