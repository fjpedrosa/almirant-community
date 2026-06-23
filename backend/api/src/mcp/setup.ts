/**
 * Backward-compat shim — all MCP tools import helpers from `"../setup"`.
 * The actual implementation lives in ./setup/shared.ts.
 * The index.ts imports setup functions directly from ./setup/public and ./setup/internal.
 *
 * Explicit re-exports are used to avoid stale module caches when new helpers
 * are added to shared.ts (observed on 2026-04-18 with bun test caching).
 */
export {
  assertOrgScope,
  getProjectIdFromExtra,
  getUserIdFromExtra,
  getOrganizationIdFromExtra,
  getPermissionsFromExtra,
  getPlanningSessionIdFromExtra,
  getJobIdFromExtra,
  getPlanningMetadataFromExtra,
  getManagedByAgentFromExtra,
} from "./setup/shared";
export type { McpToolResult } from "./setup/shared";
