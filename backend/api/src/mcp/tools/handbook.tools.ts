import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createHandbookCaptureProposal,
  getHandbookEntryById,
  listHandbookEntries,
  searchHandbookChunks,
  searchHandbookChunksByEmbedding,
} from "@almirant/database";
import { assertOrgScope, getProjectIdFromExtra, getUserIdFromExtra, getJobIdFromExtra } from "../setup";
import { generateHandbookEmbeddingsIfConfigured } from "../../domains/handbook/services/handbook-embeddings";

const statusSchema = z.enum(["draft", "verified", "deprecated"]);

export const registerHandbookTools = (server: McpServer) => {
  server.tool(
    "handbook_search",
    "Search curated Builder Handbook implementation patterns. Use before planning or implementing features to find existing organizational approaches, tradeoffs, and examples.",
    {
      query: z.string().min(1).describe("Natural language query, e.g. 'authentication with roles' or 'cron jobs worker'."),
      category: z.string().optional().describe("Optional handbook category filter, e.g. frontend, backend, database."),
      status: statusSchema.optional().default("verified").describe("Filter by curation status. Defaults to verified."),
      limit: z.number().int().min(1).max(30).optional().default(8),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const searchOptions = {
          category: params.category,
          status: params.status,
          limit: params.limit,
        };
        const queryEmbedding = await generateHandbookEmbeddingsIfConfigured([params.query]);
        const chunks = queryEmbedding?.[0]
          ? await searchHandbookChunksByEmbedding(workspaceId, queryEmbedding[0], searchOptions)
          : await searchHandbookChunks(workspaceId, params.query, searchOptions);

        const fallback = chunks.length === 0
          ? await listHandbookEntries(
              workspaceId,
              { page: 1, limit: params.limit, offset: 0 },
              { search: params.query, category: params.category, status: params.status },
            )
          : null;

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              query: params.query,
              matches: chunks,
              fallbackEntries: fallback?.items ?? [],
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error searching handbook: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "handbook_get",
    "Load a complete curated Handbook entry by ID after handbook_search finds a relevant pattern.",
    {
      id: z.string().uuid().describe("Handbook entry ID returned by handbook_search."),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const entry = await getHandbookEntryById(orgResult, params.id);
        if (!entry) {
          return { content: [{ type: "text" as const, text: "Handbook entry not found" }], isError: true };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(entry, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error loading handbook entry: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "handbook_capture_proposal",
    "Create a curated Handbook capture proposal. Use only when the user explicitly asks to save an implementation approach or pattern; do not publish directly.",
    {
      title: z.string().min(1),
      proposedContent: z.string().min(1).describe("Draft handbook content explaining the reusable pattern, when to use it, tradeoffs, and examples."),
      slug: z.string().optional(),
      summary: z.string().optional(),
      category: z.string().optional().default("general"),
      rationale: z.string().optional().describe("Why this is worth saving as curated organizational knowledge."),
      sourceProjectId: z.string().uuid().optional(),
      sourceFiles: z.array(z.string()).optional().default([]),
      targetEntryId: z.string().uuid().optional().describe("Existing entry to supersede/extend, if known."),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const workspaceId = orgResult;

        const proposal = await createHandbookCaptureProposal(workspaceId, {
          title: params.title,
          slug: params.slug ?? (params.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "handbook-entry"),
          summary: params.summary ?? null,
          proposedContent: params.proposedContent,
          category: params.category,
          rationale: params.rationale ?? null,
          sourceProjectId: params.sourceProjectId ?? getProjectIdFromExtra(extra) ?? null,
          sourceFiles: params.sourceFiles,
          targetEntryId: params.targetEntryId ?? null,
          createdByUserId: getUserIdFromExtra(extra) ?? null,
          createdByAgentJobId: getJobIdFromExtra(extra) ?? null,
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(proposal, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error creating handbook proposal: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
};
