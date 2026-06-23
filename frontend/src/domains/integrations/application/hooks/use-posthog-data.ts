"use client";

import { useQuery } from "@tanstack/react-query";
import { observabilityApi } from "@/lib/api/client";
import type { PosthogInsight, PosthogEvent } from "../../domain/types";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const posthogKeys = {
  all: ["observability", "posthog"] as const,
  insights: (connectionId: string) =>
    [...posthogKeys.all, "insights", connectionId] as const,
  events: (connectionId: string) =>
    [...posthogKeys.all, "events", connectionId] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const usePosthogInsights = (connectionId: string | null) => {
  return useQuery({
    queryKey: posthogKeys.insights(connectionId!),
    queryFn: () => observabilityApi.getPosthogInsights(connectionId!),
    enabled: !!connectionId,
    staleTime: 5 * 60 * 1000,
    select: (data) => data as PosthogInsight[],
  });
};

export const usePosthogEvents = (connectionId: string | null) => {
  return useQuery({
    queryKey: posthogKeys.events(connectionId!),
    queryFn: () => observabilityApi.getPosthogEvents(connectionId!),
    enabled: !!connectionId,
    staleTime: 5 * 60 * 1000,
    select: (data) => data as PosthogEvent[],
  });
};
