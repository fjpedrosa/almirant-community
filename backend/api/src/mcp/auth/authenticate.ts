import { validateApiKey, resolveProjectWorkspace } from "@almirant/database";
import { env } from "@almirant/config";
import { verifySessionToken, SESSION_TOKEN_PREFIX, VALID_SESSION_TOKEN_PERMISSIONS } from "../../shared/services/session-token";

/** Default permissions for API keys when allowedIssuedPermissions is empty/null. */
const DEFAULT_API_KEY_PERMISSIONS: string[] = ["mcp:read", "mcp:write"];
const LEGACY_MCP_OAUTH_PREFIX = "/api/mcp/oauth";
const MCP_OAUTH_CONTROL_PLANE_PREFIX = "/api/oauth/mcp";

export interface McpAuthenticatorConfig {
  /** Allow API key bearer tokens on this mount. Set false for internal endpoints. */
  allowApiKeys: boolean;
  /**
   * If set, the session token must include this permission in its payload.
   * Use "mcp:internal" for the internal mount. null = no extra permission required.
   */
  requiredPermission: string | null;
}

const getForwardedHeaderValue = (headers: Headers, name: string): string | null => {
  const value = headers.get(name);
  return value?.split(",")[0]?.trim() || null;
};

const getPublicOriginFromRequest = (request: Request): string => {
  const url = new URL(request.url);
  const forwardedHost = getForwardedHeaderValue(request.headers, "x-forwarded-host");
  const forwardedProto = getForwardedHeaderValue(request.headers, "x-forwarded-proto");

  if (forwardedHost) {
    return `${forwardedProto ?? url.protocol.replace(":", "")}://${forwardedHost}`;
  }

  return url.origin;
};

const unauthorizedJson = (message: string, request: Request): Response =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: `Unauthorized: ${message}` },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${new URL(
          "/.well-known/oauth-protected-resource",
          getPublicOriginFromRequest(request),
        ).toString()}"`,
      },
    }
  );

const redirectLegacyMcpOAuthControlPlane = (request: Request): Response | null => {
  const url = new URL(request.url);

  if (
    url.pathname !== LEGACY_MCP_OAUTH_PREFIX &&
    !url.pathname.startsWith(`${LEGACY_MCP_OAUTH_PREFIX}/`)
  ) {
    return null;
  }

  /**
   * Compatibility shim for ChatGPT connector metadata cached before OAuth
   * control-plane routes were moved out of `/api/mcp`.
   *
   * `/api/mcp` is the protected MCP resource server prefix. OAuth authorize,
   * token and Dynamic Client Registration endpoints belong to the authorization
   * server control plane and must not require an MCP bearer token.
   */
  url.pathname = url.pathname.replace(
    LEGACY_MCP_OAUTH_PREFIX,
    MCP_OAUTH_CONTROL_PLANE_PREFIX,
  );

  return Response.redirect(url.toString(), request.method === "GET" ? 302 : 307);
};

/**
 * Factory that creates a typed MCP authentication callback for elysia-mcp.
 *
 * Public mount  → allowApiKeys: true,  requiredPermission: null
 * Internal mount → allowApiKeys: false, requiredPermission: "mcp:internal"
 *
 * API keys on the public mount receive permissions from the database row
 * (allowedIssuedPermissions), defaulting to ["mcp:read", "mcp:write"].
 * Unknown permissions are filtered out for defense in depth.
 */
export const createMcpAuthenticator = (config: McpAuthenticatorConfig) =>
  async (context: { request: Request }) => {
    const legacyOAuthRedirect = redirectLegacyMcpOAuthControlPlane(context.request);
    if (legacyOAuthRedirect) {
      return { response: legacyOAuthRedirect };
    }

    const authHeader = context.request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return { response: unauthorizedJson("Missing Bearer token", context.request) };
    }

    const rawKey = authHeader.slice(7);

    // ── Session token path (JWT issued by the runner for agent containers) ──
    if (rawKey.startsWith(SESSION_TOKEN_PREFIX) && env.ENCRYPTION_KEY) {
      const sessionPayload = verifySessionToken(rawKey, env.ENCRYPTION_KEY);
      if (sessionPayload) {
        // Enforce required permission for the mount (e.g. "mcp:internal")
        if (config.requiredPermission !== null) {
          const hasRequired = sessionPayload.permissions.includes(config.requiredPermission);
          if (!hasRequired) {
            return {
              response: unauthorizedJson(
                `Token missing required permission: ${config.requiredPermission}`,
                context.request,
              ),
            };
          }
        }

        return {
          authInfo: {
            token: rawKey,
            clientId: `session:${sessionPayload.sessionType}`,
            scopes: [],
            extra: {
              workspaceId: sessionPayload.workspaceId,
              sessionType: sessionPayload.sessionType,
              permissions: sessionPayload.permissions,
              ...(sessionPayload.projectId ? { projectId: sessionPayload.projectId } : {}),
              ...(sessionPayload.userId ? { userId: sessionPayload.userId } : {}),
              ...(sessionPayload.jobId ? { jobId: sessionPayload.jobId } : {}),
            },
          },
        };
      }
      // Session token invalid/expired — fall through to API key validation
    }

    // ── API key path ─────────────────────────────────────────────────────────
    if (!config.allowApiKeys) {
      // Internal mount never accepts API keys
      return { response: unauthorizedJson("API keys are not accepted on this endpoint", context.request) };
    }

    const apiKey = await validateApiKey(rawKey);
    if (!apiKey) {
      return { response: unauthorizedJson("Invalid API key", context.request) };
    }

    // Extract projectId and jobId from URL query parameters for scoped MCP sessions.
    // jobId is injected by the runner so that MCP tools like complete_ai_task
    // can persist agent_job_id on ai_sessions without trusting tool-level params.
    const url = new URL(context.request.url);
    const projectId = url.searchParams.get("projectId");
    const jobId = url.searchParams.get("jobId");

    // Resolve workspaceId: prefer the project's org when projectId is provided.
    // This lets a single API key operate across workspaces the user belongs to.
    let workspaceId = apiKey.workspaceId;
    if (projectId && apiKey.userId) {
      const projectOrgId = await resolveProjectWorkspace(projectId, apiKey.userId);
      if (projectOrgId) workspaceId = projectOrgId;
    }

    // Resolve permissions from API key row, with safe fallback
    const rawPermissions = apiKey.allowedIssuedPermissions?.length
      ? apiKey.allowedIssuedPermissions
      : DEFAULT_API_KEY_PERMISSIONS;

    // Defense in depth: filter out any unrecognized permission strings
    const permissions = rawPermissions.filter((p) =>
      (VALID_SESSION_TOKEN_PERMISSIONS as readonly string[]).includes(p)
    );

    // Enforce required permission for the mount (same pattern as session token path)
    if (config.requiredPermission !== null) {
      const hasRequired = permissions.includes(config.requiredPermission);
      if (!hasRequired) {
        return {
          response: unauthorizedJson(
            `API key missing required permission: ${config.requiredPermission}`,
            context.request,
          ),
        };
      }
    }

    return {
      authInfo: {
        token: rawKey,
        clientId: apiKey.name,
        scopes: [],
        extra: {
          apiKeyId: apiKey.id,
          apiKeyName: apiKey.name,
          workspaceId,
          permissions,
          ...(projectId ? { projectId } : {}),
          ...(jobId ? { jobId } : {}),
          ...(apiKey.userId ? { userId: apiKey.userId } : {}),
        },
      },
    };
  };
