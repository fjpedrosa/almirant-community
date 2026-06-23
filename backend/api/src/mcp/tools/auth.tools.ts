import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getUserById } from "@almirant/database";
import { getUserIdFromExtra, getOrganizationIdFromExtra } from "../setup";

export const registerAuthTools = (server: McpServer) => {
  // -------------------------------------------------------
  // get_current_user - Resolve the authenticated user profile
  // -------------------------------------------------------
  server.tool(
    "get_current_user",
    "Get the profile of the authenticated user associated with the current API token. Returns id, name, email, and organizationId. Use this to resolve the userId needed for operations like assigning ownership of items.",
    {},
    async (_params, extra) => {
      try {
        const userId = getUserIdFromExtra(extra);
        const organizationId = getOrganizationIdFromExtra(extra);

        if (!userId) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error:
                    "No userId associated with this API key. The key may have been created without a user account.",
                }),
              },
            ],
            isError: true,
          };
        }

        const user = await getUserById(userId);

        if (!user) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "User not found" }),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                id: user.id,
                name: user.name,
                email: user.email,
                organizationId,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching current user: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
};
