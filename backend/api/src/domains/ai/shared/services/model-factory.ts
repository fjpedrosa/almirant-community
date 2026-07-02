import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { env, logger } from "@almirant/config";
import {
  getAiProviderKeyById,
  updateConnectionLastUsedAt,
  updateConnectionValidation,
  decryptCredentials,
  encryptCredentials,
  mapConnectionProviderToAiProvider,
} from "@almirant/database";
import type { ProviderConnection } from "@almirant/database";
import {
  isAnthropicSetupToken,
  getStealthHeaders,
} from "../../../connections/services/oauth";
import { refreshOAuthCredentials } from "../../../connections/services/oauth/token-refresh";
import { resolveAiKey } from "./resolve-ai-key";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AiProvider = "openai" | "anthropic" | "google" | "zai" | "xai";

interface CreateModelConfig {
  provider: AiProvider;
  apiKey: string;
  modelName?: string;
  baseUrl?: string;
  streaming?: boolean;
}

export interface ResolvedModel {
  model: BaseChatModel;
  connectionId: string;
}

// ---------------------------------------------------------------------------
// isAuthError - detect 401/403 / auth-related errors from AI providers
// ---------------------------------------------------------------------------

const AUTH_ERROR_PATTERNS = [
  "401",
  "403",
  "unauthorized",
  "authentication_error",
  "invalid_api_key",
  "invalid_x_api_key",
  "invalid api key",
  "permission denied",
  "forbidden",
  "api key not valid",
  "incorrect api key",
  "invalid x-api-key",
  "could not resolve api key",
] as const;

export const isAuthError = (error: unknown): boolean => {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (AUTH_ERROR_PATTERNS.some((p) => msg.includes(p))) return true;
  }

  // LangChain and provider SDKs may attach status/statusCode on the error object
  const errObj = error as Record<string, unknown>;
  if (errObj?.status === 401 || errObj?.status === 403) return true;
  if (errObj?.statusCode === 401 || errObj?.statusCode === 403) return true;

  return false;
};

// ---------------------------------------------------------------------------
// withAuthErrorDetection - wraps an async fn to detect auth errors and
// suspend the connection, or mark it valid on success (fire-and-forget).
// ---------------------------------------------------------------------------

export const withAuthErrorDetection = async <T>(
  connectionId: string,
  fn: () => Promise<T>,
): Promise<T> => {
  try {
    const result = await fn();

    // Fire-and-forget: mark connection as valid on successful AI operation
    void updateConnectionValidation(connectionId, "valid").catch(
      (err: unknown) => {
        logger.warn(
          { connectionId, error: err },
          "Failed to update validation status on success",
        );
      },
    );

    return result;
  } catch (error) {
    if (isAuthError(error)) {
      logger.warn(
        { connectionId, error },
        "Auth error detected from AI provider, suspending connection",
      );
      void updateConnectionValidation(
        connectionId,
        "invalid",
        error instanceof Error ? error.message : "Authentication failed",
      ).catch((err: unknown) => {
        logger.warn(
          { connectionId, error: err },
          "Failed to suspend connection after auth error",
        );
      });
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// createModel - builds a LangChain chat model from explicit config
// ---------------------------------------------------------------------------

export const createModel = (config: CreateModelConfig): BaseChatModel => {
  const { provider, apiKey, modelName, baseUrl, streaming } = config;

  switch (provider) {
    case "openai":
      return new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName,
        streaming,
      });

    case "anthropic": {
      const authMethod = isAnthropicSetupToken(apiKey)
        ? "setup_token"
        : "api_key";
      const headers = getStealthHeaders("anthropic", authMethod);
      if (headers) {
        return new ChatAnthropic({
          anthropicApiKey: "placeholder",
          modelName,
          streaming,
          clientOptions: {
            defaultHeaders: headers,
            authToken: apiKey,
          },
        });
      }
      return new ChatAnthropic({
        anthropicApiKey: apiKey,
        modelName,
        streaming,
      });
    }

    case "google":
      // Google Gemini exposes an OpenAI-compatible endpoint
      return new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName,
        streaming,
        configuration: {
          baseURL:
            "https://generativelanguage.googleapis.com/v1beta/openai",
        },
      });

    case "zai": {
      const zaiBaseUrl = baseUrl ?? "https://api.z.ai/api/coding/paas/v4";
      return new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName,
        streaming,
        configuration: { baseURL: zaiBaseUrl },
      });
    }

    case "xai": {
      const xaiBaseUrl = baseUrl ?? "https://api.x.ai/v1";
      return new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName,
        streaming,
        configuration: { baseURL: xaiBaseUrl },
      });
    }

    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
  }
};

// ---------------------------------------------------------------------------
// refreshOAuthIfNeeded - shared OAuth token refresh logic
// ---------------------------------------------------------------------------

/**
 * If the connection uses OAuth and the token is expired or about to expire
 * (within 5 minutes), refreshes the token and persists the new credentials.
 *
 * Returns the up-to-date credentials object (either refreshed or the ones
 * passed in as `preDecryptedCreds`). If no pre-decrypted credentials are
 * provided, the function decrypts them from the connection row.
 */
const refreshOAuthIfNeeded = async (
  row: ProviderConnection,
  encryptionKey: string,
  preDecryptedCreds?: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const authMethod = (config.authMethod as string) ?? "api_key";

  if (authMethod !== "oauth" || !row.tokenExpiresAt) {
    return preDecryptedCreds ?? decryptCredentials(row, encryptionKey);
  }

  const result = await refreshOAuthCredentials(row, encryptionKey);
  return result.credentials;
};

// ---------------------------------------------------------------------------
// buildModelFromConnection - build a LangChain model from a connection row
// ---------------------------------------------------------------------------

/**
 * Given a ProviderConnection row (with encrypted credentials) and an
 * encryption key, handles OAuth refresh if needed, decrypts credentials,
 * builds the LangChain model, and touches `lastUsedAt`.
 *
 * If `preDecryptedCreds` is provided (e.g. from `resolveAiKey`), skips the
 * initial decryption step but still checks for OAuth refresh.
 */
const buildModelFromConnection = async (
  row: ProviderConnection,
  encryptionKey: string,
  options?: { modelName?: string; streaming?: boolean },
  preDecryptedCreds?: Record<string, unknown>,
): Promise<ResolvedModel> => {
  const config = (row.config ?? {}) as Record<string, unknown>;

  const resolvedCreds = await refreshOAuthIfNeeded(row, encryptionKey, preDecryptedCreds);

  const apiKey = resolvedCreds.apiKey as string;
  const legacyProvider = mapConnectionProviderToAiProvider(row.provider) as AiProvider;

  const model = createModel({
    provider: legacyProvider,
    apiKey,
    modelName: options?.modelName,
    streaming: options?.streaming,
    baseUrl: (config.baseUrl as string | undefined) ?? undefined,
  });

  // Fire-and-forget: update lastUsedAt without blocking the caller
  void updateConnectionLastUsedAt(row.id).catch((err: unknown) => {
    logger.warn(
      { keyId: row.id, error: err },
      "Failed to update lastUsedAt for provider API key",
    );
  });

  return { model, connectionId: row.id };
};

// ---------------------------------------------------------------------------
// resolveModelFromProviderKey - decrypt stored key, build model, touch lastUsedAt
// ---------------------------------------------------------------------------

export const resolveModelFromProviderKey = async (
  keyId: string,
  options?: { modelName?: string; streaming?: boolean },
): Promise<ResolvedModel> => {
  if (!env.ENCRYPTION_KEY) {
    throw new Error(
      "ENCRYPTION_KEY is not configured. Cannot decrypt provider API keys.",
    );
  }

  const row = await getAiProviderKeyById(keyId);

  if (!row) {
    throw new Error(`Provider API key not found or inactive: ${keyId}`);
  }

  return buildModelFromConnection(row, env.ENCRYPTION_KEY, options);
};

// ---------------------------------------------------------------------------
// resolveModelByPolicy - resolve AI key by org policy, build model
// ---------------------------------------------------------------------------

/**
 * Resolve an AI model using the workspace's key policy.
 *
 * 1. Uses `resolveAiKey` to find the correct connection based on the org's
 *    `aiKeyPolicy` (org_only, org_preferred, user_preferred, user_only).
 * 2. Handles OAuth refresh and credential decryption.
 * 3. Builds and returns the LangChain model.
 *
 * Returns `null` if no active key is found for the given provider in any
 * scope allowed by the policy.
 */
export const resolveModelByPolicy = async (params: {
  provider: "openai" | "anthropic" | "google" | "zai" | "xai";
  userId: string;
  workspaceId: string;
  modelName?: string;
  streaming?: boolean;
}): Promise<ResolvedModel | null> => {
  if (!env.ENCRYPTION_KEY) {
    throw new Error(
      "ENCRYPTION_KEY is not configured. Cannot decrypt provider API keys.",
    );
  }

  const resolved = await resolveAiKey({
    provider: params.provider,
    userId: params.userId,
    workspaceId: params.workspaceId,
    encryptionKey: env.ENCRYPTION_KEY,
  });

  if (!resolved) {
    return null;
  }

  return buildModelFromConnection(
    resolved.connection,
    env.ENCRYPTION_KEY,
    { modelName: params.modelName, streaming: params.streaming },
    resolved.credentials,
  );
};

// ---------------------------------------------------------------------------
// getDefaultModel - fallback using env.OPENAI_API_KEY
// ---------------------------------------------------------------------------

export const getDefaultModel = (streaming = false): ChatOpenAI => {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Set it in the environment or use a provider API key."
    );
  }

  return new ChatOpenAI({
    openAIApiKey: env.OPENAI_API_KEY,
    modelName: env.OPENAI_MODEL,
    streaming,
  });
};
