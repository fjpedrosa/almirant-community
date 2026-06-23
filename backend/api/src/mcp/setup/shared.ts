/**
 * Shared helper functions for extracting data from MCP authInfo extra data.
 *
 * Tools import these via the setup.ts shim: `import { ... } from "../setup"`.
 * Direct imports from this file are also valid.
 */

/**
 * Standard MCP tool result shape returned by tool handlers.
 */
export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Extracts `organizationId` from MCP authInfo extra, returning it as a string
 * if present. When absent, returns an MCP error result that the handler can
 * return directly — no exceptions are thrown.
 *
 * Usage:
 * ```ts
 * const orgResult = assertOrgScope(extra);
 * if (typeof orgResult !== "string") return orgResult;
 * const organizationId = orgResult;
 * ```
 */
export const assertOrgScope = (
  extra: { authInfo?: { extra?: Record<string, unknown> } }
): string | McpToolResult => {
  const orgId = getOrganizationIdFromExtra(extra);
  if (!orgId) {
    return {
      content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
      isError: true,
    };
  }
  return orgId;
};

export const getProjectIdFromExtra = (
  extra: { authInfo?: { extra?: Record<string, unknown> } }
): string | undefined => {
  const projectId = extra.authInfo?.extra?.projectId;
  return typeof projectId === "string" ? projectId : undefined;
};

export const getUserIdFromExtra = (
  extra: { authInfo?: { extra?: Record<string, unknown> } }
): string | undefined => {
  const userId = extra.authInfo?.extra?.userId;
  return typeof userId === "string" ? userId : undefined;
};

export const getOrganizationIdFromExtra = (
  extra: { authInfo?: { extra?: Record<string, unknown> } }
): string | undefined => {
  const organizationId = extra.authInfo?.extra?.organizationId;
  return typeof organizationId === "string" ? organizationId : undefined;
};

/**
 * Extracts the permissions array from MCP authInfo extra data.
 * Returns an empty array if not present or not an array of strings.
 */
export const getPermissionsFromExtra = (
  extra: { authInfo?: { extra?: Record<string, unknown> } }
): string[] => {
  const perms = extra.authInfo?.extra?.permissions;
  return Array.isArray(perms) ? perms.filter((p): p is string => typeof p === "string") : [];
};

export const getPlanningSessionIdFromExtra = (
  extra: { authInfo?: { extra?: Record<string, unknown> } }
): string | undefined => {
  const planningSessionId = extra.authInfo?.extra?.planningSessionId;
  return typeof planningSessionId === "string" ? planningSessionId : undefined;
};

export const getJobIdFromExtra = (
  extra: { authInfo?: { extra?: Record<string, unknown> } }
): string | undefined => {
  const jobId = extra.authInfo?.extra?.jobId;
  return typeof jobId === "string" ? jobId : undefined;
};

export const getPlanningMetadataFromExtra = (
  extra: { authInfo?: { extra?: Record<string, unknown> } }
): {
  planningModel?: string;
  planningProvider?: string;
  fromSeedIds?: string[];
} => {
  const authExtra = extra.authInfo?.extra;
  if (!authExtra) return {};

  const result: {
    planningModel?: string;
    planningProvider?: string;
    fromSeedIds?: string[];
  } = {};

  if (typeof authExtra.planningModel === "string") {
    result.planningModel = authExtra.planningModel;
  }
  if (typeof authExtra.planningProvider === "string") {
    result.planningProvider = authExtra.planningProvider;
  }
  if (Array.isArray(authExtra.fromSeedIds)) {
    const validIds = authExtra.fromSeedIds.filter(
      (id): id is string => typeof id === "string"
    );
    if (validIds.length > 0) {
      result.fromSeedIds = validIds;
    }
  }

  return result;
};

export const getManagedByAgentFromExtra = (
  extra: { authInfo?: { clientId?: string } }
): "claude-code" | "codex" | undefined => {
  const clientId = extra.authInfo?.clientId?.toLowerCase();
  if (!clientId) return undefined;
  if (clientId.includes("codex")) return "codex";
  if (clientId.includes("claude")) return "claude-code";
  return undefined;
};
