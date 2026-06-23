/**
 * Version-check service.
 *
 * Exposes the current build SHA (injected as ALMIRANT_BUILD_SHA at build time)
 * and compares it against the latest commit on the upstream repo's `main`
 * branch. Result is cached in-memory for 30 minutes to avoid rate-limiting
 * the GitHub API (60 req/hour unauthenticated, 5000 req/hour with a token).
 *
 * A `GITHUB_TOKEN` env var (scope `public_repo`) is optional: the poll works
 * unauthenticated but is subject to GitHub's lower rate limit (60 req/h vs
 * 5000 req/h). Under rate limiting `latest` resolves to `null`, which silently
 * disables the update banner — we log a one-time warning at startup to make
 * this easier to spot.
 *
 * The endpoint that calls this service is gated by requireAdmin, so only
 * admins of the self-hosted instance see version info.
 */

import { env, logger } from "@almirant/config";

const GITHUB_OWNER = "almirant-ai";
const GITHUB_REPO = "almirant";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
const GITHUB_UI_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const FETCH_TIMEOUT_MS = 10_000;

let warnedAboutMissingToken = false;

export interface InstanceVersionInfo {
  /** Short SHA (7 chars) of the commit this build was compiled from. */
  current: string | null;
  /** Short SHA of the latest commit on `main` in the public repo. */
  latest: string | null;
  /** True when both SHAs are known and they differ. */
  updateAvailable: boolean;
  /**
   * GitHub URL a human can click to review what changed. Compare URL when
   * both SHAs are known, falls back to the commits page.
   */
  compareUrl: string;
  /** ISO timestamp of the last successful GitHub poll. */
  checkedAt: string;
}

type Cache = {
  info: InstanceVersionInfo;
  expiresAt: number;
};

let cache: Cache | null = null;

const readCurrentSha = (): string | null => {
  const raw = process.env.ALMIRANT_BUILD_SHA?.trim();
  if (!raw || raw === "unknown" || raw === "dev") return null;
  return raw.slice(0, 7);
};

const buildAuthHeaders = (): Record<string, string> => {
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) {
    if (!warnedAboutMissingToken) {
      warnedAboutMissingToken = true;
      logger.warn(
        "Version check: GITHUB_TOKEN is not set. The poll will use GitHub's " +
          "unauthenticated rate limit (60 req/h); under heavy use the update " +
          "banner may stay hidden. Set GITHUB_TOKEN (PAT with `public_repo` scope) " +
          "to raise the limit.",
      );
    }
    return {};
  }
  return { Authorization: `Bearer ${token}` };
};

const fetchLatestSha = async (): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${GITHUB_API_URL}/commits/main`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "almirant-self-hosted",
        ...buildAuthHeaders(),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn(
        { status: response.status, hasToken: Boolean(env.GITHUB_TOKEN) },
        "Version check: GitHub returned non-2xx",
      );
      return null;
    }
    const body = (await response.json()) as { sha?: string };
    return body.sha ? body.sha.slice(0, 7) : null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Version check: GitHub request failed",
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const buildCompareUrl = (
  current: string | null,
  latest: string | null,
): string => {
  if (current && latest && current !== latest) {
    return `${GITHUB_UI_URL}/compare/${current}...${latest}`;
  }
  return `${GITHUB_UI_URL}/commits/main`;
};

export const getInstanceVersion = async (): Promise<InstanceVersionInfo> => {
  const now = Date.now();
  const current = readCurrentSha();

  if (cache && cache.expiresAt > now) {
    // Current can change between requests only when the container is
    // restarted, but we refresh it on every call anyway — the rest of the
    // payload (latest, timestamp) remains cached until TTL.
    return { ...cache.info, current };
  }

  const latest = await fetchLatestSha();
  const info: InstanceVersionInfo = {
    current,
    latest,
    updateAvailable: Boolean(current && latest && current !== latest),
    compareUrl: buildCompareUrl(current, latest),
    checkedAt: new Date(now).toISOString(),
  };

  cache = { info, expiresAt: now + CACHE_TTL_MS };
  return info;
};

/** Exposed for tests: drops the cache so the next call re-fetches. */
export const __resetInstanceVersionCache = (): void => {
  cache = null;
};
