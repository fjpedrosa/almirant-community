/**
 * Server-side helper to fetch the public instance config from the backend.
 * Used to resolve runtime values (publicUrl, etc.) that may be configured
 * via the onboarding wizard instead of environment variables.
 *
 * The result is cached in-memory for TTL_MS (30s) to avoid hitting the
 * backend on every request. On failure, returns safe defaults so the app
 * can still boot using env-based fallbacks.
 */

export interface InstancePublicConfig {
  publicUrl: string | null;
  githubAppSlug: string | null;
  onboardingCompleted: boolean;
}

const FALLBACK: InstancePublicConfig = {
  publicUrl: null,
  githubAppSlug: null,
  onboardingCompleted: false,
};

// 30s TTL — matches the backend Cache-Control header
const TTL_MS = 30_000;

let cache: { value: InstancePublicConfig; expiresAt: number } | null = null;

export const getInstancePublicConfig =
  async (): Promise<InstancePublicConfig> => {
    if (cache && cache.expiresAt > Date.now()) return cache.value;

    try {
      const baseUrl = process.env.BACKEND_URL ?? "http://localhost:3001";
      // Mounted outside the /api auth group so the URL has no /api prefix.
      const res = await fetch(`${baseUrl}/instance/public-config`, {
        cache: "no-store",
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = (await res.json()) as {
        success: boolean;
        data: InstancePublicConfig;
      };
      const value = json.data ?? FALLBACK;

      cache = { value, expiresAt: Date.now() + TTL_MS };
      return value;
    } catch {
      return FALLBACK;
    }
  };

export const invalidateInstancePublicConfig = (): void => {
  cache = null;
};
