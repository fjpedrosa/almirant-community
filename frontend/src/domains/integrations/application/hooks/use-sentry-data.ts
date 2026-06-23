"use client";

import { useQuery } from "@tanstack/react-query";
import { observabilityApi } from "@/lib/api/client";
import type { SentryIssue, SentryStatsPoint } from "../../domain/types";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const sentryKeys = {
  all: ["observability", "sentry"] as const,
  issues: (connectionId: string) =>
    [...sentryKeys.all, "issues", connectionId] as const,
  stats: (connectionId: string) =>
    [...sentryKeys.all, "stats", connectionId] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const useSentryIssues = (connectionId: string | null) => {
  return useQuery({
    queryKey: sentryKeys.issues(connectionId!),
    queryFn: () => observabilityApi.getSentryIssues(connectionId!),
    enabled: !!connectionId,
    staleTime: 5 * 60 * 1000,
    select: (data) => data as SentryIssue[],
  });
};

export const useSentryStats = (connectionId: string | null) => {
  return useQuery({
    queryKey: sentryKeys.stats(connectionId!),
    queryFn: () => observabilityApi.getSentryStats(connectionId!),
    enabled: !!connectionId,
    staleTime: 5 * 60 * 1000,
    select: (data) => data as SentryStatsPoint[],
  });
};
