import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDocuments, getDocumentCategories } from "@almirant/database";
import { assertOrgScope } from "../setup";

export const registerDocumentsTools = (server: McpServer) => {
  // -------------------------------------------------------
  // list_documents - List documents with pagination and filters
  // -------------------------------------------------------
  server.tool(
    "list_documents",
    "List documents with optional pagination and filters (search, category)",
    {
      page: z.number().int().min(1).optional().describe("Page number (default: 1)"),
      limit: z.number().int().min(1).max(100).optional().describe("Items per page (default: 50, max: 100)"),
      search: z.string().optional().describe("Search by document title"),
      categoryId: z.string().uuid().optional().describe("Filter by document category ID"),
      projectId: z.string().uuid().optional().describe("Filter by project ID"),
    },
    async (params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const page = params.page ?? 1;
        const limit = params.limit ?? 50;
        const offset = (page - 1) * limit;

        const filters = {
          search: params.search,
          categoryId: params.categoryId,
          projectId: params.projectId,
        };

        const { items, total } = await getDocuments(organizationId, { page, limit, offset }, filters);

        const result = {
          documents: items,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing documents: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // list_document_categories - List all document categories
  // -------------------------------------------------------
  server.tool(
    "list_document_categories",
    "List all document categories with document counts",
    {},
    async (_params, extra) => {
      try {
        const orgResult = assertOrgScope(extra);
        if (typeof orgResult !== "string") return orgResult;
        const organizationId = orgResult;

        const categories = await getDocumentCategories(organizationId);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(categories, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error listing document categories: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};
