import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  upsertCommit,
  linkCommitToWorkItem,
  getRepoIdsForProject,
  getWorkItemById,
} from "@almirant/database";
import { getOrganizationIdFromExtra, getProjectIdFromExtra } from "../setup";

export const registerCommitTools = (server: McpServer) => {
  // -------------------------------------------------------
  // link_commit_to_work_item - Link a git commit to a work item
  // -------------------------------------------------------
  server.tool(
    "link_commit_to_work_item",
    "Link a git commit to a work item. Upserts the commit in github_commits and creates a link in work_item_commits. Idempotent — safe to call multiple times.",
    {
      workItemId: z.string().uuid().describe("UUID of the work item to link"),
      sha: z.string().min(7).describe("Git commit SHA (short or full)"),
      message: z
        .string()
        .optional()
        .describe("Commit message (used for upsert if commit doesn't exist)"),
      branch: z.string().optional().describe("Branch name"),
      authorName: z.string().optional().describe("Commit author name"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: could not resolve organizationId from API key",
              },
            ],
            isError: true,
          };
        }

        const projectId = getProjectIdFromExtra(extra);
        if (!projectId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: could not resolve projectId — ensure projectId is in the MCP connection URL",
              },
            ],
            isError: true,
          };
        }

        // Verify work item belongs to the organization
        const workItem = await getWorkItemById(params.workItemId, organizationId);
        if (!workItem) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Work item '${params.workItemId}' not found or does not belong to your organization`,
              },
            ],
            isError: true,
          };
        }

        // Resolve repo for the project
        const repoIds = await getRepoIdsForProject(projectId);
        if (repoIds.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: no repository linked to this project",
              },
            ],
            isError: true,
          };
        }
        const repoId = repoIds[0]!;

        // Upsert commit (idempotent — if exists, updates non-key fields)
        const commit = await upsertCommit({
          repoId,
          sha: params.sha,
          message: params.message ?? "",
          authorName: params.authorName ?? null,
          branch: params.branch ?? null,
          committedAt: new Date(),
        });

        if (!commit) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: failed to upsert commit",
              },
            ],
            isError: true,
          };
        }

        // Link commit to work item (idempotent via onConflictDoNothing)
        const link = await linkCommitToWorkItem(
          params.workItemId,
          commit.id,
          false
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  linked: true,
                  commitId: commit.id,
                  workItemId: params.workItemId,
                  sha: params.sha,
                  alreadyLinked: link === null,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error linking commit to work item: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
};
