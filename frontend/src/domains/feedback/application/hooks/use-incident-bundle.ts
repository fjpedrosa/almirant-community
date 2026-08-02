"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { debugApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { feedbackKeys } from "./use-feedback-traceability";
import { isNonTerminalDebugStatus } from "../../domain/debug-analysis";
import type {
  DebugAnalysisStatus,
  FeedbackItem,
  IncidentBundleResponse,
} from "../../domain/types";

export const incidentBundleKeys = {
  all: ["backoffice", "debug", "incident-bundle"] as const,
  detail: (bundleId: string) => [...incidentBundleKeys.all, bundleId] as const,
};

const POLL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 10;

export const useIncidentBundle = (
  bundleId: string | null,
  status?: DebugAnalysisStatus,
  /**
   * Same purpose as in `useFeedbackItemById`: when a reanalyze returns without
   * a `jobId`, the status stays ambiguously at `queued` with no real job. We
   * disable polling to avoid hammering the API.
   */
  pollingSuppressed = false,
) => {
  const scopedKey = useOrgScopedKey(incidentBundleKeys.detail(bundleId ?? ""));
  return useQuery<IncidentBundleResponse>({
    queryKey: scopedKey,
    queryFn: () => debugApi.getIncidentBundle(bundleId!),
    enabled: !!bundleId,
    staleTime: 15_000,
    refetchInterval: (query) => {
      if (pollingSuppressed) return false;
      if (!isNonTerminalDebugStatus(status)) return false;
      if (query.state.dataUpdateCount >= POLL_MAX_ATTEMPTS) return false;
      return POLL_MS;
    },
  });
};

/**
 * Refresh as mutation: `POST /debug/incidents/:bundleId/refresh` rebuilds the
 * bundle in place (`updateIncidentBundleData`) and returns `{ bundle, timeline }`
 * — same shape as the GET. We write the result into the SAME cache entry that
 * `useIncidentBundle` reads so the panel sees fresh data without a second GET.
 *
 * Critical: `useIncidentBundle` uses `useOrgScopedKey(...)` as its key. The
 * mutation must write with the same scoped key, not with the bare
 * `incidentBundleKeys.detail`. That is why this hook also calls
 * `useOrgScopedKey` and receives `bundleId` as an argument.
 *
 * NOTE: `GET /debug/incidents/:bundleId?refresh=true` returns **405**.
 * Refresh lives at `POST /debug/incidents/:bundleId/refresh`.
 */
export const useRefreshIncidentBundle = (bundleId: string | null) => {
  const qc = useQueryClient();
  const scopedKey = useOrgScopedKey(incidentBundleKeys.detail(bundleId ?? ""));
  return useMutation({
    mutationFn: () => {
      if (!bundleId) throw new Error("no bundle id");
      return debugApi.refreshIncidentBundle(bundleId);
    },
    onSuccess: (data) => {
      qc.setQueryData(scopedKey, data);
    },
  });
};

/**
 * Reanalyze creates a NEW bundle. Two steps on success:
 *
 * 1. **Optimistic patch** of the scoped feedback-item cache entry with the new
 *    `bundleId`. We only patch `debugAnalysisStatus='queued'` when the backend
 *    actually returns a `jobId`; otherwise we clear any stale status fields so
 *    the panel points to the fresh bundle without pretending a job exists.
 * 2. **Invalidation** of the feedback item + old bundle to reconcile with the
 *    server (in case the backend changed anything else).
 *
 * Scoping: `setQueryData` needs the exact org-scoped key. `invalidateQueries`
 * uses the base key (prefix match — invalidates all scoped entries).
 */
export const useReanalyzeIncidentBundle = (feedbackItemId: string | null) => {
  const qc = useQueryClient();
  const feedbackItemScopedKey = useOrgScopedKey(
    feedbackKeys.item(feedbackItemId ?? ""),
  );
  return useMutation({
    mutationFn: (bundleId: string) => debugApi.reanalyzeIncidentBundle(bundleId),
    onSuccess: (response, oldBundleId) => {
      if (feedbackItemId) {
        // 1. Optimistic patch: update metadata with new bundleId.
        //    If the entry doesn't exist in cache yet, this is a no-op.
        qc.setQueryData<FeedbackItem | undefined>(
          feedbackItemScopedKey,
          (prev) => {
            if (!prev) return prev;
            const prevMeta = (prev.metadata ?? {}) as Record<string, unknown>;
            const nextMeta: Record<string, unknown> = {
              ...prevMeta,
              debugBundleId: response.bundleId,
            };

            if (response.jobId) {
              nextMeta.debugAnalysisStatus = "queued";
              nextMeta.debugAnalysisStartedAt = new Date().toISOString();
            } else {
              delete nextMeta.debugAnalysisStatus;
              delete nextMeta.debugAnalysisStartedAt;
            }

            return {
              ...prev,
              metadata: nextMeta,
            };
          },
        );
        // 2. Invalidate to reconcile with server.
        qc.invalidateQueries({ queryKey: feedbackKeys.item(feedbackItemId) });
      }
      qc.invalidateQueries({ queryKey: incidentBundleKeys.detail(oldBundleId) });
    },
  });
};
