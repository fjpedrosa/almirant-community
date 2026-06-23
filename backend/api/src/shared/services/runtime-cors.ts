import { env } from "@almirant/config";
import { getPublicInstanceConfig } from "../../domains/instance/services/instance-config-service";

/**
 * Resolves the full set of allowed CORS origins by combining:
 * 1. `CORS_ORIGIN` env (static, always present)
 * 2. `publicUrl` from instance_settings (dynamic, set via onboarding wizard)
 *
 * The Elysia CORS plugin requires a synchronous origin check, so we maintain
 * a sync-readable cache of the DB publicUrl. A background refresh runs every
 * REFRESH_INTERVAL_MS (30s) to pick up changes without a restart.
 */

const REFRESH_INTERVAL_MS = 30_000;

const envOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());

// Sync-readable cache of the DB-derived origin (null = not loaded yet or no publicUrl)
let dbOrigin: string | null = null;

const normalizeToOrigin = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const refresh = async (): Promise<void> => {
  try {
    const config = await getPublicInstanceConfig();
    dbOrigin = config.publicUrl ? normalizeToOrigin(config.publicUrl) : null;
  } catch {
    // Keep previous value on failure
  }
};

/**
 * Call once at startup (before the server starts listening) to warm the cache.
 * Subsequent refreshes happen on a timer.
 */
export const initRuntimeCors = async (): Promise<void> => {
  await refresh();
  setInterval(refresh, REFRESH_INTERVAL_MS);
};

/**
 * Synchronous check: returns true if the given origin is allowed.
 * Used by the Elysia CORS plugin's origin function.
 */
export const isOriginAllowed = (origin: string): boolean => {
  if (envOrigins.includes(origin)) return true;
  if (dbOrigin && dbOrigin === origin) return true;
  return false;
};
