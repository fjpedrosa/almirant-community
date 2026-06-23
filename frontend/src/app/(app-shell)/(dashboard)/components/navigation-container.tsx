"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useNavigation } from "./hooks/use-navigation";
import { usePostHogFeatureFlag } from "@/domains/shared/application/hooks/use-posthog-feature-flag";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { TopNavigationBar } from "./top-navigation-bar";

/**
 * Each entry maps a navigation route ID to its PostHog feature flag key.
 * When the flag is off the route is hidden from navigation.
 */
const BETA_ROUTE_FLAGS: [routeId: string, flagKey: string][] = [
  ["ask", "beta-ask"],
  ["expenses", "beta-expenses"],
  ["roadmap", "beta-roadmap"],
  ["goals", "beta-goals"],
  ["docs", "beta-docs"],
  ["brain", "beta-brain"],
];

export const NavigationContainer: React.FC = () => {
  const { activeTab, isBrainActive } = useNavigation();
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // Evaluate each feature flag individually
  const askEnabled = usePostHogFeatureFlag("beta-ask").enabled;
  const expensesEnabled = usePostHogFeatureFlag("beta-expenses").enabled;
  const roadmapEnabled = usePostHogFeatureFlag("beta-roadmap").enabled;
  const goalsEnabled = usePostHogFeatureFlag("beta-goals").enabled;
  const docsEnabled = usePostHogFeatureFlag("beta-docs").enabled;
  const brainEnabled = usePostHogFeatureFlag("beta-brain").enabled;

  const { hiddenRouteIds, visibleBetaRouteIds } = useMemo(() => {
    const flagResults: Record<string, boolean> = {
      "beta-ask": askEnabled,
      "beta-expenses": expensesEnabled,
      "beta-roadmap": roadmapEnabled,
      "beta-goals": goalsEnabled,
      "beta-docs": docsEnabled,
      "beta-brain": brainEnabled,
    };

    const hidden = new Set<string>();
    const visibleBeta = new Set<string>();
    for (const [routeId, flagKey] of BETA_ROUTE_FLAGS) {
      if (!flagResults[flagKey]) {
        hidden.add(routeId);
      } else {
        visibleBeta.add(routeId);
      }
    }

    // Handbook is now a stable resource. When beta-brain is off, keep the
    // Brain dropdown available for stable resources and only hide beta entries.
    if (!brainEnabled) {
      hidden.add("docs");
      hidden.add("ask");
      visibleBeta.delete("docs");
      visibleBeta.delete("ask");
    }

    // Ideas is admin-only, not feature-flagged
    if (!isAdmin) {
      hidden.add("ideas");
    }

    return { hiddenRouteIds: hidden, visibleBetaRouteIds: visibleBeta };
  }, [askEnabled, expensesEnabled, roadmapEnabled, goalsEnabled, docsEnabled, brainEnabled, isAdmin]);

  // Hide top bar on mobile when in /plan (immersive mobile layout)
  const hideOnMobilePlan = pathname.startsWith("/plan");

  return (
    <TopNavigationBar
      activeTab={activeTab}
      hideOnMobile={hideOnMobilePlan}
      hiddenRouteIds={hiddenRouteIds}
      featureFlaggedRouteIds={visibleBetaRouteIds}
      isBrainActive={isBrainActive}
    />
  );
};
