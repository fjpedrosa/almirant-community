"use client";

import { useState, useCallback } from "react";
import type {
  AskFeedbackRating,
  AskFeedbackCategory,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Hook: useAskFeedbackForm
// ---------------------------------------------------------------------------
// Manages the local UI state for the feedback expanded form (category
// selection, comment text, expanded/collapsed state). Works together with
// useAskFeedback which handles the actual API submission.
// ---------------------------------------------------------------------------

export interface UseAskFeedbackFormReturn {
  isExpanded: boolean;
  selectedCategory: AskFeedbackCategory | undefined;
  comment: string;
  pendingRating: AskFeedbackRating | null;
  expand: (rating: AskFeedbackRating) => void;
  setCategory: (category: AskFeedbackCategory | undefined) => void;
  setComment: (comment: string) => void;
  dismiss: () => void;
  reset: () => void;
}

export const useAskFeedbackForm = (): UseAskFeedbackFormReturn => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingRating, setPendingRating] = useState<AskFeedbackRating | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] = useState<
    AskFeedbackCategory | undefined
  >(undefined);
  const [comment, setComment] = useState("");

  const expand = useCallback((rating: AskFeedbackRating) => {
    setPendingRating(rating);
    setIsExpanded(true);
  }, []);

  const dismiss = useCallback(() => {
    setIsExpanded(false);
    setSelectedCategory(undefined);
    setComment("");
  }, []);

  const reset = useCallback(() => {
    setIsExpanded(false);
    setPendingRating(null);
    setSelectedCategory(undefined);
    setComment("");
  }, []);

  return {
    isExpanded,
    selectedCategory,
    comment,
    pendingRating,
    expand,
    setCategory: setSelectedCategory,
    setComment,
    dismiss,
    reset,
  };
};
