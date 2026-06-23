"use client";

import { useFeatureFlag } from "@/lib/feature-flags";
import type { ProviderType } from "../../domain/types";

/**
 * Evaluates all integration-level PostHog feature flags.
 * Returns a set of provider keys whose flags are enabled (or not gated at all).
 *
 * Providers without a feature flag key are always visible.
 */

/** Map of provider → PostHog feature flag key for gated integrations */
export const INTEGRATION_FLAG_KEYS: Partial<Record<ProviderType, string>> = {
  discord: "integration-discord",
  vercel: "integration-vercel",
  posthog: "integration-posthog",
  sentry: "integration-sentry",
};

export const useIntegrationFeatureFlags = (): {
  isProviderVisible: (provider: ProviderType) => boolean;
  isProviderFlagged: (provider: ProviderType) => boolean;
} => {
  // Evaluate each flag individually (stable hook call order)
  const discordEnabled = useFeatureFlag("integration-discord");
  const vercelEnabled = useFeatureFlag("integration-vercel");
  const posthogEnabled = useFeatureFlag("integration-posthog");
  const sentryEnabled = useFeatureFlag("integration-sentry");

  const flagResults: Record<string, boolean> = {
    "integration-discord": discordEnabled,
    "integration-vercel": vercelEnabled,
    "integration-posthog": posthogEnabled,
    "integration-sentry": sentryEnabled,
  };

  const isProviderVisible = (provider: ProviderType): boolean => {
    const flagKey = INTEGRATION_FLAG_KEYS[provider];
    if (!flagKey) return true; // No flag = always visible
    return flagResults[flagKey] ?? false;
  };

  const isProviderFlagged = (provider: ProviderType): boolean => {
    return !!INTEGRATION_FLAG_KEYS[provider];
  };

  return { isProviderVisible, isProviderFlagged };
};
