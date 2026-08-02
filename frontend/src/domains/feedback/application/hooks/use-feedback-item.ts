"use client";

import { useQuery } from "@tanstack/react-query";
import { adminFeedbackApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { feedbackKeys } from "./use-feedback-traceability";
import {
  extractDebugBundleMeta,
  isNonTerminalDebugStatus,
} from "../../domain/debug-analysis";
import type { FeedbackItem } from "../../domain/types";

const POLL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 10;

/**
 * Source of truth for the feedback detail panel.
 *
 * Conditional polling: only when metadata indicates a non-terminal analysis
 * status ("queued" or "running"). Detects status transitions and debugBundleId
 * changes (after a reanalyze).
 *
 * Accepts an optional `placeholder` (the item clicked in the list) that is
 * only used during the first fetch to avoid an empty panel flash. Once the
 * query responds, the placeholder is discarded and the source of truth is the
 * React Query cache.
 */
export const useFeedbackItemById = (
  id: string | null,
  placeholder?: FeedbackItem | null,
  /**
   * Defensive escape hatch for legacy/stale states where the cache still shows
   * `debugAnalysisStatus="queued"` without a real job behind it. The current
   * backend/client flow clears those fields when no job is created.
   */
  pollingSuppressed = false,
) => {
  const scopedKey = useOrgScopedKey(feedbackKeys.item(id ?? ""));
  return useQuery<FeedbackItem>({
    queryKey: scopedKey,
    queryFn: () => adminFeedbackApi.getFeedbackItemById(id!) as Promise<FeedbackItem>,
    enabled: !!id,
    staleTime: 10_000,
    // Only used when the snapshot id matches the current id — prevents showing
    // a stale item while the container is resolving a different id.
    placeholderData:
      placeholder && placeholder.id === id ? placeholder : undefined,
    refetchInterval: (query) => {
      if (pollingSuppressed) return false;
      const item = query.state.data;
      if (!item) return false;
      const { status } = extractDebugBundleMeta(item.metadata);
      if (!isNonTerminalDebugStatus(status)) return false;
      if (query.state.dataUpdateCount >= POLL_MAX_ATTEMPTS) return false;
      return POLL_MS;
    },
  });
};
