"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackTriageApi } from "@/lib/api/client";
import { feedbackTriageKeys } from "./use-triage-keys";
import { feedbackKeys } from "@/domains/feedback/application/hooks/use-feedback-traceability";

interface UseConfirmFeedbackItemOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for confirming AI suggestion for a feedback item.
 * Confirms the suggested cluster assignment and category.
 *
 * @param options - Optional callbacks for success/error handling
 * @returns Mutation result with mutate function
 *
 * @example
 * const { mutate, isPending } = useConfirmFeedbackItem({
 *   onSuccess: () => toast.success('AI suggestion confirmed'),
 * });
 * mutate('item123');
 */
export const useConfirmFeedbackItem = (options?: UseConfirmFeedbackItemOptions) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) => feedbackTriageApi.confirmItem(itemId),
    onSuccess: () => {
      // Invalidate triage inbox
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.inbox() });
      // Invalidate clusters (confirmed items may affect cluster counts)
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
