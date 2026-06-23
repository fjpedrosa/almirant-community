import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "crypto";
import { createObservation, searchObservations } from "@almirant/database";
import {
  getOrganizationIdFromExtra,
  getProjectIdFromExtra,
} from "../setup";
import { assertSafeMemoryText } from "../../lib/memory/scrubber";
import { validateTopicKeyForType } from "../../lib/memory/ranker";

const SEED_ACTIONS = [
  "created",
  "reviewed",
  "approved",
  "rejected",
  "promoted",
  "archived",
] as const;

const SEED_SOURCES = [
  "manual",
  "feedback",
  "ai_generated",
  "import",
] as const;

interface SeedMemoryMetadata {
  seedId?: string;
  action: string;
  description: string;
  rationale?: string;
  promotedToWorkItemId?: string;
  source?: string;
}

export const registerSeedMemoryTools = (server: McpServer) => {
  // -------------------------------------------------------
  // seed_search - Search seed memory observations
  // -------------------------------------------------------
  server.tool(
    "seed_search",
    "Search seed memory observations by description or keywords. Returns results ranked by relevance with flattened metadata for easy consumption.",
    {
      query: z
        .string()
        .describe("Search query describing what you're looking for"),
      source: z
        .enum(SEED_SOURCES)
        .optional()
        .describe("Filter by seed source"),
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

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);

        const results = await searchObservations(
          organizationId,
          assertSafeMemoryText(params.query, "query"),
          {
            projectId,
            type: "seed",
            scope: params.source ? `source:${params.source}` : undefined,
            limit: params.limit,
          }
        );

        const flattenedResults = results.map((r) => {
          const meta = (r.metadata ?? {}) as unknown as SeedMemoryMetadata;
          return {
            id: r.id,
            title: r.title,
            topicKey: r.topicKey,
            rank: r.rank,
            seedId: meta.seedId,
            action: meta.action,
            description: meta.description,
            rationale: meta.rationale,
            promotedToWorkItemId: meta.promotedToWorkItemId,
            source: meta.source,
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
              text: `Error searching seed memory: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // seed_save - Save a seed memory observation
  // -------------------------------------------------------
  server.tool(
    "seed_save",
    "Save a seed memory observation to the database. Automatically deduplicates by content hash — saving the same title+content again updates the existing record.",
    {
      topicKey: z
        .string()
        .describe(
          "Slug identifier, e.g. 'automated-sprint-reports'"
        ),
      title: z.string().describe("Descriptive title"),
      seedId: z
        .string()
        .uuid()
        .optional()
        .describe("Seed item UUID"),
      action: z
        .enum(SEED_ACTIONS)
        .describe("Action performed"),
      description: z
        .string()
        .describe("What was decided or observed"),
      rationale: z
        .string()
        .optional()
        .describe("Why this decision was made"),
      promotedToWorkItemId: z
        .string()
        .uuid()
        .optional()
        .describe("Work item ID if seed was promoted"),
      source: z
        .enum(SEED_SOURCES)
        .optional()
        .describe("Origin of the seed"),
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe("Project ID (defaults to connection's projectId)"),
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

        const projectId = params.projectId ?? getProjectIdFromExtra(extra);

        const metadata: SeedMemoryMetadata = {
          seedId: params.seedId,
          action: params.action,
          description: params.description,
          rationale: params.rationale,
          promotedToWorkItemId: params.promotedToWorkItemId,
          source: params.source,
        };

        const content = [params.description, params.rationale]
          .filter(Boolean)
          .join(" | ");
        const normalizedTopicKey = validateTopicKeyForType(
          "seed",
          params.topicKey
        );

        const contentHash = createHash("sha256")
          .update(params.title + content)
          .digest("hex");

        const scope = params.source
          ? `source:${params.source}`
          : undefined;

        const observation = await createObservation({
          organizationId,
          projectId,
          type: "seed",
          topicKey: normalizedTopicKey,
          title: params.title,
          content,
          scope,
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
              text: `Error saving seed memory: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
};
