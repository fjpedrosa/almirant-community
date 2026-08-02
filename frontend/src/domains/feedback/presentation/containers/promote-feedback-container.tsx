"use client";

import { useState, useCallback } from "react";
import { usePromoteFeedback } from "../../application/hooks/use-promote-feedback";
import { PromoteFeedbackDialog } from "../components/promote-feedback-dialog";
import type { FeedbackItem, PromoteFeedbackResponse } from "../../domain/types";

interface PromoteFeedbackContainerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedbackItem: FeedbackItem;
  boardId: string;
  boardColumnId: string;
  promotedBy?: string;
  onSuccess?: (response: PromoteFeedbackResponse) => void;
}

export const PromoteFeedbackContainer: React.FC<PromoteFeedbackContainerProps> = ({
  open,
  onOpenChange,
  feedbackItem,
  boardId,
  boardColumnId,
  promotedBy,
  onSuccess,
}) => {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const handleReasoningToggle = useCallback(() => setReasoningOpen((prev) => !prev), []);

  const {
    form,
    handleSubmit,
    isPending,
    isFormValid,
    resetForm,
  } = usePromoteFeedback(feedbackItem, {
    boardId,
    boardColumnId,
    promotedBy,
    onSuccess: (response) => {
      onOpenChange(false);
      onSuccess?.(response);
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      resetForm(feedbackItem);
      setReasoningOpen(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <PromoteFeedbackDialog
      open={open}
      onOpenChange={handleOpenChange}
      feedbackItem={feedbackItem}
      boardId={boardId}
      boardColumnId={boardColumnId}
      form={form}
      onSubmit={handleSubmit}
      isPending={isPending}
      isFormValid={isFormValid}
      reasoningOpen={reasoningOpen}
      onReasoningToggle={handleReasoningToggle}
    />
  );
};
