"use client";

/**
 * Feature flags utility.
 *
 * Two mechanisms:
 * 1. Build-time env flags: `NEXT_PUBLIC_FEATURE_<FLAG>` (static, no redeploy toggle)
 * 2. PostHog remote flags: evaluated per-user via `useFeatureFlag` hook (dynamic)
 *
 * @example
 * ```ts
 * // Build-time env flag
 * import { isFeatureEnabled } from "@/lib/feature-flags";
 * if (isFeatureEnabled("WAITLIST")) { ... }
 *
 * // PostHog remote flag (React hook)
 * import { useFeatureFlag } from "@/lib/feature-flags";
 * const showDiscord = useFeatureFlag("integration-discord");
 * ```
 */

import { useFeatureFlagEnabled } from "posthog-js/react";
import { isPostHogEnabled } from "./posthog";

// ---------------------------------------------------------------------------
// Build-time env flags
// ---------------------------------------------------------------------------

const featureFlagCache = new Map<string, boolean>();

export const isFeatureEnabled = (flag: string): boolean => {
  const upperFlag = flag.toUpperCase();

  if (featureFlagCache.has(upperFlag)) {
    return featureFlagCache.get(upperFlag)!;
  }

  const envKey = `NEXT_PUBLIC_FEATURE_${upperFlag}`;
  const value =
    typeof process !== "undefined" ? process.env[envKey] : undefined;
  const enabled = value === "true";

  featureFlagCache.set(upperFlag, enabled);

  return enabled;
};

// ---------------------------------------------------------------------------
// PostHog remote flags (React hook)
// ---------------------------------------------------------------------------

/**
 * Evaluate a PostHog feature flag for the current user.
 * Returns `false` when PostHog is not enabled or the flag is off.
 */
export const useFeatureFlag = (flag: string): boolean => {
  const enabled = useFeatureFlagEnabled(flag);

  if (!isPostHogEnabled()) return false;

  return !!enabled;
};
