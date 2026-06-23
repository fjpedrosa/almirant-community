import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  createAiProviderKey,
  getAiProviderKeysByUserId,
  getAiProviderKeyById,
  deleteAiProviderKey,
  updateConnectionLastUsedAt,
  getOAuthAiKeyByUserAndProvider,
  updateAiProviderKeyCredentials,
  decryptCredentials,
  mapConnectionProviderToAiProvider,
  createOAuthState,
  getOAuthStateByState,
  deleteOAuthState,
  cleanExpiredOAuthStates,
} from "@almirant/database";
import { env, logger } from "@almirant/config";
import { encrypt } from "../../../shared/services/encryption";
import {
  getOAuthProvider,
  generateAuthUrl,
  exchangeCode,
  refreshToken as refreshOAuthToken,
  getSupportedOAuthProviders,
  ANTHROPIC_SETUP_TOKEN_PREFIX,
  ANTHROPIC_SETUP_TOKEN_MIN_LENGTH,
  isAnthropicSetupToken,
  getStealthHeaders,
} from "../services/oauth";
import {
  isCodexConfigured,
  getCodexOAuthUrl,
  exchangeCodexCode,
  refreshCodexToken,
} from "../../ai/shared/services/codex-service";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
} from "../../../shared/services/response";
import { parseManualOAuthCode } from "../services/oauth/manual-code";

type ProviderKeyAuthMethod = "api_key" | "setup_token" | "oauth";

const buildKeyPrefix = (secret: string): string => {
  // DB column is varchar(10): keep a short non-sensitive preview like "sk-ant-...".
  return `${secret.slice(0, 7)}...`;
};

const resolveProviderKeyAuthMethod = (params: {
  provider: string;
  apiKey: string;
  requestedAuthMethod?: "api_key" | "setup_token";
}): "api_key" | "setup_token" => {
  if (params.provider !== "anthropic") {
    return "api_key";
  }
  if (params.requestedAuthMethod) {
    return params.requestedAuthMethod;
  }
  return isAnthropicSetupToken(params.apiKey) ? "setup_token" : "api_key";
};

const validateAnthropicSetupToken = (token: string): string | null => {
  if (!token.startsWith(ANTHROPIC_SETUP_TOKEN_PREFIX)) {
    return `Setup token must start with "${ANTHROPIC_SETUP_TOKEN_PREFIX}"`;
  }
  if (token.length < ANTHROPIC_SETUP_TOKEN_MIN_LENGTH) {
    return `Setup token must be at least ${ANTHROPIC_SETUP_TOKEN_MIN_LENGTH} characters`;
  }
  return null;
};

const testProviderConnection = async (
  provider: string,
  apiKey: string,
  baseUrl?: string | null,
  authMethod: ProviderKeyAuthMethod = "api_key"
): Promise<boolean> => {
  try {
    switch (provider) {
      case "anthropic": {
        const useSetupToken =
          authMethod === "setup_token" ||
          authMethod === "oauth" ||
          isAnthropicSetupToken(apiKey);
        if (useSetupToken) {
          const stealthHeaders = getStealthHeaders("anthropic", "setup_token") ?? {};
          const res = await fetch("https://api.anthropic.com/v1/models", {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "anthropic-version": "2023-06-01",
              ...stealthHeaders,
            },
          });
          return res.ok;
        }
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });
        return res.ok;
      }
      case "openai": {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        return res.ok;
      }
      case "google": {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        return res.ok;
      }
      case "zai": {
        const zaiUrl = (baseUrl ?? "https://api.z.ai/api/coding/paas/v4").replace(/\/+$/, "");
        const res = await fetch(`${zaiUrl}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        return res.ok;
      }
      case "xai": {
        const xaiUrl = (baseUrl ?? "https://api.x.ai/v1").replace(/\/+$/, "");
        const res = await fetch(`${xaiUrl}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        return res.ok;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
};

export const providerKeysRoutes = new Elysia({ prefix: "/provider-keys" })
  .use(sessionContextTypes)

  // -------------------------------------------------------
  // POST /provider-keys - Create a new provider key
  // -------------------------------------------------------
  .post(
    "/",
    async ({ body, user, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500
          );
        }

        const userId = (user as { id: string }).id;
        const authMethod = resolveProviderKeyAuthMethod({
          provider: body.provider,
          apiKey: body.apiKey,
          requestedAuthMethod: body.authMethod,
        });

        if (authMethod === "setup_token" && body.provider !== "anthropic") {
          set.status = 400;
          return errorResponse("setup_token is only supported for Anthropic provider", 400);
        }

        if (body.provider === "anthropic" && authMethod === "setup_token") {
          const setupTokenValidationError = validateAnthropicSetupToken(body.apiKey);
          if (setupTokenValidationError) {
            set.status = 400;
            return errorResponse(setupTokenValidationError, 400);
          }
        }

        const keyPrefix = buildKeyPrefix(body.apiKey);

        const result = await createAiProviderKey(
          {
            userId,
            name: body.name.trim(),
            provider: body.provider,
            apiKey: body.apiKey,
            keyPrefix,
            baseUrl: body.baseUrl?.trim() || null,
            authMethod,
          },
          encryptionKey
        );

        set.status = 201;
        return successResponse(result);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Failed to create provider key";
        if (
          body.provider === "anthropic" &&
          body.authMethod === "setup_token" &&
          /auth_method/i.test(errorMessage) &&
          /setup_token/i.test(errorMessage)
        ) {
          set.status = 500;
          return errorResponse(
            "Database schema is missing setup_token support for auth_method. Run `bun run db:migrate` and retry.",
            500
          );
        }
        set.status = 500;
        return errorResponse(
          errorMessage,
          500
        );
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        provider: t.Union([
          t.Literal("anthropic"),
          t.Literal("openai"),
          t.Literal("google"),
          t.Literal("zai"),
          t.Literal("xai"),
        ]),
        apiKey: t.String({ minLength: 1 }),
        baseUrl: t.Optional(t.String()),
        authMethod: t.Optional(
          t.Union([t.Literal("api_key"), t.Literal("setup_token")])
        ),
      }),
    }
  )

  // -------------------------------------------------------
  // GET /provider-keys - List provider keys for current user
  // -------------------------------------------------------
  .get("/", async ({ user }) => {
    try {
      const userId = (user as { id: string }).id;
      const keys = await getAiProviderKeysByUserId(userId);
      return successResponse(keys);
    } catch (error) {
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to fetch provider keys",
        500
      );
    }
  })

  // -------------------------------------------------------
  // DELETE /provider-keys/:id - Soft delete
  // -------------------------------------------------------
  .delete(
    "/:id",
    async ({ params, user, set }) => {
      try {
        const userId = (user as { id: string }).id;
        const deleted = await deleteAiProviderKey(params.id, userId);

        if (!deleted) {
          set.status = 404;
          return notFoundResponse("Provider key");
        }

        return successResponse({ deleted: true });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to delete provider key",
          500
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // POST /provider-keys/:id/test - Test connection
  // -------------------------------------------------------
  .post(
    "/:id/test",
    async ({ params, user, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500
          );
        }

        const userId = (user as { id: string }).id;
        const key = await getAiProviderKeyById(params.id);

        if (!key || key.scopeId !== userId) {
          set.status = 404;
          return notFoundResponse("Provider key");
        }

        const creds = decryptCredentials(key, encryptionKey);
        const apiKey = creds.apiKey as string;
        const config = (key.config ?? {}) as Record<string, unknown>;

        const valid = await testProviderConnection(
          mapConnectionProviderToAiProvider(key.provider),
          apiKey,
          (config.baseUrl as string | null) ?? null,
          (config.authMethod as ProviderKeyAuthMethod) ?? "api_key"
        );

        void updateConnectionLastUsedAt(key.id);

        return successResponse({ valid });
      } catch (error) {
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to test provider key",
          500
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // Codex OAuth Routes
  // -------------------------------------------------------

  // GET /provider-keys/codex/status - Check if Codex OAuth is configured + user connection
  .get("/codex/status", async ({ user }) => {
    try {
      const userId = (user as { id: string }).id;
      const configured = isCodexConfigured();
      const oauthKey = configured
        ? await getOAuthAiKeyByUserAndProvider(userId, "openai")
        : null;

      const config = oauthKey ? (oauthKey.config ?? {}) as Record<string, unknown> : null;

      return successResponse({
        configured,
        connected: !!oauthKey,
        connection: oauthKey
          ? {
              keyPrefix: oauthKey.accountIdentifier,
              scopes: config?.oauthScopes ?? null,
              tokenExpiresAt: oauthKey.tokenExpiresAt,
              createdAt: oauthKey.createdAt,
            }
          : null,
      });
    } catch (error) {
      logger.error(error, "Failed to get Codex OAuth status");
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to get Codex OAuth status",
        500
      );
    }
  })

  // GET /provider-keys/codex/auth-url - Generate OAuth URL with CSRF state param
  .get("/codex/auth-url", async ({ user, set }) => {
    try {
      if (!isCodexConfigured()) {
        set.status = 400;
        return errorResponse(
          "Codex OAuth is not configured (OPENAI_CODEX_CLIENT_ID and OPENAI_CODEX_CLIENT_SECRET required)"
        );
      }

      const userId = (user as { id: string }).id;
      const state = crypto.randomUUID();
      const url = getCodexOAuthUrl(state);

      // Store state in DB for CSRF verification on callback
      await createOAuthState({
        userId,
        provider: "openai",
        state,
        codeVerifier: null,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      });

      // Clean up expired states in the background
      void cleanExpiredOAuthStates().catch(() => {});

      return successResponse({ url, state });
    } catch (error) {
      logger.error(error, "Failed to generate Codex OAuth URL");
      set.status = 500;
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Failed to generate Codex OAuth URL",
        500
      );
    }
  })

  // POST /provider-keys/codex/callback - Exchange code for tokens, encrypt, save
  .post(
    "/codex/callback",
    async ({ body, user, set }) => {
      try {
        if (!isCodexConfigured()) {
          set.status = 400;
          return errorResponse(
            "Codex OAuth is not configured (OPENAI_CODEX_CLIENT_ID and OPENAI_CODEX_CLIENT_SECRET required)"
          );
        }

        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500
          );
        }

        const userId = (user as { id: string }).id;

        // Validate CSRF state against server-stored value
        const storedState = await getOAuthStateByState(body.state);
        if (!storedState) {
          set.status = 400;
          return errorResponse("Invalid or expired OAuth state. Please try again.");
        }

        if (storedState.userId !== userId) {
          set.status = 403;
          return errorResponse("OAuth state does not belong to this user.");
        }

        // Clean up the used state
        await deleteOAuthState(storedState.id);

        // Exchange authorization code for tokens
        const tokenResponse = await exchangeCodexCode(body.code);
        const accessToken = tokenResponse.access_token;

        const keyPrefix = buildKeyPrefix(accessToken);

        // Calculate token expiration
        const tokenExpiresAt = tokenResponse.expires_in
          ? new Date(Date.now() + tokenResponse.expires_in * 1000)
          : null;

        // Remove existing OAuth key for this user+provider if any
        const existingKey = await getOAuthAiKeyByUserAndProvider(
          userId,
          "openai"
        );
        if (existingKey) {
          await deleteAiProviderKey(existingKey.id, userId);
        }

        // Create new provider key with OAuth method
        const result = await createAiProviderKey(
          {
            userId,
            name: "OpenAI Codex (OAuth)",
            provider: "openai",
            apiKey: accessToken,
            keyPrefix,
            baseUrl: null,
            authMethod: "oauth",
            refreshToken: tokenResponse.refresh_token ?? null,
            tokenExpiresAt,
            oauthScopes: tokenResponse.scope ?? null,
          },
          encryptionKey
        );

        logger.info(
          { userId, scopes: tokenResponse.scope ?? "default" },
          "Codex OAuth connection created successfully"
        );

        set.status = 201;
        return successResponse(result);
      } catch (error) {
        logger.error(error, "Failed to process Codex OAuth callback");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to process Codex OAuth callback",
          500
        );
      }
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1 }),
        state: t.String({ minLength: 1 }),
      }),
    }
  )

  // POST /provider-keys/:id/refresh - Force refresh an OAuth token
  .post(
    "/:id/refresh",
    async ({ params, user, set }) => {
      try {
        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse(
            "Encryption key not configured. Set ENCRYPTION_KEY env variable.",
            500
          );
        }

        const userId = (user as { id: string }).id;
        const key = await getAiProviderKeyById(params.id);

        if (!key || key.scopeId !== userId) {
          set.status = 404;
          return notFoundResponse("Provider key");
        }

        const config = (key.config ?? {}) as Record<string, unknown>;
        if (config.authMethod !== "oauth") {
          set.status = 400;
          return errorResponse(
            "Token refresh is only available for OAuth-authenticated keys"
          );
        }

        // Decrypt existing credentials to get refresh token
        const creds = decryptCredentials(key, encryptionKey);
        const refreshTokenValue = creds.refreshToken as string | undefined;

        if (!refreshTokenValue) {
          set.status = 400;
          return errorResponse(
            "No refresh token available for this key. Re-authenticate via OAuth."
          );
        }

        // Use the codex-service to refresh the token
        const tokenData = await refreshCodexToken(refreshTokenValue);

        // Build new credentials blob
        const newCreds: Record<string, unknown> = {
          apiKey: tokenData.access_token,
          authMethod: "oauth",
        };
        if (tokenData.refresh_token) {
          newCreds.refreshToken = tokenData.refresh_token;
        } else {
          newCreds.refreshToken = refreshTokenValue; // keep existing
        }
        if (creds.baseUrl) newCreds.baseUrl = creds.baseUrl;
        if (creds.oauthScopes) newCreds.oauthScopes = creds.oauthScopes;

        const newExpiresAt = tokenData.expires_in
          ? new Date(Date.now() + tokenData.expires_in * 1000)
          : null;

        const updated = await updateAiProviderKeyCredentials(
          key.id,
          { credentials: newCreds, tokenExpiresAt: newExpiresAt },
          encryptionKey
        );

        logger.info(
          { userId, keyId: key.id },
          "Codex OAuth token refreshed successfully"
        );

        return successResponse({
          refreshed: true,
          tokenExpiresAt: newExpiresAt,
          id: updated?.id ?? key.id,
        });
      } catch (error) {
        logger.error(error, "Failed to refresh OAuth token");
        set.status = 500;
        return errorResponse(
          error instanceof Error
            ? error.message
            : "Failed to refresh OAuth token",
          500
        );
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  )

  // -------------------------------------------------------
  // Generic OAuth Routes (supports any registered provider)
  // -------------------------------------------------------

  // GET /provider-keys/oauth/providers - List all supported OAuth providers
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

  // GET /provider-keys/oauth/:provider/status
  .get(
    "/oauth/:provider/status",
    async ({ params, user }) => {
      try {
        const userId = (user as { id: string }).id;
        const config = await getOAuthProvider(params.provider);

        if (!config) {
          return successResponse({
            configured: false,
            connected: false,
            providerName: params.provider,
            manualCodeEntry: false,
            connection: null,
          });
        }

        const oauthKey = await getOAuthAiKeyByUserAndProvider(
          userId,
          params.provider
        );

        const keyConfig = oauthKey ? (oauthKey.config ?? {}) as Record<string, unknown> : null;

        return successResponse({
          configured: true,
          connected: !!oauthKey,
          providerName: config.name,
          manualCodeEntry: config.manualCodeEntry,
          connection: oauthKey
            ? {
                id: oauthKey.id,
                keyPrefix: oauthKey.accountIdentifier,
                scopes: keyConfig?.oauthScopes ?? null,
                tokenExpiresAt: oauthKey.tokenExpiresAt,
                createdAt: oauthKey.createdAt,
              }
            : null,
        });
      } catch (error) {
        logger.error(error, `Failed to get OAuth status for ${params.provider}`);
        return errorResponse(
          error instanceof Error ? error.message : "Failed to get OAuth status",
          500
        );
      }
    },
    { params: t.Object({ provider: t.String() }) }
  )

  // GET /provider-keys/oauth/:provider/auth-url
  .get(
    "/oauth/:provider/auth-url",
    async ({ params, user, set }) => {
      try {
        const config = await getOAuthProvider(params.provider);
        if (!config) {
          set.status = 400;
          return errorResponse(`OAuth not configured for provider: ${params.provider}`);
        }

        const userId = (user as { id: string }).id;
        const state = crypto.randomUUID();

        const result = await generateAuthUrl(config, state);

        // Store state + PKCE verifier in DB for later verification
        await createOAuthState({
          userId,
          provider: params.provider as "anthropic" | "openai" | "google" | "zai" | "xai",
          state,
          codeVerifier: result.pkce?.codeVerifier ?? null,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        });

        // Clean up expired states in the background
        void cleanExpiredOAuthStates().catch(() => {});

        return successResponse({
          url: result.url,
          state,
          manualCodeEntry: config.manualCodeEntry,
        });
      } catch (error) {
        logger.error(error, `Failed to generate OAuth URL for ${params.provider}`);
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to generate OAuth URL",
          500
        );
      }
    },
    { params: t.Object({ provider: t.String() }) }
  )

  // POST /provider-keys/oauth/:provider/callback
  .post(
    "/oauth/:provider/callback",
    async ({ params, body, user, set }) => {
      try {
        const config = await getOAuthProvider(params.provider);
        if (!config) {
          set.status = 400;
          return errorResponse(`OAuth not configured for provider: ${params.provider}`);
        }

        const encryptionKey = env.ENCRYPTION_KEY;
        if (!encryptionKey) {
          set.status = 500;
          return errorResponse("Encryption key not configured. Set ENCRYPTION_KEY env variable.", 500);
        }

        const userId = (user as { id: string }).id;

        const manualCode = config.manualCodeEntry
          ? parseManualOAuthCode(body.code)
          : { code: body.code, state: null };
        const code = manualCode.code;
        let stateToVerify = body.state;

        if (!stateToVerify && manualCode.state) {
          stateToVerify = manualCode.state;
        }

        // Look up the stored state + PKCE verifier
        const storedState = await getOAuthStateByState(stateToVerify);
        if (!storedState) {
          set.status = 400;
          return errorResponse("Invalid or expired OAuth state. Please try again.");
        }

        if (storedState.userId !== userId) {
          set.status = 403;
          return errorResponse("OAuth state does not belong to this user.");
        }

        // Exchange code for tokens
        const tokenResponse = await exchangeCode(
          config,
          code,
          storedState.codeVerifier,
          {
            state: stateToVerify,
          },
        );

        // Clean up the used state
        await deleteOAuthState(storedState.id);

        const accessToken = tokenResponse.access_token;
        const keyPrefix = buildKeyPrefix(accessToken);

        const tokenExpiresAt = tokenResponse.expires_in
          ? new Date(Date.now() + tokenResponse.expires_in * 1000)
          : null;

        // Remove existing OAuth key for this user+provider
        const existingKey = await getOAuthAiKeyByUserAndProvider(userId, params.provider);
        if (existingKey) {
          await deleteAiProviderKey(existingKey.id, userId);
        }

        // Create new provider key with OAuth method
        const result = await createAiProviderKey(
          {
            userId,
            name: `${config.name.charAt(0).toUpperCase() + config.name.slice(1)} (OAuth)`,
            provider: params.provider,
            apiKey: accessToken,
            keyPrefix,
            baseUrl: null,
            authMethod: "oauth",
            refreshToken: tokenResponse.refresh_token ?? null,
            tokenExpiresAt,
            oauthScopes: tokenResponse.scope ?? config.scopes,
          },
          encryptionKey
        );

        logger.info(
          { userId, provider: params.provider, scopes: tokenResponse.scope ?? config.scopes },
          "OAuth connection created successfully"
        );

        set.status = 201;
        return successResponse(result);
      } catch (error) {
        logger.error(error, `Failed to process OAuth callback for ${params.provider}`);
        set.status = 500;
        return errorResponse(
          error instanceof Error ? error.message : "Failed to process OAuth callback",
          500
        );
      }
    },
    {
      params: t.Object({ provider: t.String() }),
      body: t.Object({
        code: t.String({ minLength: 1 }),
        state: t.String(),
      }),
    }
  );
