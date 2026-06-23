"use client";

import { useState, useEffect, useRef } from "react";
import { isPostHogEnabled, posthog } from "@/lib/posthog";

interface FeatureFlagState {
  enabled: boolean;
  isLoading: boolean;
}

/**
 * Reads a PostHog feature flag reactively.
 * Returns `{ enabled, isLoading }` so callers can distinguish between
 * "flags not loaded yet" and "flag is off".
 *
 * Initial state is `{ enabled: false, isLoading: false }` to avoid
 * hydration mismatches. A ref tracks whether flags have been evaluated
 * at least once — until then, `isLoading` is reported as `true` so
 * gated components (BetaGate) don't redirect prematurely.
 */
export const usePostHogFeatureFlag = (flagKey: string): FeatureFlagState => {
  const [state, setState] = useState<FeatureFlagState>({
    enabled: false,
    isLoading: false,
  });
  const hasEvaluatedRef = useRef(false);

  useEffect(() => {
    if (!isPostHogEnabled()) {
      hasEvaluatedRef.current = true;
      return;
    }

    const check = () => {
      const value = posthog.isFeatureEnabled(flagKey);
      if (value === undefined) {
        setState({ enabled: false, isLoading: true });
      } else {
        hasEvaluatedRef.current = true;
        setState({ enabled: value, isLoading: false });
      }
    };

    check();
    posthog.onFeatureFlags(check);
  }, [flagKey]);

  // Until the effect has evaluated flags at least once, report loading
  // so consumers don't act on the default false value.
  if (!hasEvaluatedRef.current && isPostHogEnabled()) {
    return { enabled: false, isLoading: true };
  }

  return state;
};
