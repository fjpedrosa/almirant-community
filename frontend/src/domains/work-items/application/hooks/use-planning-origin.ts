"use client";

import { useQuery } from "@tanstack/react-query";
import { planningSessionsApi } from "@/domains/planning/infrastructure/api/planning-api";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { WorkItemMetadata, PlanningOriginProps, PlanningProvider } from "../../domain/types";

/**
 * Normalizes provider string to known enum values.
 */
const normalizeProvider = (provider: string | undefined): PlanningProvider | undefined => {
  if (!provider) return undefined;
  const lower = provider.toLowerCase();
  if (lower === "anthropic" || lower === "claude") return "anthropic";
  if (lower === "openai" || lower === "gpt") return "openai";
  if (lower === "zai") return "zai";
  return "other";
};

/**
 * Extracts planning origin data from work item metadata and optionally fetches
 * session details (title) from the planning sessions API.
 */
export const usePlanningOrigin = (
  metadata: WorkItemMetadata | undefined
): PlanningOriginProps => {
  const planningSessionId = metadata?.planningSessionId;
  const planningModel = metadata?.planningModel;
  const planningProvider = normalizeProvider(metadata?.planningProvider);
  const fromSeedIds = metadata?.fromSeedIds;
  const scopedKey = useOrgScopedKey(["planning-sessions", planningSessionId]);

  // Fetch session details if we have a session ID
  const sessionQuery = useQuery({
    queryKey: scopedKey,
    queryFn: () => planningSessionsApi.get(planningSessionId!),
    enabled: !!planningSessionId,
    staleTime: 60_000, // Cache for 1 minute
  });

  const sessionTitle = sessionQuery.data?.title;
  const sessionUrl = planningSessionId
    ? `/plan?session=${planningSessionId}`
    : undefined;

  return {
    hasPlanningOrigin: !!planningSessionId,
    planningSessionId,
    planningModel,
    planningProvider,
    fromSeedIds,
    sessionTitle,
    sessionUrl,
    isLoadingSession: sessionQuery.isLoading,
  };
};
