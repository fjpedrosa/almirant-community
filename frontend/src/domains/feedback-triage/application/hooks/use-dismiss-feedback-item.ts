"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { feedbackTriageKeys } from "./use-triage-keys";
import { feedbackKeys } from "@/domains/feedback/application/hooks/use-feedback-traceability";

interface UseDismissFeedbackItemOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for dismissing a feedback item from the triage inbox.
 * The item will be marked as dismissed and removed from the review queue.
 *
 * @param options - Optional callbacks for success/error handling
 * @returns Mutation result with mutate function
 *
 * @example
 * const { mutate, isPending } = useDismissFeedbackItem({
 *   onSuccess: () => toast.success('Item dismissed'),
 * });
 * mutate({ itemId: 'item123', reason: 'Duplicate of existing issue' });
 */
export const useDismissFeedbackItem = (options?: UseDismissFeedbackItemOptions) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason?: string }) =>
      feedbackTriageApi.dismissItem(itemId, reason),
    onSuccess: () => {
      // Invalidate triage inbox
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.inbox() });
      // Invalidate clusters (item counts may change)
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.clusters() });
      // Invalidate feedback items list
      queryClient.invalidateQueries({ queryKey: feedbackKeys.items() });
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });
};
