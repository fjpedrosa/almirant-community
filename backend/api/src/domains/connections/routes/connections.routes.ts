import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  createConnection,
  getConnectionById,
  listConnections,
  updateConnection,
  deactivateConnection,
  setConnectionAsDefault,
  validateScopeForCategory,
  updateConnectionLastUsedAt,
  updateConnectionValidation,
  createOAuthState,
  getOAuthStateByState,
  deleteOAuthState,
  cleanExpiredOAuthStates,
  mapAiProviderToConnectionProvider,
} from "@almirant/database";
import { env, logger } from "@almirant/config";
import {
  getOAuthProvider,
  generateAuthUrl,
  exchangeCode,
  refreshToken as refreshOAuthToken,
  getSupportedOAuthProviders,
  ANTHROPIC_STEALTH_HEADERS,
  isAnthropicOAuthAuthMethod,
  isAnthropicSetupToken,
} from "../services/oauth";
import { buildOAuthCredentialsFromTokenResponse } from "../services/oauth/oauth-credential-helpers";
import {
  createOAuthStateToken,
  verifyOAuthStateToken,
} from "../services/oauth/state-token";
import { parseManualOAuthCode } from "../services/oauth/manual-code";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../shared/services/response";
import {
  createLinkToken,
  getLinkToken,
  deleteLinkToken,
} from "../services/link-token-store";
import { connectionUsageService } from "../services/connection-usage-service";

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

/** Map a provider name to its default connection category. */
const defaultCategoryForProvider = (
  provider: string,
): "ai" | "code" | "deployment" | "monitoring" => {
  switch (provider) {
    case "github":
      return "code";
    case "vercel":
      return "deployment";
    case "sentry":
    case "posthog":
      return "monitoring";
    default:
      return "ai";
  }
};

/** Build a short non-sensitive preview of a token, e.g. "sk-ant-..." */
const buildTokenPrefix = (token: string): string => {
  return `${token.slice(0, 7)}...`;
};

const replaceAuthUrlState = (url: string, state: string): string => {
  const parsed = new URL(url);
  parsed.searchParams.set("state", state);
  return parsed.toString();
};

// ---------------------------------------------------------------------------
// Provider test helpers
// ---------------------------------------------------------------------------

/**
 * Test a provider connection by making a lightweight API call to verify
 * the credentials are valid. Returns true if the call succeeds.
 */
const testProviderConnection = async (
  provider: string,
  credentials: Record<string, unknown>,
): Promise<{ valid: boolean; error?: string }> => {
  try {
    switch (provider) {
      case "anthropic": {
        const apiKey = credentials.apiKey as string;
        const authMethod = credentials.authMethod as string | undefined;
        const resolvedAuthMethod =
          authMethod ?? (isAnthropicSetupToken(apiKey) ? "setup_token" : undefined);
        const isOAuth = isAnthropicOAuthAuthMethod(resolvedAuthMethod);

        const headers: Record<string, string> = {
          "anthropic-version": "2023-06-01",
        };

        if (isOAuth) {
          headers["Authorization"] = `Bearer ${apiKey}`;
          Object.assign(headers, ANTHROPIC_STEALTH_HEADERS);
        } else {
          headers["x-api-key"] = apiKey;
        }

        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers,
        });
        if (res.ok) return { valid: true };

        // Fallback: /v1/messages accepts OAuth tokens more reliably
        if (isOAuth) {
          const fallbackRes = await fetch(
            "https://api.anthropic.com/v1/messages",
            {
              method: "POST",
              headers: { ...headers, "content-type": "application/json" },
              body: JSON.stringify({
                model: "claude-haiku-4-5",
                max_tokens: 1,
                messages: [{ role: "user", content: "hi" }],
              }),
            },
          );
          // 200 = valid auth. 400 = auth valid but bad request (still means key works).
          // 401/403 = auth truly failed.
          if (fallbackRes.ok || fallbackRes.status === 400) {
            return { valid: true };
          }
          const errorBody = await fallbackRes.text().catch(() => "");
          return {
            valid: false,
            error: `Anthropic returned ${fallbackRes.status}${errorBody ? `: ${errorBody.slice(0, 200)}` : ""}`,
          };
        }

        return {
          valid: false,
          error: `Anthropic returned ${res.status}`,
        };
      }

      case "openai": {
        const authMethod = credentials.authMethod as string | undefined;
        const isOAuthConnection =
          authMethod === "subscription" || authMethod === "oauth";

        if (isOAuthConnection) {
          // Support both the stored Almirant OAuth credential shape
          // (apiKey/oauthAccessToken/refreshToken/idToken) and the native
          // Codex auth.json shape (auth_mode + tokens.*).
          const subApiKey = credentials.apiKey as string | undefined;
          const oauthAccessToken = credentials.oauthAccessToken as
            | string
            | undefined;
          const chatgptSession = credentials.chatgpt_session as
            | Record<string, unknown>
            | undefined;
          const nativeTokens = credentials.tokens as
            | Record<string, unknown>
            | undefined;
          const accessToken =
            (nativeTokens?.access_token as string | undefined) ??
            (chatgptSession?.access_token as string | undefined) ??
            oauthAccessToken;
          const token = accessToken ?? subApiKey;

          if (!token) {
            return {
              valid: false,
              error: "No access token found in subscription credentials",
            };
          }

          const res = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const errorBody = await res.text().catch(() => "");
          return {
            valid: res.ok,
            error: res.ok
              ? undefined
              : `OpenAI returned ${res.status}${errorBody ? `: ${errorBody.slice(0, 200)}` : ""}`,
          };
        }

        // Default: standard API key flow
        const apiKey = credentials.apiKey as string;
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const errorBody = await res.text().catch(() => "");
        return {
          valid: res.ok,
          error: res.ok
            ? undefined
            : `OpenAI returned ${res.status}${errorBody ? `: ${errorBody.slice(0, 200)}` : ""}`,
        };
      }

      case "google": {
        const apiKey = credentials.apiKey as string;
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        );
        return { valid: res.ok };
      }

      case "zai": {
        const apiKey = credentials.apiKey as string;
        const baseUrl = (credentials.baseUrl as string | undefined) ?? "https://api.z.ai/api/coding/paas/v4";
        const url = baseUrl.replace(/\/+$/, "");
        const res = await fetch(`${url}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok };
      }

      case "xai": {
        const apiKey = credentials.apiKey as string;
        const baseUrl = (credentials.baseUrl as string | undefined) ?? "https://api.x.ai/v1";
        const url = baseUrl.replace(/\/+$/, "");
        const res = await fetch(`${url}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok };
      }

      case "github": {
        const accessToken = credentials.accessToken as string | undefined;
        const apiKey = credentials.apiKey as string | undefined;
        const token = accessToken ?? apiKey;
        if (!token) {
          return { valid: false, error: "No token found in credentials" };
        }
        const res = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        });
        return { valid: res.ok };
      }

      case "vercel": {
        const accessToken = credentials.accessToken as string | undefined;
        const apiKey = credentials.apiKey as string | undefined;
        const token = accessToken ?? apiKey;
        if (!token) {
          return { valid: false, error: "No token found in credentials" };
        }
        const res = await fetch("https://api.vercel.com/v2/user", {
          headers: { Authorization: `Bearer ${token}` },
        });
        return { valid: res.ok };
      }

      case "sentry": {
        const apiKey = credentials.apiKey as string;
        if (!apiKey) {
          return { valid: false, error: "apiKey is required for sentry provider" };
        }
        const res = await fetch("https://sentry.io/api/0/", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok };
      }

      case "posthog": {
        const apiKey = credentials.apiKey as string;
        if (!apiKey) {
          return { valid: false, error: "apiKey is required for posthog provider" };
        }
        const host = (credentials.host as string | undefined) ?? "https://app.posthog.com";
        const normalizedHost = host.replace(/\/+$/, "");
        const res = await fetch(`${normalizedHost}/api/projects/`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        return { valid: res.ok };
      }

      default:
        return { valid: false, error: `Unsupported provider: ${provider}` };
    }
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Connection test failed",
    };
  }
};

// ---------------------------------------------------------------------------
// Elysia type schemas
// ---------------------------------------------------------------------------

const providerEnum = t.Union([
  t.Literal("github"),
  t.Literal("openai"),
  t.Literal("anthropic"),
  t.Literal("google"),
  t.Literal("zai"),
  t.Literal("xai"),
  t.Literal("vercel"),
  t.Literal("sentry"),
  t.Literal("posthog"),
]);

const categoryEnum = t.Union([
  t.Literal("code"),
  t.Literal("ai"),
  t.Literal("deployment"),
  t.Literal("monitoring"),
]);

const scopeEnum = t.Union([
  t.Literal("user"),
  t.Literal("organization"),
]);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const connectionsRoutes = new Elysia({ prefix: "/connections" })
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // GET /connections - List connections visible to the user
  // If query.scope is provided, returns only that scope.
  // Otherwise returns org-scoped + personal connections.
  // -------------------------------------------------------
  .get(
    "/",
    async ({ user, activeWorkspace, query }) => {
      try {
        const userId = (user as { id: string }).id;

        // Build filters from query params
        const baseFilters: {
          provider?: typeof query.provider;
          category?: typeof query.category;
          isActive?: boolean;
        } = {};

        if (query.provider) {
          baseFilters.provider = query.provider;
        }
        if (query.category) {
          baseFilters.category = query.category;
        }
        // Default to active connections only. Pass isActive=false explicitly to include inactive.
        baseFilters.isActive = query.isActive !== undefined
          ? query.isActive === "true"
          : true;

        // Use the active workspace only — not all orgs the user belongs to.
        // This ensures workspace switching shows the correct providers.
        const activeOrgId = (activeWorkspace as { id: string } | null)?.id;

        if (query.scope === "organization") {
          const scopeIds = activeOrgId ? [activeOrgId] : [];
          const scopedConnections = scopeIds.length > 0
            ? await listConnections({
                ...baseFilters,
                scope: "organization",
                scopeIds,
              })
            : [];
          return successResponse(scopedConnections);
        }

        if (query.scope === "user") {
          const userConnections = await listConnections({
            ...baseFilters,
            scope: "user",
            scopeId: userId,
          });
          return successResponse(userConnections);
        }

        // No scope filter: return active org connections + user-scoped connections.
        const [orgConnections, userConnections] = await Promise.all([
          activeOrgId
            ? listConnections({
                ...baseFilters,
                scope: "organization",
                scopeId: activeOrgId,
              })
            : Promise.resolve([]),
          listConnections({
            ...baseFilters,
            scope: "user",
            scopeId: userId,
          }),
        ]);

        return successResponse([...orgConnections, ...userConnections]);
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Failed to list connections",
          500,
        );
      }
    },
    {
      query: t.Object({
        provider: t.Optional(providerEnum),
        category: t.Optional(categoryEnum),
        scope: t.Optional(scopeEnum),
        isActive: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // GET /connections/usage-summary - Get usage data for all
  // visible AI connections, skipping individual failures.
  // -------------------------------------------------------
  .get(
    "/usage-summary",
    async ({ query, user, activeWorkspace, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500,
          );
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        const [orgConnections, userConnections] = await Promise.all([
          listConnections({
            category: "ai",
            isActive: true,
            scope: "organization",
            scopeId: orgId,
          }),
          listConnections({
            category: "ai",
            isActive: true,
            scope: "user",
            scopeId: userId,
          }),
        ]);

        const connections = [...orgConnections, ...userConnections];
        const now = new Date();
        const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        const endDate = now.toISOString().slice(0, 10);

        const results = await Promise.allSettled(
          connections.map(async (connection) => ({
            connectionId: connection.id,
            provider: connection.provider,
            name: connection.name,
            accountIdentifier: connection.accountIdentifier,
            usage: await connectionUsageService.getConnectionUsage(
              connection.id,
              encryptionKey,
              { startDate, endDate },
              { forceRefresh: query.forceRefresh === "true" },
            ),
          })),
        );

        const data = results.flatMap((result, index) => {
          if (result.status === "fulfilled") {
            return [result.value];
          }

          logger.warn(
            {
              connectionId: connections[index]?.id ?? null,
              provider: connections[index]?.provider ?? null,
              error: result.reason,
            },
            "Skipping failed connection usage lookup in usage summary",
          );

          return [];
        });

        return successResponse(data);
      } catch (error) {
        logger.error(error, "Failed to get usage summary");
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to get usage summary",
          500,
        );
      }
    },
    {
      query: t.Object({
        forceRefresh: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // GET /connections/:id - Get connection detail (no decrypted credentials)
  // -------------------------------------------------------
  .get(
    "/:id",
    async ({ params, user, activeWorkspace, set }) => {
      try {
        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        const connection = await getConnectionById(params.id);

        if (!connection) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        // Verify the connection belongs to this user or org
        const isOwner =
          (connection.scope === "user" && connection.scopeId === userId) ||
          (connection.scope === "organization" && connection.scopeId === orgId);

        if (!isOwner) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        return successResponse(connection);
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Failed to get connection",
          500,
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // -------------------------------------------------------
  // POST /connections - Create a new connection
  // -------------------------------------------------------
  .post(
    "/",
    async ({ body, user, activeWorkspace, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500,
          );
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        // Validate scope/category combination
        if (!validateScopeForCategory(body.scope, body.category)) {
          set.status = 400;
          return errorResponse(
            `Invalid scope "${body.scope}" for category "${body.category}". ` +
              `Code and deployment connections must be workspace-scoped.`,
          );
        }

        // Determine scopeId based on scope
        const scopeId = body.scope === "organization" ? orgId : userId;
        const nextConfig = { ...(body.config ?? {}) } as Record<string, unknown>;
        if (body.planningModel !== undefined) {
          nextConfig.planningModel = body.planningModel;
        }
        if (body.implementationModel !== undefined) {
          nextConfig.implementationModel = body.implementationModel;
        }
        if (body.validationModel !== undefined) {
          nextConfig.validationModel = body.validationModel;
        }
        if (body.planningReasoningBudget !== undefined) {
          nextConfig.planningReasoningBudget = body.planningReasoningBudget;
        }
        if (body.implementationReasoningBudget !== undefined) {
          nextConfig.implementationReasoningBudget = body.implementationReasoningBudget;
        }
        if (body.validationReasoningBudget !== undefined) {
          nextConfig.validationReasoningBudget = body.validationReasoningBudget;
        }

        const connection = await createConnection(
          {
            provider: body.provider,
            category: body.category,
            scope: body.scope,
            scopeId,
            createdByUserId: userId,
            name: body.name.trim(),
            accountIdentifier: body.accountIdentifier?.trim() ?? null,
            isActive: true,
            isDefault: body.isDefault,
            config: nextConfig,
            credentials: body.credentials,
          },
          encryptionKey,
        );

        set.status = 201;
        return successResponse(connection);
      } catch (error) {
        logger.error(error, "Failed to create connection");
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to create connection",
          500,
        );
      }
    },
    {
      body: t.Object({
        provider: providerEnum,
        category: categoryEnum,
        scope: scopeEnum,
        name: t.String({ minLength: 1 }),
        accountIdentifier: t.Optional(t.String()),
        isDefault: t.Optional(t.Boolean()),
        credentials: t.Optional(
          t.Record(t.String(), t.Unknown()),
        ),
        config: t.Optional(
          t.Record(t.String(), t.Unknown()),
        ),
        planningModel: t.Optional(t.String()),
        implementationModel: t.Optional(t.String()),
        validationModel: t.Optional(t.String()),
        planningReasoningBudget: t.Optional(t.String()),
        implementationReasoningBudget: t.Optional(t.String()),
        validationReasoningBudget: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // PATCH /connections/:id - Update a connection
  // -------------------------------------------------------
  .patch(
    "/:id",
    async ({ params, body, user, activeWorkspace, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500,
          );
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        // Verify the connection belongs to this user or org
        const existing = await getConnectionById(params.id);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        const isOwner =
          (existing.scope === "user" && existing.scopeId === userId) ||
          (existing.scope === "organization" && existing.scopeId === orgId);

        if (!isOwner) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        // Detect when a setup token is pasted into an Anthropic OAuth connection
        // and auto-correct authMethod + clear stale tokenExpiresAt
        const isSetupTokenUpdate =
          existing.provider === "anthropic" &&
          typeof (body.credentials as Record<string, unknown>)?.apiKey === "string" &&
          isAnthropicSetupToken((body.credentials as Record<string, unknown>).apiKey as string);

        const updated = await updateConnection(
          params.id,
          {
            ...(body.name !== undefined && { name: body.name.trim() }),
            ...(body.accountIdentifier !== undefined && {
              accountIdentifier: body.accountIdentifier.trim(),
            }),
            ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
            ...(body.orchestrationEnabled !== undefined && { orchestrationEnabled: body.orchestrationEnabled }),
            ...(body.priority !== undefined && { priority: body.priority }),
            ...((body.config !== undefined ||
              body.planningModel !== undefined ||
              body.implementationModel !== undefined ||
              body.validationModel !== undefined ||
              body.planningReasoningBudget !== undefined ||
              body.implementationReasoningBudget !== undefined ||
              body.validationReasoningBudget !== undefined ||
              isSetupTokenUpdate) && {
              config: {
                ...(existing.config ?? {}),
                ...(body.config ?? {}),
                ...(body.planningModel !== undefined
                  ? { planningModel: body.planningModel }
                  : {}),
                ...(body.implementationModel !== undefined
                  ? { implementationModel: body.implementationModel }
                  : {}),
                ...(body.validationModel !== undefined
                  ? { validationModel: body.validationModel }
                  : {}),
                ...(body.planningReasoningBudget !== undefined
                  ? { planningReasoningBudget: body.planningReasoningBudget }
                  : {}),
                ...(body.implementationReasoningBudget !== undefined
                  ? { implementationReasoningBudget: body.implementationReasoningBudget }
                  : {}),
                ...(body.validationReasoningBudget !== undefined
                  ? { validationReasoningBudget: body.validationReasoningBudget }
                  : {}),
                ...(isSetupTokenUpdate
                  ? { authMethod: "setup_token" }
                  : {}),
              },
            }),
            ...(body.credentials !== undefined && {
              credentials: {
                ...body.credentials,
                ...(isSetupTokenUpdate
                  ? { authMethod: "setup_token" }
                  : {}),
              },
            }),
            ...(isSetupTokenUpdate && { tokenExpiresAt: null }),
          },
          encryptionKey,
        );

        if (!updated) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        return successResponse(updated);
      } catch (error) {
        logger.error(error, "Failed to update connection");
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to update connection",
          500,
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        accountIdentifier: t.Optional(t.String()),
        isDefault: t.Optional(t.Boolean()),
        orchestrationEnabled: t.Optional(t.Boolean()),
        priority: t.Optional(t.Number({ minimum: 0 })),
        credentials: t.Optional(
          t.Record(t.String(), t.Unknown()),
        ),
        config: t.Optional(
          t.Record(t.String(), t.Unknown()),
        ),
        planningModel: t.Optional(t.String()),
        implementationModel: t.Optional(t.String()),
        validationModel: t.Optional(t.String()),
        planningReasoningBudget: t.Optional(t.String()),
        implementationReasoningBudget: t.Optional(t.String()),
        validationReasoningBudget: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // DELETE /connections/:id - Soft delete (deactivate)
  // -------------------------------------------------------
  .delete(
    "/:id",
    async ({ params, user, activeWorkspace, set }) => {
      try {
        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        // Verify ownership before deactivating
        const existing = await getConnectionById(params.id);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        const isOwner =
          (existing.scope === "user" && existing.scopeId === userId) ||
          (existing.scope === "organization" && existing.scopeId === orgId);

        if (!isOwner) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        const deactivated = await deactivateConnection(params.id);

        if (!deactivated) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        return successResponse({ deleted: true });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to delete connection",
          500,
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // -------------------------------------------------------
  // POST /connections/test-credentials - Test raw credentials
  // without writing to the database.
  // -------------------------------------------------------
  .post(
    "/test-credentials",
    async ({ body, set }) => {
      try {
        const mergedCredentials = {
          ...body.credentials,
          ...(body.config ?? {}),
        };

        const result = await testProviderConnection(
          body.provider,
          mergedCredentials,
        );

        return successResponse(result);
      } catch (error) {
        logger.error(error, "Failed to test credentials");
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to test credentials",
          500,
        );
      }
    },
    {
      body: t.Object({
        provider: providerEnum,
        credentials: t.Record(t.String(), t.Unknown()),
        config: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    },
  )

  // -------------------------------------------------------
  // POST /connections/:id/test - Test connection credentials
  // -------------------------------------------------------
  .post(
    "/:id/test",
    async ({ params, user, activeWorkspace, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500,
          );
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        // Fetch full connection with encrypted fields for decryption
        const connection = await getConnectionById(params.id, encryptionKey);

        if (!connection) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        // Verify ownership
        const isOwner =
          (connection.scope === "user" && connection.scopeId === userId) ||
          (connection.scope === "organization" && connection.scopeId === orgId);

        if (!isOwner) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        // Decrypt credentials (getConnectionById with encryptionKey already does this)
        const credentials = connection.credentials;
        if (!credentials) {
          set.status = 400;
          return errorResponse("Connection has no credentials to test");
        }

        // Also merge config fields that may contain authMethod, baseUrl, etc.
        const config = (connection.config ?? {}) as Record<string, unknown>;
        const mergedCredentials = { ...credentials, ...config };

        const result = await testProviderConnection(
          connection.provider,
          mergedCredentials,
        );

        // Touch lastUsedAt in the background
        void updateConnectionLastUsedAt(connection.id);

        // Update validation status in the background
        void updateConnectionValidation(
          connection.id,
          result.valid ? "valid" : "invalid",
          result.error,
        );

        return successResponse(result);
      } catch (error) {
        logger.error(error, "Failed to test connection");
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to test connection",
          500,
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // -------------------------------------------------------
  // POST /connections/:id/reconnect - Reconnect (refresh credentials)
  // Accepts either OAuth code+state or a raw setup token.
  // Updates credentials without touching name/priority/models.
  // -------------------------------------------------------
  .post(
    "/:id/reconnect",
    async ({ params, body, user, activeWorkspace, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse("Encryption key not configured.", 500);
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        const existing = await getConnectionById(params.id);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        const isOwner =
          (existing.scope === "user" && existing.scopeId === userId) ||
          (existing.scope === "organization" && existing.scopeId === orgId);
        if (!isOwner) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        // ---- Setup token mode ----
        if (body.setupToken) {
          const token = body.setupToken.trim();
          const credentials: Record<string, unknown> = {
            apiKey: token,
            authMethod: "setup_token",
          };
          const existingConfig = (existing.config ?? {}) as Record<string, unknown>;
          const config = { ...existingConfig, authMethod: "setup_token" };

          const updated = await updateConnection(
            params.id,
            {
              credentials,
              config,
              tokenExpiresAt: null,
              accountIdentifier: `${token.slice(0, 7)}...`,
              suspendedAt: null,
              lastValidationStatus: null,
              lastValidationError: null,
            },
            encryptionKey,
          );

          if (!updated) {
            set.status = 404;
            return notFoundResponse("Connection");
          }

          logger.info(
            { connectionId: params.id, provider: existing.provider },
            "Connection reconnected via setup token",
          );

          return successResponse(updated);
        }

        // ---- OAuth mode ----
        if (!body.code || !body.state) {
          set.status = 400;
          return errorResponse("Either setupToken or code+state is required.");
        }

        const providerConfig = await getOAuthProvider(existing.provider);
        if (!providerConfig) {
          set.status = 400;
          return errorResponse(
            `OAuth not configured for provider: ${existing.provider}`,
          );
        }

        // Validate OAuth state
        const stateToVerify = body.state;
        let storedState: Awaited<ReturnType<typeof getOAuthStateByState>> | null =
          null;
        try {
          storedState = await getOAuthStateByState(stateToVerify);
        } catch {
          logger.warn(
            "Failed to load OAuth state from database during reconnect",
          );
        }

        const signedState =
          !storedState && env.ENCRYPTION_KEY
            ? verifyOAuthStateToken(stateToVerify, env.ENCRYPTION_KEY)
            : null;

        if (!storedState && !signedState) {
          set.status = 400;
          return errorResponse(
            "Invalid or expired OAuth state. Please try again.",
          );
        }

        if (storedState?.userId && storedState.userId !== userId) {
          set.status = 403;
          return errorResponse("OAuth state does not belong to this user.");
        }

        const { code } = parseManualOAuthCode(body.code);

        const tokenResponse = await exchangeCode(
          providerConfig,
          code,
          storedState?.codeVerifier ?? signedState?.codeVerifier,
          { state: stateToVerify },
        );

        if (storedState) {
          await deleteOAuthState(storedState.id);
        }

        const accessToken = tokenResponse.access_token;
        const tokenExpiresAt = tokenResponse.expires_in
          ? new Date(Date.now() + tokenResponse.expires_in * 1000)
          : null;

        const credentials = await buildOAuthCredentialsFromTokenResponse({
          provider: existing.provider,
          tokenResponse,
          currentCredentials: (existing.credentials ?? {}) as Record<string, unknown>,
          defaultScopes: providerConfig.scopes,
        });
        const oauthScopes =
          typeof credentials.oauthScopes === "string"
            ? credentials.oauthScopes
            : providerConfig.scopes;

        const existingConfig = (existing.config ?? {}) as Record<
          string,
          unknown
        >;
        const config = {
          ...existingConfig,
          authMethod: "oauth",
          oauthScopes: oauthScopes ?? null,
        };

        const updated = await updateConnection(
          params.id,
          {
            credentials,
            config,
            tokenExpiresAt,
            accountIdentifier: `${accessToken.slice(0, 7)}...`,
            suspendedAt: null,
            lastValidationStatus: null,
            lastValidationError: null,
          },
          encryptionKey,
        );

        if (!updated) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        logger.info(
          {
            connectionId: params.id,
            provider: existing.provider,
            hasRefreshToken: !!tokenResponse.refresh_token,
            scopes: oauthScopes,
          },
          "Connection reconnected via OAuth",
        );

        return successResponse(updated);
      } catch (error) {
        logger.error(error, "Failed to reconnect connection");
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to reconnect",
          500,
        );
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        code: t.Optional(t.String()),
        state: t.Optional(t.String()),
        setupToken: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // GET /connections/:id/usage - Get usage data for AI connection
  // -------------------------------------------------------
  .get(
    "/:id/usage",
    async ({ params, query, user, activeWorkspace, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500,
          );
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        const connection = await getConnectionById(params.id, encryptionKey);

        if (!connection) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        const isOwner =
          (connection.scope === "user" && connection.scopeId === userId) ||
          (connection.scope === "organization" &&
            connection.scopeId === orgId);

        if (!isOwner) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        if (connection.category !== "ai") {
          set.status = 400;
          return errorResponse(
            "Usage data is only available for AI connections",
          );
        }

        // Default to last 30 days
        const now = new Date();
        const startDate =
          query.startDate ??
          new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);
        const endDate = query.endDate ?? now.toISOString().slice(0, 10);

        const result = await connectionUsageService.getConnectionUsage(
          params.id,
          encryptionKey,
          { startDate, endDate },
          { forceRefresh: query.forceRefresh === "true" },
        );

        return successResponse(result);
      } catch (error) {
        logger.error(error, "Failed to get connection usage");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to get connection usage",
          500,
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        startDate: t.Optional(t.String()),
        endDate: t.Optional(t.String()),
        forceRefresh: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------
  // POST /connections/:id/set-default - Set connection as default
  // -------------------------------------------------------
  .post(
    "/:id/set-default",
    async ({ params, user, activeWorkspace, set }) => {
      try {
        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        // Verify the connection exists and belongs to this user or org
        const existing = await getConnectionById(params.id);
        if (!existing) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        const isOwner =
          (existing.scope === "user" && existing.scopeId === userId) ||
          (existing.scope === "organization" && existing.scopeId === orgId);

        if (!isOwner) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        if (!existing.isActive) {
          set.status = 400;
          return errorResponse("Cannot set inactive connection as default");
        }

        const updated = await setConnectionAsDefault(params.id);

        if (!updated) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        return successResponse(updated);
      } catch (error) {
        logger.error(error, "Failed to set connection as default");
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to set connection as default",
          500,
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // -------------------------------------------------------
  // POST /connections/:id/refresh - Refresh OAuth token
  // Uses the generic OAuth library to refresh tokens for providers
  // that support it (e.g. Anthropic, OpenAI).
  // -------------------------------------------------------
  .post(
    "/:id/refresh",
    async ({ params, user, activeWorkspace, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500,
          );
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        const connection = await getConnectionById(params.id, encryptionKey);

        if (!connection) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        // Verify ownership
        const isOwner =
          (connection.scope === "user" && connection.scopeId === userId) ||
          (connection.scope === "organization" && connection.scopeId === orgId);

        if (!isOwner) {
          set.status = 404;
          return notFoundResponse("Connection");
        }

        const config = (connection.config ?? {}) as Record<string, unknown>;
        if (config.authMethod !== "oauth") {
          set.status = 400;
          return errorResponse(
            "Token refresh is only available for OAuth-authenticated connections",
          );
        }

        // Get the OAuth provider config for this provider
        const providerConfig = await getOAuthProvider(connection.provider);
        if (!providerConfig) {
          set.status = 400;
          return errorResponse(
            `OAuth refresh is not supported for provider: ${connection.provider}. ` +
              "Re-authenticate via the provider's OAuth flow.",
          );
        }

        // Decrypt existing credentials to get the refresh token
        const credentials = connection.credentials;
        if (!credentials) {
          set.status = 400;
          return errorResponse("Connection has no credentials to refresh.");
        }

        const currentRefreshToken = credentials.refreshToken as string | undefined;
        if (!currentRefreshToken) {
          set.status = 400;
          return errorResponse(
            "No refresh token available for this connection. Re-authenticate via OAuth.",
          );
        }

        // Refresh the token using the generic OAuth library
        const tokenData = await refreshOAuthToken(providerConfig, currentRefreshToken);

        const newCredentials = await buildOAuthCredentialsFromTokenResponse({
          provider: connection.provider,
          tokenResponse: tokenData,
          currentCredentials: credentials,
        });

        const newExpiresAt = tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null;

        const updated = await updateConnection(
          connection.id,
          {
            credentials: newCredentials,
            tokenExpiresAt: newExpiresAt,
            accountIdentifier: buildTokenPrefix(tokenData.access_token),
          },
          encryptionKey,
        );

        logger.info(
          { userId, connectionId: connection.id, provider: connection.provider },
          "OAuth token refreshed successfully via connections route",
        );

        return successResponse({
          refreshed: true,
          tokenExpiresAt: newExpiresAt,
          id: updated?.id ?? connection.id,
        });
      } catch (error) {
        logger.error(error, "Failed to refresh connection token");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to refresh connection token",
          500,
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )

  // ===================================================================
  // OAuth endpoints - Unified OAuth flow for all supported providers
  // ===================================================================

  // -------------------------------------------------------
  // GET /connections/oauth/providers - List providers that support OAuth
  // -------------------------------------------------------
  .get("/oauth/providers", async () => {
    const providers = await Promise.all(
      getSupportedOAuthProviders().map(async (name) => {
        const config = await getOAuthProvider(name);
        return {
          name,
          manualCodeEntry: config?.manualCodeEntry ?? false,
        };
      }),
    );
    return successResponse(providers);
  })

  // -------------------------------------------------------
  // GET /connections/oauth/:provider/auth-url - Generate OAuth auth URL
  // Creates a CSRF state token and stores it with the user/scope context.
  // -------------------------------------------------------
  .get(
    "/oauth/:provider/auth-url",
    async ({ params, user, activeWorkspace, query, set }) => {
      try {
        const providerConfig = await getOAuthProvider(params.provider);
        if (!providerConfig) {
          set.status = 400;
          return errorResponse(
            `OAuth is not configured for provider: ${params.provider}`,
          );
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        // Determine scope: default to "user" for AI, "organization" for code/deployment
        const category = defaultCategoryForProvider(params.provider);
        const scope = query.scope ?? (category === "ai" ? "user" : "organization");
        const scopeId = scope === "organization" ? orgId : userId;

        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        let state: string = crypto.randomUUID();
        const result = await generateAuthUrl(providerConfig, state);

        try {
          // Store state + PKCE verifier in DB for verification on callback.
          // The provider column uses aiProviderEnum which supports the AI providers.
          await createOAuthState({
            userId,
            provider: params.provider as "anthropic" | "openai" | "google" | "zai" | "xai",
            state,
            codeVerifier: result.pkce?.codeVerifier ?? null,
            expiresAt,
          });
        } catch (error) {
          if (!env.ENCRYPTION_KEY) {
            throw error;
          }

          state = createOAuthStateToken({
            provider: params.provider,
            userId,
            codeVerifier: result.pkce?.codeVerifier ?? null,
            expiresAt,
            secret: env.ENCRYPTION_KEY,
          });

          logger.warn(
            { err: error, provider: params.provider, userId },
            "Falling back to signed OAuth state token",
          );
        }

        // Clean up expired states in the background
        void cleanExpiredOAuthStates().catch(() => {});

        return successResponse({
          url:
            state === result.state
              ? result.url
              : replaceAuthUrlState(result.url, state),
          state,
          manualCodeEntry: providerConfig.manualCodeEntry,
          // Echo back the scope/category that will be used on callback
          scope,
          scopeId,
          category,
        });
      } catch (error) {
        logger.error(error, `Failed to generate OAuth URL for ${params.provider}`);
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to generate OAuth URL",
          500,
        );
      }
    },
    {
      params: t.Object({ provider: t.String() }),
      query: t.Object({
        scope: t.Optional(scopeEnum),
      }),
    },
  )

  // -------------------------------------------------------
  // POST /connections/oauth/:provider/callback - Handle OAuth callback
  // Exchanges the authorization code for tokens, creates a
  // provider_connection with encrypted credentials.
  // -------------------------------------------------------
  .post(
    "/oauth/:provider/callback",
    async ({ params, body, user, activeWorkspace, set }) => {
      try {
        const providerConfig = await getOAuthProvider(params.provider);
        if (!providerConfig) {
          set.status = 400;
          return errorResponse(
            `OAuth is not configured for provider: ${params.provider}`,
          );
        }

        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500,
          );
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        // Anthropic manual entry can return a plain code, a code#state pair,
        // or a full callback URL/query string depending on the browser flow.
        const manualCode = providerConfig.manualCodeEntry
          ? parseManualOAuthCode(body.code)
          : { code: body.code, state: null };
        const code = manualCode.code;
        let stateToVerify = body.state;

        if (!stateToVerify && manualCode.state) {
          stateToVerify = manualCode.state;
        }

        // Verify CSRF state against server-stored value
        let storedState = null;
        try {
          storedState = await getOAuthStateByState(stateToVerify);
        } catch (error) {
          logger.warn(
            { err: error, provider: params.provider, userId },
            "Failed to load OAuth state from database, trying signed token fallback",
          );
        }

        const signedState =
          !storedState && env.ENCRYPTION_KEY
            ? verifyOAuthStateToken(stateToVerify, env.ENCRYPTION_KEY)
            : null;

        if (!storedState && !signedState) {
          set.status = 400;
          return errorResponse("Invalid or expired OAuth state. Please try again.");
        }

        if (storedState && storedState.userId !== userId) {
          set.status = 403;
          return errorResponse("OAuth state does not belong to this user.");
        }

        if (signedState) {
          if (signedState.userId !== userId) {
            set.status = 403;
            return errorResponse("OAuth state does not belong to this user.");
          }

          if (signedState.provider !== params.provider) {
            set.status = 400;
            return errorResponse("OAuth state provider mismatch.");
          }
        }

        // Exchange authorization code for tokens
        const tokenResponse = await exchangeCode(
          providerConfig,
          code,
          storedState?.codeVerifier ?? signedState?.codeVerifier,
          {
            state: stateToVerify,
          },
        );

        // Clean up the used state
        if (storedState) {
          await deleteOAuthState(storedState.id);
        }

        const accessToken = tokenResponse.access_token;
        const tokenPrefix = buildTokenPrefix(accessToken);

        const tokenExpiresAt = tokenResponse.expires_in
          ? new Date(Date.now() + tokenResponse.expires_in * 1000)
          : null;

        // Determine scope, scopeId and category for the new connection
        const category = body.category ?? defaultCategoryForProvider(params.provider);
        const scope = body.scope ?? (category === "ai" ? "user" : "organization");
        const scopeId = scope === "organization" ? orgId : userId;

        // Map the provider name to the provider_type enum value
        const mappedProvider = mapAiProviderToConnectionProvider(params.provider);

        const credentials = await buildOAuthCredentialsFromTokenResponse({
          provider: params.provider,
          tokenResponse,
          defaultScopes: providerConfig.scopes,
        });
        const oauthScopes =
          typeof credentials.oauthScopes === "string"
            ? credentials.oauthScopes
            : providerConfig.scopes;

        // Build config (non-secret metadata)
        const connectionConfig: Record<string, unknown> = {
          authMethod: "oauth",
          oauthScopes: oauthScopes ?? null,
        };

        // Capitalize provider name for display
        const displayName =
          providerConfig.name.charAt(0).toUpperCase() +
          providerConfig.name.slice(1);

        const connectionName = body.name?.trim() || `${displayName} (OAuth)`;

        // Create the new connection
        const connection = await createConnection(
          {
            provider: mappedProvider,
            category,
            scope,
            scopeId,
            createdByUserId: userId,
            name: connectionName,
            accountIdentifier: tokenPrefix,
            isActive: true,
            tokenExpiresAt,
            config: connectionConfig,
            credentials,
          },
          encryptionKey,
        );

        logger.info(
          {
            userId,
            provider: params.provider,
            connectionId: connection.id,
            scope,
            scopes: oauthScopes,
          },
          "OAuth connection created successfully via connections route",
        );

        set.status = 201;
        return successResponse(connection);
      } catch (error) {
        logger.error(error, `Failed to process OAuth callback for ${params.provider}`);
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to process OAuth callback",
          500,
        );
      }
    },
    {
      params: t.Object({ provider: t.String() }),
      body: t.Object({
        code: t.String({ minLength: 1 }),
        state: t.String(),
        scope: t.Optional(scopeEnum),
        category: t.Optional(categoryEnum),
        name: t.Optional(t.String()),
      }),
    },
  )

  // ===================================================================
  // Device Code Flow — OpenAI subscription (no redirect URI needed)
  // ===================================================================

  // POST /connections/device-code/request — get a user code
  .post(
    "/device-code/request",
    async ({ set }) => {
      try {
        const { requestDeviceCode } = await import("../services/oauth/device-code");
        const result = await requestDeviceCode();
        return successResponse(result);
      } catch (error) {
        logger.error(error, "Failed to request device code");
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to request device code",
          500,
        );
      }
    },
  )

  // POST /connections/device-code/poll — check if user authorized
  .post(
    "/device-code/poll",
    async ({ body, user, activeWorkspace, set }) => {
      try {
        const { pollDeviceToken } = await import("../services/oauth/device-code");
        const result = await pollDeviceToken(body.deviceAuthId, body.userCode);

        if (result.status !== "completed" || !result.tokenResponse) {
          return successResponse(result);
        }

        // Token obtained — create the connection
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse("Encryption key not configured", 500);
        }

        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;
        const scope = body.scope ?? "organization";
        const scopeId = scope === "organization" ? orgId : userId;

        const accessToken = result.tokenResponse.access_token;
        const credentials = await buildOAuthCredentialsFromTokenResponse({
          provider: "openai",
          tokenResponse: result.tokenResponse,
        });
        const oauthScopes =
          typeof credentials.oauthScopes === "string"
            ? credentials.oauthScopes
            : null;

        const tokenExpiresAt = result.tokenResponse.expires_in
          ? new Date(Date.now() + result.tokenResponse.expires_in * 1000)
          : null;

        const connection = await createConnection(
          {
            provider: "openai",
            category: "ai",
            scope,
            scopeId,
            createdByUserId: userId,
            name: body.name ?? "ChatGPT Pro",
            credentials,
            config: {
              authMethod: "oauth",
              ...(oauthScopes ? { oauthScopes } : {}),
            },
            tokenExpiresAt,
            accountIdentifier: `${accessToken.slice(0, 7)}...`,
          },
          encryptionKey,
        );

        logger.info(
          { connectionId: connection.id, provider: "openai", scope },
          "OpenAI device code connection created",
        );

        return successResponse({
          status: "completed",
          connection,
        });
      } catch (error) {
        logger.error(error, "Failed to poll device token");
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to poll device token",
          500,
        );
      }
    },
    {
      body: t.Object({
        deviceAuthId: t.String(),
        userCode: t.String(),
        scope: t.Optional(scopeEnum),
        name: t.Optional(t.String()),
      }),
    },
  )

  // ===================================================================
  // Link-token endpoints — CLI-to-web credential transfer
  // ===================================================================

  // -------------------------------------------------------
  // POST /connections/link-token - Create a link token
  // The frontend creates a token, displays it to the user, and the CLI
  // uses it to submit credentials back (via the public complete endpoint).
  // -------------------------------------------------------
  .post(
    "/link-token",
    async ({ body, user, activeWorkspace }) => {
      try {
        const userId = (user as { id: string }).id;
        const orgId = (activeWorkspace as { id: string }).id;

        const entry = createLinkToken({
          userId,
          workspaceId: orgId,
          provider: body.provider,
          scope: body.scope,
        });

        return successResponse({
          token: entry.token,
          expiresAt: entry.expiresAt.toISOString(),
        });
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Failed to create link token",
          500,
        );
      }
    },
    {
      body: t.Object({
        provider: providerEnum,
        scope: scopeEnum,
      }),
    },
  )

  // -------------------------------------------------------
  // GET /connections/link-token/:token/status - Poll link token status
  // The frontend polls this endpoint until the CLI completes the token.
  // When completed, the frontend creates the connection and deletes the token.
  // -------------------------------------------------------
  .get(
    "/link-token/:token/status",
    async ({ params, user, set }) => {
      try {
        const userId = (user as { id: string }).id;
        const entry = getLinkToken(params.token);

        if (!entry) {
          set.status = 404;
          return notFoundResponse("Link token");
        }

        // Only the user who created the token can poll it
        if (entry.userId !== userId) {
          set.status = 404;
          return notFoundResponse("Link token");
        }

        return successResponse({
          status: entry.status,
          provider: entry.provider,
          credentials: entry.status === "completed" ? entry.credentials : null,
          config: entry.status === "completed" ? entry.config : null,
          connectionName: entry.status === "completed" ? entry.connectionName : null,
          expiresAt: entry.expiresAt.toISOString(),
        });
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Failed to get link token status",
          500,
        );
      }
    },
    {
      params: t.Object({
        token: t.String(),
      }),
    },
  )

  // -------------------------------------------------------
  // DELETE /connections/link-token/:token - Delete a link token
  // Used by the frontend to clean up after consuming a completed token,
  // or to cancel a pending token.
  // -------------------------------------------------------
  .delete(
    "/link-token/:token",
    async ({ params, user, set }) => {
      try {
        const userId = (user as { id: string }).id;
        const entry = getLinkToken(params.token);

        if (!entry) {
          set.status = 404;
          return notFoundResponse("Link token");
        }

        if (entry.userId !== userId) {
          set.status = 404;
          return notFoundResponse("Link token");
        }

        deleteLinkToken(params.token);
        return successResponse({ deleted: true });
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Failed to delete link token",
          500,
        );
      }
    },
    {
      params: t.Object({
        token: t.String(),
      }),
    },
  );
