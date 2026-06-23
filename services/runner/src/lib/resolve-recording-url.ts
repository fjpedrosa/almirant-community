/**
 * Resolves the target URL for walkthrough recording jobs.
 *
 * Resolution priority:
 *   1. Explicit `targetUrl` override from job config (highest priority)
 *   2. `previewUrl` from work item metadata (set by Vercel webhook)
 *   3. `defaultStagingUrl` fallback
 *   4. Throws if none available
 *
 * All resolved URLs are validated against known production patterns
 * to prevent accidental recording against production.
 *
 * Environment variable support:
 *   - STAGING_URL: optional env var used as the default staging URL
 *     when no `defaultStagingUrl` is provided explicitly.
 */

const DEFAULT_PRODUCTION_PATTERNS: string[] = [
  "https://almirant.ai",
  "https://www.almirant.ai",
  "https://api.almirant.ai",
];

/**
 * Checks whether a URL matches known production patterns.
 *
 * A URL is considered production if it:
 *   - Matches one of the default production domains (exact origin match)
 *   - Matches any of the provided custom `productionPatterns`
 *   - Is a Vercel `.vercel.app` deployment that is NOT a preview
 *     (i.e. does not contain a git hash segment typical of preview URLs)
 */
export function isProductionUrl(
  url: string,
  productionPatterns?: string[],
): boolean {
  const patterns = [...DEFAULT_PRODUCTION_PATTERNS, ...(productionPatterns ?? [])];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // If we cannot parse it, be conservative and reject
    return true;
  }

  const origin = parsed.origin; // e.g. "https://almirant.ai"

  for (const pattern of patterns) {
    // Support both origin-only patterns and full URL prefixes
    if (origin === pattern || url.startsWith(pattern)) {
      return true;
    }
  }

  // Vercel production deployment detection:
  // Preview deployments have hostnames like `project-<hash>-team.vercel.app`
  // or `project-git-branch-team.vercel.app`.
  // The main production alias is typically `project.vercel.app` (no hash/git segment).
  if (parsed.hostname.endsWith(".vercel.app")) {
    const subdomain = parsed.hostname.replace(".vercel.app", "");
    // Preview deployments contain at least one hyphen-separated segment
    // beyond the project name, typically with a git hash (8+ hex chars)
    // or a "git-" prefix. A simple heuristic: if the subdomain has no
    // segment matching a git hash pattern, treat it as production.
    const hasPreviewSegment =
      /(-git-|-[0-9a-f]{8,})/.test(subdomain);
    if (!hasPreviewSegment) {
      return true;
    }
  }

  return false;
}

export type ResolveRecordingUrlConfig = {
  /** Explicit override URL from job config (highest priority). */
  targetUrl?: string;
  /** Work item metadata object; `previewUrl` is extracted from it. */
  workItemMetadata?: Record<string, unknown> | null;
  /** Fallback staging URL. Falls back to STAGING_URL env var if not provided. */
  defaultStagingUrl?: string;
  /** Additional production URL patterns to block. */
  productionPatterns?: string[];
};

/**
 * Resolves the recording target URL using a deterministic priority chain.
 *
 * @throws {Error} If no URL can be resolved or the resolved URL is a production URL.
 */
export function resolveRecordingUrl(config: ResolveRecordingUrlConfig): string {
  const {
    targetUrl,
    workItemMetadata,
    defaultStagingUrl,
    productionPatterns,
  } = config;

  let resolved: string | undefined;

  // Priority 1: explicit override
  if (targetUrl) {
    resolved = targetUrl;
  }

  // Priority 2: preview URL from work item metadata
  if (!resolved && workItemMetadata?.previewUrl) {
    const preview = workItemMetadata.previewUrl;
    if (typeof preview === "string" && preview.length > 0) {
      resolved = preview;
    }
  }

  // Priority 3: explicit staging URL or STAGING_URL env var
  if (!resolved) {
    const staging = defaultStagingUrl ?? process.env.STAGING_URL;
    if (staging) {
      resolved = staging;
    }
  }

  // No URL available
  if (!resolved) {
    throw new Error(
      "No recording target URL available. Provide targetUrl in job config, " +
        "ensure the work item has a previewUrl, or set a staging URL.",
    );
  }

  // Production URL protection
  if (isProductionUrl(resolved, productionPatterns)) {
    throw new Error(
      `Refusing to record against production URL: ${resolved}. ` +
        "Use a preview or staging URL instead.",
    );
  }

  return resolved;
}
