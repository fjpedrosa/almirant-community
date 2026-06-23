/**
 * Centralized OAuth token refresh with per-connection mutex.
 *
 * Uses the CredentialStrategy pattern to support any connection type
 * (AI, code, deployment) without hardcoded provider-specific logic.
 */

import { logger } from "@almirant/config";
import {
  decryptCredentials,
} from "@almirant/database";
import type { ProviderConnection } from "@almirant/database";
import {
  getOAuthProvider,
  refreshToken as refreshOAuthToken,
} from "./index";
import { getCredentialStrategy } from "./credential-strategy";
import { resolveEffectiveOAuthTokenExpiresAt } from "./oauth-credential-helpers";

// ---------------------------------------------------------------------------
// Per-connection mutex
// ---------------------------------------------------------------------------

const locks = new Map<string, Promise<void>>();

const withLock = async <T>(connectionId: string, fn: () => Promise<T>): Promise<T> => {
  while (locks.has(connectionId)) {
    await locks.get(connectionId);
  }

  let resolve: () => void;
  const lockPromise = new Promise<void>((r) => { resolve = r; });
  locks.set(connectionId, lockPromise);

  try {
    return await fn();
  } finally {
    locks.delete(connectionId);
    resolve!();
  }
};

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RefreshResult {
  credentials: Record<string, unknown>;
  /** true if a refresh was actually performed (not just re-read) */
  refreshed: boolean;
}

// ---------------------------------------------------------------------------
// refreshOAuthCredentials — strategy-driven
// ---------------------------------------------------------------------------

/**
 * Refresh OAuth credentials for a connection, with mutex protection.
 *
 * - If the token is not yet expired, returns current credentials.
 * - If another caller already refreshed it, returns the fresh credentials.
 * - If refresh fails, returns existing credentials as-is (no deactivation).
 *
 * Works for any connection type via the CredentialStrategy pattern.
 */
export const refreshOAuthCredentials = async (
  connection: ProviderConnection,
  encryptionKey: string,
): Promise<RefreshResult> => {
  const config = (connection.config ?? {}) as Record<string, unknown>;
  const authMethod = (config.authMethod as string) ?? "api_key";
  const currentCredentials = decryptCredentials(connection, encryptionKey);

  // Not an OAuth connection — just decrypt and return
  if (authMethod !== "oauth") {
    return {
      credentials: currentCredentials,
      refreshed: false,
    };
  }

  const bufferMs = 5 * 60 * 1000; // 5 minutes
  const expiresAt = resolveEffectiveOAuthTokenExpiresAt({
    tokenExpiresAt: connection.tokenExpiresAt,
    credentials: currentCredentials,
  });

  // No reliable expiry available or token not expired yet — return current credentials
  if (!expiresAt || Date.now() + bufferMs < expiresAt.getTime()) {
    return {
      credentials: currentCredentials,
      refreshed: false,
    };
  }

  const strategy = getCredentialStrategy(connection);

  // Token expired or about to expire — acquire lock and refresh
  return withLock(connection.id, async () => {
    // Re-read from DB — another caller may have already refreshed
    const freshRow = await strategy.getConnection(connection.id);
    if (!freshRow) {
      return {
        credentials: currentCredentials,
        refreshed: false,
      };
    }

    const freshCreds = decryptCredentials(freshRow, encryptionKey);

    // Check if it was already refreshed by another caller
    const freshExpiresAt = resolveEffectiveOAuthTokenExpiresAt({
      tokenExpiresAt: freshRow.tokenExpiresAt,
      credentials: freshCreds,
    });
    if (freshExpiresAt && Date.now() + bufferMs < freshExpiresAt.getTime()) {
      logger.info(
        { connectionId: connection.id },
        "OAuth token already refreshed by another caller",
      );
      return {
        credentials: freshCreds,
        refreshed: false,
      };
    }

    // Still expired — perform the refresh
    const creds = freshCreds;
    const refreshTokenValue = creds.refreshToken as string | undefined;

    if (!refreshTokenValue) {
      logger.warn(
        { connectionId: connection.id, provider: connection.provider },
        "OAuth token expired but no refresh token — returning credentials as-is",
      );
      return { credentials: creds, refreshed: false };
    }

    // Resolve OAuth config by provider name
    const providerName = connection.provider;
    const oauthConfig = await getOAuthProvider(providerName);
    if (!oauthConfig) {
      logger.warn(
        { connectionId: connection.id, provider: connection.provider },
        "No OAuth config for provider — returning credentials as-is",
      );
      return { credentials: creds, refreshed: false };
    }

    try {
      const tokenResponse = await refreshOAuthToken(oauthConfig, refreshTokenValue);

      // Build new credentials
      let newCreds: Record<string, unknown> = {
        ...creds,
        apiKey: tokenResponse.access_token,
        authMethod: "oauth",
        refreshToken: tokenResponse.refresh_token ?? refreshTokenValue,
      };

      if (tokenResponse.scope) {
        newCreds.oauthScopes = tokenResponse.scope;
      }

      // Provider-specific post-processing (e.g. OpenAI id_token exchange)
      if (strategy.postRefresh) {
        newCreds._provider = providerName;
        newCreds = await strategy.postRefresh(tokenResponse, newCreds);
        delete newCreds._provider;
      }

      const newExpiresAt = tokenResponse.expires_in
        ? new Date(Date.now() + tokenResponse.expires_in * 1000)
        : null;

      // Persist atomically
      await strategy.updateCredentials(
        connection.id,
        { credentials: newCreds, tokenExpiresAt: newExpiresAt },
        encryptionKey,
      );

      logger.info(
        {
          connectionId: connection.id,
          provider: connection.provider,
          newExpiresAt: newExpiresAt?.toISOString() ?? null,
        },
        "OAuth token refreshed successfully",
      );

      return { credentials: newCreds, refreshed: true };
    } catch (error) {
      logger.warn(
        {
          connectionId: connection.id,
          provider: connection.provider,
          error: error instanceof Error ? error.message : String(error),
        },
        "OAuth token refresh failed — returning existing credentials as-is",
      );
      return { credentials: creds, refreshed: false };
    }
  });
};
