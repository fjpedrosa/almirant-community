import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "crypto";
import { createObservation, searchObservations } from "@almirant/database";
import {
  assertOrgScope,
  getProjectIdFromExtra,
} from "../setup";
import { assertSafeMemoryText } from "../../lib/memory/scrubber";
import { validateTopicKeyForType } from "../../lib/memory/ranker";

const WORK_ITEM_TYPES = [
  "epic",
  "feature",
  "story",
  "task",
] as const;

const WORK_ITEM_ACTIONS = [
  "created",
  "implemented",
  "validated",
  "fixed",
  "refined",
  "archived",
  "deleted",
] as const;

const workItemTypeSchema = z.enum(WORK_ITEM_TYPES);
const workItemActionSchema = z.enum(WORK_ITEM_ACTIONS);

interface WorkItemMemoryMetadata {
  workItemId?: string;
  taskId?: string;
  workItemType: string;
  action: string;
  description: string;
  rationale?: string;
  affectedFiles?: string[];
  decisions?: string[];
  alternatives?: string[];
  dependencies?: string[];
  learnings?: string[];
}

export const registerWorkItemMemoryTools = (server: McpServer) => {
  // -------------------------------------------------------
  // workitem_search - Search work item memory observations
  // -------------------------------------------------------
  server.tool(
    "workitem_search",
    "Search work item memory observations by description or technical keywords. Returns results ranked by relevance with flattened metadata for easy consumption.",
    {
      query: z
        .string()
        .describe("Search query describing what you're looking for"),
      workItemType: workItemTypeSchema
        .optional()
        .describe("Filter by work item type: epic, feature, story, task"),
      action: workItemActionSchema
        .optional()
        .describe(
          "Filter by action performed: created, implemented, validated, fixed, refined, archived, deleted"
        ),
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
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const results = await searchObservations(
          workspaceId,
          assertSafeMemoryText(params.query, "query"),
          {
            projectId: params.projectId,
            type: "work_item",
            scope: params.workItemType
              ? `workItemType:${params.workItemType}`
              : undefined,
            limit: params.limit,
          }
        );

        // Post-filter by action if provided
        const filtered = params.action
          ? results.filter(
              (r) =>
                (r.metadata as WorkItemMemoryMetadata | null)?.action ===
                params.action
            )
          : results;

        const flattenedResults = filtered.map((r) => {
          const meta = (r.metadata ?? {}) as unknown as WorkItemMemoryMetadata;
          return {
            id: r.id,
            title: r.title,
            topicKey: r.topicKey,
            rank: r.rank,
            workItemId: meta.workItemId,
            taskId: meta.taskId,
            workItemType: meta.workItemType,
            action: meta.action,
            description: meta.description,
            rationale: meta.rationale,
            affectedFiles: meta.affectedFiles,
            decisions: meta.decisions,
            alternatives: meta.alternatives,
            dependencies: meta.dependencies,
            learnings: meta.learnings,
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
              text: `Error searching work item memory: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // workitem_save - Save a work item memory observation
  // -------------------------------------------------------
  server.tool(
    "workitem_save",
    "Save a work item memory observation to the database. Automatically deduplicates by content hash — saving the same title+content again updates the existing record.",
    {
      topicKey: z
        .string()
        .describe(
          "Slug identifier, e.g. 'export-button-users'"
        ),
      title: z.string().describe("Descriptive title"),
      workItemId: z
        .string()
        .uuid()
        .optional()
        .describe("Work item UUID"),
      taskId: z
        .string()
        .optional()
        .describe("Human-readable task ID like MC-T-42"),
      workItemType: workItemTypeSchema.describe(
        "Type of work item: epic, feature, story, task"
      ),
      action: workItemActionSchema.describe(
        "Action performed: created, implemented, validated, fixed, refined, archived, deleted"
      ),
      description: z
        .string()
        .describe("What was done"),
      rationale: z
        .string()
        .optional()
        .describe("Why this approach was chosen"),
      affectedFiles: z
        .array(z.string())
        .optional()
        .describe("File paths affected"),
      decisions: z
        .array(z.string())
        .optional()
        .describe("Key decisions made"),
      alternatives: z
        .array(z.string())
        .optional()
        .describe("Alternatives considered and discarded"),
      dependencies: z
        .array(z.string())
        .optional()
        .describe("Related work item IDs"),
      learnings: z
        .array(z.string())
        .optional()
        .describe("Lessons learned"),
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe("Project ID (defaults to connection's projectId)"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);

        const metadata: WorkItemMemoryMetadata = {
          workItemId: params.workItemId,
          taskId: params.taskId,
          workItemType: params.workItemType,
          action: params.action,
          description: params.description,
          rationale: params.rationale,
          affectedFiles: params.affectedFiles,
          decisions: params.decisions,
          alternatives: params.alternatives,
          dependencies: params.dependencies,
          learnings: params.learnings,
        };

        // Build content by concatenating all text fields for full-text search
        const contentParts = [
          params.description,
          params.rationale,
          ...(params.decisions ?? []),
          ...(params.alternatives ?? []),
          ...(params.learnings ?? []),
          ...(params.affectedFiles ?? []),
        ].filter(Boolean);

        const content = contentParts.join(" | ");
        const normalizedTopicKey = validateTopicKeyForType(
          "work_item",
          params.topicKey
        );

        const contentHash = createHash("sha256")
          .update(params.title + content)
          .digest("hex");

        const observation = await createObservation({
          workspaceId,
          projectId,
          type: "work_item",
          topicKey: normalizedTopicKey,
          title: params.title,
          content,
          workItemId: params.workItemId,
          scope: `workItemType:${params.workItemType}`,
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
              text: `Error saving work item memory: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
};
