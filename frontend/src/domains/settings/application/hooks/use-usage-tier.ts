import { TIER_CONFIGS, type UsageTierInfo, type Tier } from "../../domain/types";

/**
 * Returns the current organization's tier info.
 *
 * TODO: Replace with a real API call once a billing/subscription endpoint exists.
 * For now returns the "free" tier from the centralized TIER_CONFIGS.
 */
export const useUsageTier = (): UsageTierInfo => {
  const tier: Tier = "free";
  const config = TIER_CONFIGS[tier];

  return {
    tier,
    tierName: config.name,
    tierMinuteLimit: config.minuteLimit,
    isUnlimited: config.minuteLimit <= 0,
  };
};
