import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "crypto";
import { createObservation, searchObservations } from "@almirant/database";
import {
  getWorkspaceIdFromExtra,
  getProjectIdFromExtra,
} from "../setup";
import { assertSafeMemoryText } from "../../lib/memory/scrubber";
import { validateTopicKeyForType } from "../../lib/memory/ranker";

const TODO_ACTIONS = ["created", "completed", "blocked", "unblocked"] as const;

interface TodoMemoryMetadata {
  todoId?: string;
  action: string;
  description: string;
  rationale?: string;
  resolution?: string;
}

export const registerTodoMemoryTools = (server: McpServer) => {
  // -------------------------------------------------------
  // todo_search - Search todo memory observations
  // -------------------------------------------------------
  server.tool(
    "todo_search",
    "Search todo memory observations by description or keywords. Returns results ranked by relevance with flattened metadata for easy consumption.",
    {
      query: z
        .string()
        .describe("Search query describing what you're looking for"),
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe("Filter by project ID"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Maximum number of results (1-20, default 5)"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: could not resolve workspaceId from API key",
              },
            ],
            isError: true,
          };
        }

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);

        const results = await searchObservations(
          workspaceId,
          assertSafeMemoryText(params.query, "query"),
          {
            projectId,
            type: "todo_item",
            limit: params.limit,
          }
        );

        const flattenedResults = results.map((r) => {
          const meta = (r.metadata ?? {}) as unknown as TodoMemoryMetadata;
          return {
            id: r.id,
            title: r.title,
            topicKey: r.topicKey,
            rank: r.rank,
            todoId: meta.todoId,
            action: meta.action,
            description: meta.description,
            rationale: meta.rationale,
            resolution: meta.resolution,
            updatedAt: r.updatedAt,
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { count: flattenedResults.length, results: flattenedResults },
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
              text: `Error searching todo memory: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // todo_save - Save a todo memory observation
  // -------------------------------------------------------
  server.tool(
    "todo_save",
    "Save a todo memory observation to the database. Automatically deduplicates by content hash — saving the same title+content again updates the existing record.",
    {
      topicKey: z
        .string()
        .describe("Slug identifier, e.g. 'setup-ci-pipeline'"),
      title: z.string().describe("Descriptive title"),
      todoId: z
        .string()
        .uuid()
        .optional()
        .describe("Todo item UUID"),
      action: z
        .enum(TODO_ACTIONS)
        .describe("Action performed: created, completed, blocked, unblocked"),
      description: z
        .string()
        .describe("What was done or decided"),
      rationale: z
        .string()
        .optional()
        .describe("Why this was done"),
      resolution: z
        .string()
        .optional()
        .describe("How it was resolved (for completed/unblocked)"),
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe("Project ID (defaults to connection's projectId)"),
    },
    async (params, extra) => {
      try {
        const workspaceId = getWorkspaceIdFromExtra(extra);
        if (!workspaceId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: could not resolve workspaceId from API key",
              },
            ],
            isError: true,
          };
        }

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);

        const metadata: TodoMemoryMetadata = {
          todoId: params.todoId,
          action: params.action,
          description: params.description,
          rationale: params.rationale,
          resolution: params.resolution,
        };

        const content = [
          params.description,
          params.rationale,
          params.resolution,
        ]
          .filter(Boolean)
          .join(" | ");
        const normalizedTopicKey = validateTopicKeyForType(
          "todo_item",
          params.topicKey
        );

        const contentHash = createHash("sha256")
          .update(params.title + content)
          .digest("hex");

        const observation = await createObservation({
          workspaceId,
          projectId,
          type: "todo_item",
          topicKey: normalizedTopicKey,
          title: params.title,
          content,
          contentHash,
          metadata: metadata as unknown as Record<string, unknown>,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(observation, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error saving todo memory: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
};
