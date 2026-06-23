"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePostHogFeatureFlag } from "@/domains/shared/application/hooks/use-posthog-feature-flag";

interface BetaGateProps {
  flagKey: string;
  children: React.ReactNode;
}

/**
 * Redirects to /board when the given PostHog feature flag is off.
 * Renders children only when the flag is enabled.
 * While flags are loading, renders nothing (avoids flash-redirect).
 */
export const BetaGate: React.FC<BetaGateProps> = ({ flagKey, children }) => {
  const { enabled, isLoading } = usePostHogFeatureFlag(flagKey);
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !enabled) {
      router.replace("/board");
    }
  }, [enabled, isLoading, router]);

  if (isLoading || !enabled) return null;

  return <>{children}</>;
};
