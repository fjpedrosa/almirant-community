"use client";

import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { askApi } from "@/lib/api/client";
import type {
  AskFeedbackRating,
  AskFeedbackCategory,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Hook: useAskFeedback
// ---------------------------------------------------------------------------
// Manages the beta feedback state for Ask responses: submitting thumbs
// up/down ratings with optional category and comment, and tracking which
// sessions have already been rated.
// ---------------------------------------------------------------------------

export interface UseAskFeedbackReturn {
  submitFeedback: (params: {
    sessionId: string;
    rating: AskFeedbackRating;
    category?: AskFeedbackCategory;
    comment?: string;
  }) => void;
  hasRated: (sessionId: string) => boolean;
  getRating: (sessionId: string) => AskFeedbackRating | null;
  isSubmitting: boolean;
}

export const useAskFeedback = (): UseAskFeedbackReturn => {
  const [ratings, setRatings] = useState<Map<string, AskFeedbackRating>>(
    () => new Map(),
  );

  const mutation = useMutation({
    mutationFn: askApi.submitFeedback,
  });

  const submitFeedback = useCallback(
    (params: {
      sessionId: string;
      rating: AskFeedbackRating;
      category?: AskFeedbackCategory;
      comment?: string;
    }) => {
      // Optimistically mark as rated
      setRatings((prev) => {
        const next = new Map(prev);
        next.set(params.sessionId, params.rating);
        return next;
      });

      mutation.mutate({
        sessionId: params.sessionId,
        rating: params.rating,
        category: params.category,
        comment: params.comment,
      });
    },
    [mutation],
  );

  const hasRated = useCallback(
    (sessionId: string): boolean => ratings.has(sessionId),
    [ratings],
  );

  const getRating = useCallback(
    (sessionId: string): AskFeedbackRating | null =>
      ratings.get(sessionId) ?? null,
    [ratings],
  );

  return {
    submitFeedback,
    hasRated,
    getRating,
    isSubmitting: mutation.isPending,
  };
};
