import { PostHog } from "posthog-node";
import { env, logger } from "@almirant/config";

let client: PostHog | null = null;

const getClient = (): PostHog | null => {
  if (!env.POSTHOG_API_KEY) return null;
  if (!client) {
    client = new PostHog(env.POSTHOG_API_KEY, {
      host: env.POSTHOG_HOST,
      flushAt: 10,
      flushInterval: 5000,
      // When a personal API key is present, posthog-node can evaluate feature flags
      // locally (no remote round-trip per check). Without it, getFeatureFlag falls
      // back to a remote call (~200ms).
      ...(env.POSTHOG_PERSONAL_API_KEY
        ? {
            personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
            featureFlagsPollingInterval: 30_000,
          }
        : {}),
    });
  }
  return client;
};

// ─── Feature flag evaluation (fail-closed + 30s in-memory cache) ──────────────
type FlagCacheEntry = { value: boolean; expiresAt: number };
const flagCache = new Map<string, FlagCacheEntry>();
const FLAG_CACHE_TTL_MS = 30_000;
const DEFAULT_FLAG_TIMEOUT_MS = 500;

interface FeatureFlagOptions {
  groups?: Record<string, string>;
  timeoutMs?: number;
}

const buildFlagCacheKey = (
  flagKey: string,
  distinctId: string,
  groups: Record<string, string> | undefined
): string => `${flagKey}::${distinctId}::${JSON.stringify(groups ?? {})}`;

/**
 * Server-side feature flag check with fail-closed semantics.
 *
 * - Returns `false` if PostHog is not configured or the SDK throws/times out.
 * - Caches the result (including `false` on failure) for 30s per (flagKey, distinctId, groups).
 *   Caching failures prevents hammering PostHog during outages.
 * - Timeout defaults to 500ms; callers on the hot path should pass a shorter value if needed.
 */
export const isFeatureFlagEnabled = async (
  flagKey: string,
  distinctId: string,
  options: FeatureFlagOptions = {}
): Promise<boolean> => {
  const key = buildFlagCacheKey(flagKey, distinctId, options.groups);
  const now = Date.now();
  const cached = flagCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const ph = getClient();
  if (!ph) return false;

  const timeoutMs = options.timeoutMs ?? DEFAULT_FLAG_TIMEOUT_MS;

  try {
    const flagResult = await Promise.race<boolean>([
      Promise.resolve(ph.getFeatureFlag(flagKey, distinctId, { groups: options.groups })).then(
        (v) => v === true
      ),
      new Promise<boolean>((_, reject) =>
        setTimeout(
          () => reject(new Error("posthog feature flag timeout")),
          timeoutMs
        )
      ),
    ]);
    flagCache.set(key, { value: flagResult, expiresAt: now + FLAG_CACHE_TTL_MS });
    return flagResult;
  } catch (error) {
    logger.warn(
      { error, flagKey, distinctId },
      "PostHog feature flag check failed (fail-closed)"
    );
    flagCache.set(key, { value: false, expiresAt: now + FLAG_CACHE_TTL_MS });
    return false;
  }
};

/**
 * Invalidate cached feature flag decisions. With no args, clears everything.
 * Useful after admin config changes or in tests.
 */
export const invalidateFeatureFlagCache = (
  flagKey?: string,
  distinctId?: string
): void => {
  if (!flagKey && !distinctId) {
    flagCache.clear();
    return;
  }
  for (const key of flagCache.keys()) {
    const [k, d] = key.split("::");
    if ((flagKey && k === flagKey) || (distinctId && d === distinctId)) {
      flagCache.delete(key);
    }
  }
};

/** Test-only cache reset. */
export const __resetFeatureFlagCache = (): void => {
  flagCache.clear();
};

export const isPostHogConfigured = (): boolean => !!env.POSTHOG_API_KEY;

export const captureServerEvent = (
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void => {
  const ph = getClient();
  if (!ph) return;

  try {
    ph.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        $lib: "posthog-node",
        source: "backend",
      },
    });
  } catch (error) {
    logger.warn({ error, event }, "PostHog server capture failed");
  }
};

export const identifyUser = (
  distinctId: string,
  properties: Record<string, unknown>
): void => {
  const ph = getClient();
  if (!ph) return;

  try {
    ph.identify({
      distinctId,
      properties,
    });
  } catch (error) {
    logger.warn({ error, distinctId }, "PostHog server identify failed");
  }
};

export const shutdownPostHog = async (): Promise<void> => {
  if (client) {
    await client.shutdown();
    client = null;
  }
};
