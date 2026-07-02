import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "crypto";
import {
  createMemoryTelemetry,
  createObservation,
  getRecentObservations,
  searchObservations,
} from "@almirant/database";
import {
  getWorkspaceIdFromExtra,
  getProjectIdFromExtra,
} from "../setup";
import {
  getConfidenceBand,
  parseConfidence,
  rankObservationResults,
  validateTopicKeyForType,
} from "../../lib/memory/ranker";
import {
  assertSafeMemoryPayload,
  assertSafeMemoryText,
} from "../../lib/memory/scrubber";

const OBSERVATION_TYPES = [
  "decision",
  "architecture",
  "bugfix",
  "pattern",
  "config",
  "discovery",
  "learning",
  "error_diagnosis",
  "work_item",
  "todo_item",
  "seed",
] as const;

const observationTypeSchema = z.enum(OBSERVATION_TYPES);

const visibilitySchema = z.enum(["personal", "project", "org"]);
const createdByKindSchema = z.enum(["agent", "human", "system"]);

const serializeSearchResults = (
  query: string,
  results: Awaited<ReturnType<typeof searchObservations>>
) => {
  const ranked = rankObservationResults(results, query);
  return ranked.map((item, index) => ({
    rank: index + 1,
    score: item.score,
    confidence: item.confidence,
    confidenceBand: item.confidenceBand,
    charLength: item.charLength,
    observation: item.observation,
  }));
};

export const registerMemoryTools = (server: McpServer) => {
  server.tool(
    "mem_save",
    "Save an observation to agent memory. Automatically deduplicates by scoped content hash and rejects secrets/PII before persisting.",
    {
      type: observationTypeSchema.describe(
        "Type of observation: decision, architecture, bugfix, pattern, config, discovery, learning"
      ),
      topicKey: z
        .string()
        .describe("Topic key slug with type prefix, e.g. 'decision/auth-model'"),
      title: z.string().describe("Short title for the observation"),
      content: z.string().describe("Detailed content of the observation"),
      scope: z
        .string()
        .optional()
        .describe("Scope like 'domain:frontend' or 'file:src/lib/auth.ts'"),
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe("Project ID (defaults to connection's projectId)"),
      agentJobId: z
        .string()
        .uuid()
        .optional()
        .describe("Agent job UUID for traceability"),
      workItemId: z
        .string()
        .uuid()
        .optional()
        .describe("Linked work item UUID"),
      feedbackItemId: z
        .string()
        .uuid()
        .optional()
        .describe("Linked feedback item UUID"),
      ownerUserId: z
        .string()
        .optional()
        .describe("Owner user id for personal memory visibility"),
      visibility: visibilitySchema
        .optional()
        .describe("Memory visibility: personal, project, or org"),
      createdByKind: createdByKindSchema
        .optional()
        .describe("Origin kind: agent, human, system"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Confidence score between 0 and 1"),
      supersedesObservationId: z
        .string()
        .uuid()
        .optional()
        .describe("Older observation id that this one supersedes"),
      expiresAt: z
        .string()
        .datetime()
        .optional()
        .describe("Optional expiry ISO timestamp"),
      metadata: z
        .record(z.string(), z.any())
        .optional()
        .describe("Additional metadata as JSON"),
    },
    async (params, extra) => {
      const startedAt = Date.now();
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
        const normalizedTopicKey = validateTopicKeyForType(
          params.type,
          params.topicKey
        );
        const title = assertSafeMemoryText(params.title, "title");
        const content = assertSafeMemoryText(params.content, "content");
        const metadata = assertSafeMemoryPayload(params.metadata);

        const observation = await createObservation({
          workspaceId,
          projectId:
            params.visibility === "org" ? null : (projectId ?? null),
          agentJobId: params.agentJobId ?? null,
          workItemId: params.workItemId ?? null,
          feedbackItemId: params.feedbackItemId ?? null,
          ownerUserId:
            params.visibility === "personal" ? (params.ownerUserId ?? null) : null,
          visibility: params.visibility ?? "project",
          createdByKind: params.createdByKind ?? "agent",
          type: params.type,
          topicKey: normalizedTopicKey,
          title,
          content,
          scope: params.scope,
          confidence: parseConfidence(params.confidence ?? 0.5).toFixed(2),
          supersedesObservationId: params.supersedesObservationId ?? null,
          expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
          contentHash: createHash("sha256").update(title + content).digest("hex"),
          metadata,
        });

        await createMemoryTelemetry({
          workspaceId,
          agentJobId: params.agentJobId ?? null,
          event: "save",
          resultCount: 1,
          durationMs: Date.now() - startedAt,
          hits: [
            {
              observationId: observation.id,
              rank: 1,
              score: 1,
              injected: false,
            },
          ],
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  observation,
                  confidenceBand: getConfidenceBand(
                    observation.confidence,
                    observation.verifiedByUserId
                  ),
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
              text: `Error saving observation: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "mem_search",
    "Search agent memory observations using full-text search with confidence bands and telemetry.",
    {
      query: z.string().describe("Search query in natural language"),
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe("Filter by project ID"),
      agentJobId: z
        .string()
        .uuid()
        .optional()
        .describe("Agent job UUID for telemetry"),
      workItemId: z
        .string()
        .uuid()
        .optional()
        .describe("Filter by linked work item"),
      type: observationTypeSchema
        .optional()
        .describe("Filter by observation type"),
      scope: z
        .string()
        .optional()
        .describe("Filter by scope, e.g. 'domain:frontend'"),
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum confidence threshold"),
      includeQuarantined: z
        .boolean()
        .optional()
        .describe("When true, include observations below 0.4 confidence"),
      minScore: z
        .number()
        .min(0)
        .optional()
        .describe("Minimum ts_rank score after FTS matching"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Maximum number of results (1-100, default 20)"),
    },
    async (params, extra) => {
      const startedAt = Date.now();
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

        const safeQuery = assertSafeMemoryText(params.query, "query");
        const projectId = params.projectId ?? getProjectIdFromExtra(extra);

        const results = await searchObservations(workspaceId, safeQuery, {
          projectId,
          agentJobId: params.agentJobId,
          workItemId: params.workItemId,
          type: params.type,
          scope: params.scope,
          minConfidence: params.minConfidence,
          includeQuarantined: params.includeQuarantined,
          minScore: params.minScore,
          limit: params.limit,
        });

        const serialized = serializeSearchResults(safeQuery, results);

        await createMemoryTelemetry({
          workspaceId,
          agentJobId: params.agentJobId ?? null,
          event: "search",
          query: safeQuery,
          resultCount: serialized.length,
          durationMs: Date.now() - startedAt,
          hits: serialized.map((item) => ({
            observationId: item.observation.id,
            rank: item.rank,
            score: item.score,
            injected: false,
          })),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  count: serialized.length,
                  totalScoreThresholdApplied: params.minScore ?? 0,
                  results: serialized,
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
              text: `Error searching observations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "mem_context",
    "Load recent agent memory observations grouped by type. Useful for building context at the start of a task.",
    {
      projectId: z
        .string()
        .uuid()
        .optional()
        .describe("Filter by project ID"),
      agentJobId: z
        .string()
        .uuid()
        .optional()
        .describe("Agent job UUID for telemetry"),
      workItemId: z
        .string()
        .uuid()
        .optional()
        .describe("Filter by linked work item"),
      types: z
        .array(observationTypeSchema)
        .optional()
        .describe("Filter by observation types"),
      minConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum confidence threshold"),
      includeQuarantined: z
        .boolean()
        .optional()
        .describe("When true, include observations below 0.4 confidence"),
      recencyDays: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Only include observations from the last N days"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .default(10)
        .describe("Maximum number of results (1-200, default 10)"),
    },
    async (params, extra) => {
      const startedAt = Date.now();
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

        const results = await getRecentObservations(workspaceId, {
          projectId,
          agentJobId: params.agentJobId,
          workItemId: params.workItemId,
          types: params.types,
          minConfidence: params.minConfidence,
          includeQuarantined: params.includeQuarantined,
          recencyDays: params.recencyDays,
          limit: params.limit,
        });

        const grouped = results.reduce(
          (acc, obs) => {
            const confidence = parseConfidence(obs.confidence);
            const confidenceBand = getConfidenceBand(
              obs.confidence,
              obs.verifiedByUserId
            );
            if (!acc[obs.type]) acc[obs.type] = [];
            acc[obs.type]!.push({
              observation: obs,
              confidence,
              confidenceBand,
              charLength: obs.title.length + obs.content.length,
            });
            return acc;
          },
          {} as Record<
            string,
            Array<{
              observation: (typeof results)[number];
              confidence: number;
              confidenceBand: ReturnType<typeof getConfidenceBand>;
              charLength: number;
            }>
          >
        );

        await createMemoryTelemetry({
          workspaceId,
          agentJobId: params.agentJobId ?? null,
          event: "context",
          resultCount: results.length,
          durationMs: Date.now() - startedAt,
          hits: results.map((item, index) => ({
            observationId: item.id,
            rank: index + 1,
            score: 1,
            injected: false,
          })),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  totalCount: results.length,
                  byType: Object.fromEntries(
                    Object.entries(grouped).map(([type, items]) => [
                      type,
                      { count: items.length, items },
                    ])
                  ),
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
              text: `Error loading context observations: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
};
