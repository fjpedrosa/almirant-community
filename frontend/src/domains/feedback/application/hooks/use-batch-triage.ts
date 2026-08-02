"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { adminFeedbackApi } from "@/lib/api/client";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { feedbackKeys } from "./use-feedback-traceability";
import { feedbackTriageKeys } from "@/domains/feedback-triage/application/hooks/use-triage-keys";
import type { BatchTriageResponse } from "../../domain/types";

interface UseBatchTriageReturn {
  enqueueBatch: (feedbackItemIds: string[]) => void;
  enqueueBatchAsync: (feedbackItemIds: string[]) => Promise<BatchTriageResponse>;
  isPending: boolean;
}

/**
 * Enqueues a single feedback-triage-batch job for 2-20 feedback items.
 *
 * Surfaces the backend's flat response as toast feedback:
 *   - `enqueued: true`  → success toast ("encolado")
 *   - `enqueued: false` → info toast ("ya existe un batch activo con estos items")
 *   - thrown error      → error toast
 *
 * On both success outcomes (enqueued true/false) we invalidate the feedback
 * items list plus the triage inbox/clusters keys so the moderation UI and the
 * triage inbox stay consistent while the job runs in the background.
 */
export const useBatchTriage = (): UseBatchTriageReturn => {
  const t = useTranslations("feedback");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (feedbackItemIds: string[]): Promise<BatchTriageResponse> =>
      adminFeedbackApi.batchTriageFeedbackItems(
        feedbackItemIds,
      ) as Promise<BatchTriageResponse>,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.items() });
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.inbox() });
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.clusters() });
      if (result.enqueued) {
        showToast.success(t("moderation.batchTriageEnqueued"));
      } else {
        showToast.info(t("moderation.batchTriageAlreadyActive"));
      }
    },
    onError: () => {
      showToast.error(t("moderation.batchTriageError"));
    },
  });

  const enqueueBatch = useCallback(
    (feedbackItemIds: string[]) => {
      mutation.mutate(feedbackItemIds);
    },
    [mutation],
  );

  const enqueueBatchAsync = useCallback(
    (feedbackItemIds: string[]) => mutation.mutateAsync(feedbackItemIds),
    [mutation],
  );

  return {
    enqueueBatch,
    enqueueBatchAsync,
    isPending: mutation.isPending,
  };
};
