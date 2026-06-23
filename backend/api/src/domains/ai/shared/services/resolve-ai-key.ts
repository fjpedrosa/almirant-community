import { logger } from "@almirant/config";
import {
  findActiveConnections,
  getOrgSettings,
  decryptCredentials,
  mapAiProviderToConnectionProvider,
} from "@almirant/database";
import type { ProviderConnection } from "@almirant/database";
import { refreshOAuthCredentials } from "../../../connections/services/oauth/token-refresh";
import { createAccountOrchestrator } from "./account-orchestrator";
import type { OrchestrationStrategy } from "./account-orchestrator";
import { quotaService } from "../../../billing/quota/services/quota-service-instance";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AiProvider = "openai" | "anthropic" | "google" | "zai" | "xai";

interface ResolveAiKeyParams {
  provider: AiProvider;
  userId: string | null;
  organizationId: string;
  encryptionKey: string;
  /** When true, only connections with orchestrationEnabled=true are considered. */
  forOrchestration?: boolean;
  /** Connection IDs to exclude from resolution (e.g. rate-limited connections). */
  excludeConnectionIds?: string[];
}

interface SkipReason {
  connectionId: string;
  name: string;
  reason: string;
}

interface ResolvedAiKey {
  connection: ProviderConnection;
  credentials: Record<string, unknown>;
  skipReasons?: SkipReason[];
}

type ConnectionScope = "user" | "organization";

// ---------------------------------------------------------------------------
// Policy -> search order mapping
// ---------------------------------------------------------------------------

const POLICY_SEARCH_ORDER: Record<string, ConnectionScope[]> = {
  org_only: ["organization"],
  org_preferred: ["organization", "user"],
  user_preferred: ["user", "organization"],
  user_only: ["user"],
};

export const refreshConnectionCredentialsIfNeeded = async (
  connection: ProviderConnection,
  encryptionKey: string,
): Promise<Record<string, unknown>> => {
  const result = await refreshOAuthCredentials(connection, encryptionKey);
  return result.credentials;
};

// ---------------------------------------------------------------------------
// resolveAiKey
// ---------------------------------------------------------------------------

/**
 * Resolve the AI key for a given provider, respecting the organization's
 * `aiKeyPolicy` setting.
 *
 * The function:
 * 1. Fetches the org settings to determine the key policy.
 * 2. Maps the AI provider name to the `provider_type` enum value.
 * 3. For each scope in the policy order, fetches ALL active connections
 *    ordered by priority and attempts each one (fallback on quota, token,
 *    or suspension issues).
 * 4. Returns the first usable connection with its decrypted credentials,
 *    or `null` if no active connection is found across all scopes.
 */
export const resolveAiKey = async (
  params: ResolveAiKeyParams,
): Promise<ResolvedAiKey | null> => {
  const { provider, userId, organizationId, encryptionKey, forOrchestration, excludeConnectionIds } = params;
  const skipReasons: SkipReason[] = [];

  // 1. Get the org's AI key policy (defaults to "user_preferred" if no row)
  const orgSettings = await getOrgSettings(organizationId);
  const policy = orgSettings.aiKeyPolicy;

  // 2. Map the AI provider to the connection provider_type enum
  const connectionProvider = mapAiProviderToConnectionProvider(provider);

  // 3. Determine search order from policy
  const scopes: ConnectionScope[] =
    POLICY_SEARCH_ORDER[policy] ?? (() => {
      logger.warn(
        { policy, organizationId },
        "Unknown AI key policy, falling back to user_preferred",
      );
      return POLICY_SEARCH_ORDER.user_preferred as ConnectionScope[];
    })();

  // 4. Search scopes in order, try all connections per scope in priority order
  for (const scope of scopes) {
    if (scope === "user" && !userId) {
      continue;
    }

    const scopeId = scope === "user" ? userId! : organizationId;

    const allConnections = await findActiveConnections(
      connectionProvider,
      scope,
      scopeId,
    );

    // When resolving for orchestration, only consider connections that opted in
    const afterOrchFilter = forOrchestration
      ? allConnections.filter((c) => c.orchestrationEnabled)
      : allConnections;

    // Exclude connections that have been rate-limited / exhausted mid-session
    const excludeSet = excludeConnectionIds && excludeConnectionIds.length > 0
      ? new Set(excludeConnectionIds)
      : null;
    const connections = excludeSet
      ? afterOrchFilter.filter((c) => !excludeSet.has(c.id))
      : afterOrchFilter;

    if (excludeSet && afterOrchFilter.length > connections.length) {
      logger.info(
        {
          provider: connectionProvider,
          scope,
          excludedCount: afterOrchFilter.length - connections.length,
          excludeConnectionIds,
        },
        "Excluded rate-limited connections from resolution",
      );
    }

    if (connections.length === 0) {
      continue;
    }

    // 4.0 When orchestration strategy is configured and we have 2+ orchestration-enabled
    //     connections, delegate to the account orchestrator for intelligent selection.
    const orchestrationStrategy = orgSettings.orchestrationStrategy as OrchestrationStrategy | null;
    if (forOrchestration && orchestrationStrategy && connections.length >= 2) {
      const orchestrator = createAccountOrchestrator(
        orchestrationStrategy,
        (resolvedOrganizationId, resolvedProvider) =>
          quotaService.checkQuotaForProvider(
            resolvedOrganizationId,
            resolvedProvider as AiProvider,
          ),
      );

      const selected = await orchestrator.selectConnection(connections, organizationId);
      if (selected) {
        try {
          const credentials = await refreshConnectionCredentialsIfNeeded(
            selected,
            encryptionKey,
          );

          logger.debug(
            {
              connectionId: selected.id,
              scope,
              provider: connectionProvider,
              strategy: orchestrationStrategy,
            },
            "Resolved AI key via orchestration strategy",
          );

          return {
            connection: selected,
            credentials,
            skipReasons: skipReasons.length > 0 ? skipReasons : undefined,
          };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          skipReasons.push({
            connectionId: selected.id,
            name: selected.name ?? selected.id,
            reason,
          });
          logger.warn(
            { connectionId: selected.id, reason },
            "Orchestrator-selected connection failed credential refresh, falling back to priority order",
          );
          // Fall through to the standard priority-based loop below
        }
      } else {
        logger.warn(
          { scope, provider: connectionProvider, strategy: orchestrationStrategy },
          "Orchestrator found no usable connection, falling back to priority order",
        );
        // Fall through to the standard priority-based loop below
      }
    }

    for (const connection of connections) {
      const connName = connection.name ?? connection.id;

      // 4a. Check if OAuth token is expired and has no refresh token
      if (connection.tokenExpiresAt) {
        const expiresAt = new Date(connection.tokenExpiresAt);
        const bufferMs = 5 * 60 * 1000;
        if (Date.now() + bufferMs >= expiresAt.getTime()) {
          // Token is expired or about to expire — check if refresh is possible
          // We'll let refreshConnectionCredentialsIfNeeded handle the actual
          // refresh, but pre-check for the no-refresh-token case to avoid
          // deactivating connections during resolution scanning.
          const config = (connection.config ?? {}) as Record<string, unknown>;
          const authMethod =
            (typeof config.authMethod === "string" ? config.authMethod : undefined) ?? "api_key";
          if (authMethod === "oauth") {
            // OAuth connection with expired token — attempt refresh below
            // (refreshConnectionCredentialsIfNeeded will handle it)
          }
        }
      }

      // 4b. Try OAuth refresh and credential decryption
      try {
        const credentials = await refreshConnectionCredentialsIfNeeded(
          connection,
          encryptionKey,
        );

        logger.debug(
          {
            connectionId: connection.id,
            scope,
            provider: connectionProvider,
            policy,
            skippedCount: skipReasons.length,
          },
          "Resolved AI key via policy",
        );

        return {
          connection,
          credentials,
          skipReasons: skipReasons.length > 0 ? skipReasons : undefined,
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        skipReasons.push({
          connectionId: connection.id,
          name: connName,
          reason,
        });

        logger.info(
          {
            connectionId: connection.id,
            connectionName: connName,
            scope,
            reason,
          },
          `Skipping connection ${connName} (${connection.id}): ${reason}`,
        );
      }
    }

    // All connections in this scope failed
    logger.warn(
      {
        scope,
        provider: connectionProvider,
        organizationId,
        connectionCount: connections.length,
        skipReasons: skipReasons.filter((r) => r.connectionId),
      },
      `All ${connections.length} connection(s) failed for scope "${scope}" — moving to next scope`,
    );
  }

  logger.error(
    {
      provider,
      userId,
      organizationId,
      policy,
      skipReasons,
    },
    "No usable AI connection found across all scopes in policy order",
  );

  return null;
};
