import { logger } from "@almirant/config";
import type { ProviderConnection } from "@almirant/database";
import type { QuotaAvailability } from "@almirant/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrchestrationStrategy = "round_robin" | "sequential" | "reset_first";

/**
 * The result of checking quota availability for a specific connection.
 * Extends QuotaAvailability with the connection reference.
 */
interface ConnectionQuotaInfo {
  connection: ProviderConnection;
  quota: QuotaAvailability;
}

/**
 * A function that checks quota availability for a provider in a workspace.
 * This matches the QuotaService.checkQuotaForProvider signature so we can
 * reuse the cached quota data without extra DB queries.
 */
type CheckQuotaFn = (
  workspaceId: string,
  provider: string,
) => Promise<QuotaAvailability>;

/**
 * Strategy interface for account selection. Each strategy implementation
 * receives the candidate connections (already filtered to orchestrationEnabled
 * + isActive) and selects the optimal one.
 *
 * Designed for extensibility: A-1162 (SequentialStrategy) and A-1163
 * (ResetFirstStrategy) can be added by implementing this interface.
 */
interface AccountStrategy {
  /**
   * Select the optimal connection from the given candidates.
   *
   * @param connections - Active, orchestration-enabled connections (pre-filtered)
   * @param workspaceId - The workspace ID for quota lookups
   * @param checkQuota - Quota checker function (uses cached data from QuotaService)
   * @returns The selected connection, or null if none are usable
   */
  selectAccount(
    connections: ProviderConnection[],
    workspaceId: string,
    checkQuota: CheckQuotaFn,
  ): Promise<ProviderConnection | null>;
}

// ---------------------------------------------------------------------------
// Round-Robin Strategy (balanced by quota consumption)
// ---------------------------------------------------------------------------

/**
 * Selects the connection with the lowest quota consumption percentage.
 * If a connection's quota is at 100%, it is automatically skipped.
 *
 * When no quota is configured (allowed=true, remaining has no upper bound),
 * falls back to least-recently-used ordering via `lastUsedAt`.
 */
const roundRobinStrategy: AccountStrategy = {
  async selectAccount(
    connections: ProviderConnection[],
    workspaceId: string,
    checkQuota: CheckQuotaFn,
  ): Promise<ProviderConnection | null> {
    if (connections.length === 0) return null;
    if (connections.length === 1) {
      // Single connection: just check if it's allowed
      const quota = await checkQuota(
        workspaceId,
        mapConnectionProviderToAiProvider(connections[0]!.provider),
      );
      return quota.allowed ? connections[0]! : null;
    }

    // Build quota info for all connections
    const infos: ConnectionQuotaInfo[] = [];
    for (const connection of connections) {
      const aiProvider = mapConnectionProviderToAiProvider(connection.provider);
      const quota = await checkQuota(workspaceId, aiProvider);

      if (!quota.allowed) {
        logger.debug(
          { connectionId: connection.id, reason: quota.reason },
          "account-orchestrator: skipping connection (quota exhausted)",
        );
        continue;
      }

      infos.push({ connection, quota });
    }

    if (infos.length === 0) {
      logger.warn(
        { workspaceId, connectionCount: connections.length },
        "account-orchestrator: all connections exhausted, no usable account",
      );
      return null;
    }

    // Sort by consumption: prefer the connection with the most remaining quota.
    // When remaining values exist, higher remaining = less consumed = preferred.
    // When remaining is null (no limit configured), use lastUsedAt as tiebreaker.
    infos.sort((a, b) => {
      const aRemaining = computeRemainingScore(a.quota);
      const bRemaining = computeRemainingScore(b.quota);

      // Higher remaining score = less consumed = should come first
      if (aRemaining !== bRemaining) return bRemaining - aRemaining;

      // Tiebreaker: least recently used first (null lastUsedAt = never used = preferred)
      const aUsedAt = a.connection.lastUsedAt?.getTime() ?? 0;
      const bUsedAt = b.connection.lastUsedAt?.getTime() ?? 0;
      return aUsedAt - bUsedAt;
    });

    const selected = infos[0]!.connection;
    logger.debug(
      {
        selectedId: selected.id,
        selectedName: selected.name,
        candidateCount: infos.length,
        totalConnections: connections.length,
      },
      "account-orchestrator: round-robin selected connection",
    );

    return selected;
  },
};

// ---------------------------------------------------------------------------
// Sequential Strategy (priority-based with fallback)
// ---------------------------------------------------------------------------

/**
 * Uses the highest-priority connection (lowest `priority` number) until its
 * quota is exhausted, then falls back to the next connection in priority order.
 *
 * Connections are expected to arrive already sorted by priority, but we
 * re-sort defensively. When a connection is skipped due to quota exhaustion,
 * the fallback is logged so operators can track account switching.
 */
const sequentialStrategy: AccountStrategy = {
  async selectAccount(
    connections: ProviderConnection[],
    workspaceId: string,
    checkQuota: CheckQuotaFn,
  ): Promise<ProviderConnection | null> {
    if (connections.length === 0) return null;

    // Ensure connections are ordered by priority (lowest number = highest priority)
    const sorted = [...connections].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
    );

    for (const connection of sorted) {
      const aiProvider = mapConnectionProviderToAiProvider(connection.provider);
      const quota = await checkQuota(workspaceId, aiProvider);

      if (quota.allowed) {
        logger.debug(
          {
            selectedId: connection.id,
            selectedName: connection.name,
            priority: connection.priority,
            totalConnections: sorted.length,
          },
          "account-orchestrator: sequential selected connection",
        );
        return connection;
      }

      // Connection exhausted — log and fall through to the next one
      logger.info(
        {
          connectionId: connection.id,
          connectionName: connection.name,
          priority: connection.priority,
          reason: quota.reason,
        },
        "account-orchestrator: sequential skipping exhausted connection, falling back to next",
      );
    }

    logger.warn(
      { workspaceId, connectionCount: sorted.length },
      "account-orchestrator: sequential strategy exhausted all connections, no usable account",
    );
    return null;
  },
};

// ---------------------------------------------------------------------------
// Reset-First Strategy (maximize usage before quota resets)
// ---------------------------------------------------------------------------

/**
 * Prioritizes connections with the HIGHEST quota consumption so their
 * remaining tokens/cost/requests are used up before the period resets.
 *
 * Since quotas are at the org+provider level (not per-connection), all
 * connections sharing the same provider share the same quota. The strategy
 * picks the connection whose quota is closest to exhaustion (lowest
 * remaining score), maximizing utilisation before the reset window closes.
 *
 * Tiebreaker: most recently used connection, to maintain a consistent
 * usage pattern within the same period.
 *
 * Works regardless of the quota period type (daily, weekly, monthly)
 * because the selection is driven by remaining headroom, not by calendar
 * arithmetic.
 */
const resetFirstStrategy: AccountStrategy = {
  async selectAccount(
    connections: ProviderConnection[],
    workspaceId: string,
    checkQuota: CheckQuotaFn,
  ): Promise<ProviderConnection | null> {
    if (connections.length === 0) return null;

    // Build quota info for all connections, keep only those with quota remaining
    const infos: ConnectionQuotaInfo[] = [];
    for (const connection of connections) {
      const aiProvider = mapConnectionProviderToAiProvider(connection.provider);
      const quota = await checkQuota(workspaceId, aiProvider);

      if (!quota.allowed) {
        logger.debug(
          { connectionId: connection.id, reason: quota.reason },
          "account-orchestrator: reset-first skipping connection (quota exhausted)",
        );
        continue;
      }

      infos.push({ connection, quota });
    }

    if (infos.length === 0) {
      logger.warn(
        { workspaceId, connectionCount: connections.length },
        "account-orchestrator: reset-first all connections exhausted, no usable account",
      );
      return null;
    }

    // Sort by consumption: prefer the connection with the LEAST remaining quota
    // (most consumed). This ensures we "use up" the allocation before reset.
    infos.sort((a, b) => {
      const aRemaining = computeRemainingScore(a.quota);
      const bRemaining = computeRemainingScore(b.quota);

      // Lower remaining score = more consumed = should come first
      if (aRemaining !== bRemaining) return aRemaining - bRemaining;

      // Tiebreaker: most recently used first (to keep consistent usage pattern)
      // null lastUsedAt = never used = deprioritised (send to end)
      const aUsedAt = a.connection.lastUsedAt?.getTime() ?? 0;
      const bUsedAt = b.connection.lastUsedAt?.getTime() ?? 0;
      return bUsedAt - aUsedAt;
    });

    const selected = infos[0]!.connection;
    logger.debug(
      {
        selectedId: selected.id,
        selectedName: selected.name,
        candidateCount: infos.length,
        totalConnections: connections.length,
      },
      "account-orchestrator: reset-first selected connection (highest consumption)",
    );

    return selected;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a numeric "remaining" score from quota availability.
 *
 * Uses the raw remaining values (tokens, costUsd, requests) from the
 * QuotaAvailability object. Higher score = more headroom = less consumed.
 *
 * Since different dimensions have different scales, we normalize by
 * taking the minimum remaining value across dimensions. This ensures
 * the most constrained dimension drives selection (bottleneck approach).
 *
 * When no limits are configured (remaining is undefined or all fields
 * are null), returns Infinity so unlimited connections are always preferred.
 */
const computeRemainingScore = (quota: QuotaAvailability): number => {
  const remaining = quota.remaining;
  if (!remaining) return Infinity;

  const scores: number[] = [];

  // Use remaining values directly for comparison.
  // Connections with higher remaining values are less consumed.
  if (remaining.tokens !== undefined && remaining.tokens !== null) {
    scores.push(remaining.tokens);
  }
  if (remaining.costUsd !== undefined && remaining.costUsd !== null) {
    // Scale cost to a comparable range (multiply by a large factor
    // since cost values are typically small decimals)
    scores.push(remaining.costUsd * 1_000_000);
  }
  if (remaining.requests !== undefined && remaining.requests !== null) {
    scores.push(remaining.requests);
  }

  if (scores.length === 0) return Infinity;

  // Return the minimum remaining value — the bottleneck dimension
  return Math.min(...scores);
};

/**
 * Map provider_type enum back to the ai_provider format.
 * Duplicated here to avoid circular dependency with connection-repository.
 */
const mapConnectionProviderToAiProvider = (
  provider: ProviderConnection["provider"],
): string => {
  return provider;
};

// ---------------------------------------------------------------------------
// Strategy registry
// ---------------------------------------------------------------------------

const STRATEGIES: Record<string, AccountStrategy> = {
  round_robin: roundRobinStrategy,
  sequential: sequentialStrategy,
  reset_first: resetFirstStrategy,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface AccountOrchestrator {
  /**
   * Select the optimal connection using the configured strategy.
   *
   * @param connections - Pre-filtered connections (orchestrationEnabled=true, isActive=true)
   * @param workspaceId - Workspace ID for quota lookups
   * @returns The selected connection, or null if none are usable
   */
  selectConnection(
    connections: ProviderConnection[],
    workspaceId: string,
  ): Promise<ProviderConnection | null>;

  /**
   * Select the next available connection, excluding a specific connection
   * (e.g. one that was just rate-limited). Used for mid-session hot-swap.
   *
   * @param connections - Pre-filtered connections (orchestrationEnabled=true, isActive=true)
   * @param workspaceId - Workspace ID for quota lookups
   * @param excludeConnectionId - The connection ID to exclude from selection
   * @returns The next available connection, or null if none remain
   */
  getNextAvailable(
    connections: ProviderConnection[],
    workspaceId: string,
    excludeConnectionId: string,
  ): Promise<ProviderConnection | null>;
}

/**
 * Create an account orchestrator for the given strategy.
 *
 * @param strategyName - The orchestration strategy to use
 * @param checkQuota - Quota check function from the QuotaService (uses cached data)
 * @returns An AccountOrchestrator instance
 */
export const createAccountOrchestrator = (
  strategyName: OrchestrationStrategy,
  checkQuota: CheckQuotaFn,
): AccountOrchestrator => {
  const strategy = STRATEGIES[strategyName];
  if (!strategy) {
    logger.warn(
      { strategyName },
      "account-orchestrator: unknown strategy, falling back to round_robin",
    );
  }
  const activeStrategy = strategy ?? roundRobinStrategy;

  return {
    selectConnection: (connections, workspaceId) =>
      activeStrategy.selectAccount(connections, workspaceId, checkQuota),

    getNextAvailable: (connections, workspaceId, excludeConnectionId) => {
      const filtered = connections.filter((c) => c.id !== excludeConnectionId);
      if (filtered.length === 0) {
        logger.warn(
          { workspaceId, excludeConnectionId, totalConnections: connections.length },
          "account-orchestrator: no alternative connections available after excluding rate-limited connection",
        );
        return Promise.resolve(null);
      }
      logger.info(
        { excludeConnectionId, remainingCount: filtered.length },
        "account-orchestrator: selecting next available connection (hot-swap)",
      );
      return activeStrategy.selectAccount(filtered, workspaceId, checkQuota);
    },
  };
};

// Export types for future strategy implementations
export type { AccountStrategy, CheckQuotaFn, OrchestrationStrategy, AccountOrchestrator };
