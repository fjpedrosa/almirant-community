import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getDependencies,
  getDependents,
  addDependency,
  removeDependency,
  getWorkItemById,
  isDependencyEndpointNotFoundError,
  isNativePlanAuthorityError,
} from "@almirant/database";
import { assertOrgScope } from "../setup";

const endpointNotFound = (error: unknown) => {
  if (!isDependencyEndpointNotFoundError(error)) return null;
  const endpoint = error.endpoint === "source" ? "Work item" : "Blocking work item"; return { content: [{ type: "text" as const, text: `Error: ${endpoint} not found or does not belong to your workspace` }], isError: true };
};
const authorityConflict = (error: unknown) => isNativePlanAuthorityError(error) ? {
  content: [{ type: "text" as const, text: "Error: Planning fields are owned by the native Plan revision" }],
  isError: true,
} : null;

export const registerDependenciesTools = (server: McpServer) => {
  // -------------------------------------------------------
  // get_work_item_dependencies - Get dependencies and dependents
  // -------------------------------------------------------
  server.tool(
    "get_work_item_dependencies",
    "Get all dependencies and dependents of a work item. Dependencies = what blocks this item. Dependents = what this item blocks.",
    {
      id: z.string().uuid().describe("Work item ID"),
    },
    async (params, extra) => {
      const workspaceId = assertOrgScope(extra);
      if (typeof workspaceId !== "string") return workspaceId;
      try {

        const workItem = await getWorkItemById(params.id, workspaceId);
        if (!workItem) {
          return { content: [{ type: "text" as const, text: `Error: Work item with ID '${params.id}' not found or does not belong to your workspace` }], isError: true };
        }

        const [dependencies, dependents] = await Promise.all([
          getDependencies(params.id),
          getDependents(params.id),
        ]);

        const result = { dependencies, dependents };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error getting dependencies: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // add_work_item_dependency - Add a dependency to a work item
  // -------------------------------------------------------
  server.tool(
    "add_work_item_dependency",
    "Add a dependency to a work item (mark it as blocked by another item)",
    {
      workItemId: z.string().uuid().describe("The work item that is blocked"),
      blockedByWorkItemId: z.string().uuid().describe("The work item that blocks it"),
    },
    async (params, extra) => {
      const workspaceId = assertOrgScope(extra);
      if (typeof workspaceId !== "string") return workspaceId;
      try {

        if (params.workItemId === params.blockedByWorkItemId) {
          return {
            content: [{ type: "text" as const, text: "Error: A work item cannot depend on itself" }],
            isError: true,
          };
        }

        const dependency = await addDependency(params.workItemId, params.blockedByWorkItemId, { workspaceId });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(dependency, null, 2) }],
        };
      } catch (error) {
        const notFound = endpointNotFound(error); if (notFound) return notFound;
        const conflict = authorityConflict(error);
        if (conflict) return conflict;
        return {
          content: [{ type: "text" as const, text: `Error adding dependency: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // remove_work_item_dependency - Remove a dependency from a work item
  // -------------------------------------------------------
  server.tool(
    "remove_work_item_dependency",
    "Remove a dependency from a work item",
    {
      workItemId: z.string().uuid().describe("The work item ID"),
      blockedByWorkItemId: z.string().uuid().describe("The blocking work item ID to remove"),
    },
    async (params, extra) => {
      const workspaceId = assertOrgScope(extra);
      if (typeof workspaceId !== "string") return workspaceId;
      try {

        const removed = await removeDependency(params.workItemId, params.blockedByWorkItemId, { workspaceId });

        if (!removed) {
          return {
            content: [{ type: "text" as const, text: `Error: Dependency not found between work item '${params.workItemId}' and blocking item '${params.blockedByWorkItemId}'` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ removed: true }, null, 2) }],
        };
      } catch (error) {
        const notFound = endpointNotFound(error); if (notFound) return notFound;
        const conflict = authorityConflict(error);
        if (conflict) return conflict;
        return {
          content: [{ type: "text" as const, text: `Error removing dependency: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
};
