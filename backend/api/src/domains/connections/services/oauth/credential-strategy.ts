/**
 * Credential Strategy pattern for OAuth token refresh.
 *
 * Decouples refreshOAuthCredentials() from AI-specific repository functions
 * so it works for any connection type (AI, code, deployment).
 */

import type { ProviderConnection } from "@almirant/database";
import {
  getAiProviderKeyById,
  updateAiProviderKeyCredentials,
  getConnectionById,
  updateConnectionEncryptedCredentials,
} from "@almirant/database";
import type { OAuthTokenResponse } from "./types";
import { exchangeIdTokenForApiKey } from "./openai-token-exchange";

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

export interface CredentialStrategy {
  /** Re-read connection from DB to check if another caller already refreshed */
  getConnection: (id: string) => Promise<ProviderConnection | null>;
  /** Persist refreshed credentials atomically */
  updateCredentials: (
    id: string,
    data: { credentials: Record<string, unknown>; tokenExpiresAt: Date | null },
    encryptionKey: string,
  ) => Promise<void>;
  /** Optional post-processing after token exchange (e.g. OpenAI id_token → API key) */
  postRefresh?: (
    tokenResponse: OAuthTokenResponse,
    currentCreds: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// AI credential strategy (existing behavior, zero changes)
// ---------------------------------------------------------------------------

export const aiCredentialStrategy: CredentialStrategy = {
  getConnection: async (id) => {
    return getAiProviderKeyById(id);
  },

  updateCredentials: async (id, data, encryptionKey) => {
    await updateAiProviderKeyCredentials(id, data, encryptionKey);
  },

  postRefresh: async (tokenResponse, currentCreds) => {
    // OpenAI OAuth: exchange id_token for API key
    const idToken =
      (tokenResponse as unknown as Record<string, unknown>).id_token as string | undefined
      ?? (currentCreds.idToken as string | undefined);

    const provider = currentCreds._provider as string | undefined;

    if (provider === "openai" && idToken) {
      const exchanged = await exchangeIdTokenForApiKey(idToken);
      if (exchanged) {
        return {
          ...currentCreds,
          apiKey: exchanged,
          oauthAccessToken: tokenResponse.access_token,
          idToken: (tokenResponse as unknown as Record<string, unknown>).id_token ?? idToken,
        };
      }
    }

    return currentCreds;
  },
};

// ---------------------------------------------------------------------------
// Default credential strategy (GitHub, Vercel, etc.)
// ---------------------------------------------------------------------------

export const defaultCredentialStrategy: CredentialStrategy = {
  getConnection: async (id) => {
    return getConnectionById(id) as Promise<ProviderConnection | null>;
  },

  updateCredentials: async (id, data, encryptionKey) => {
    await updateConnectionEncryptedCredentials(id, data, encryptionKey);
  },

  // No post-refresh needed for code/deployment connections
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getCredentialStrategy = (
  connection: ProviderConnection,
): CredentialStrategy => {
  if (connection.category === "ai") return aiCredentialStrategy;
  return defaultCredentialStrategy;
};
