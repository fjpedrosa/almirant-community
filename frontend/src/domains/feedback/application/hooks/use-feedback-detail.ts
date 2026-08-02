"use client";

import { useState, useCallback } from "react";
import { useDetailPanelUrl } from "@/domains/shared/application/hooks/use-detail-panel-url";
import { useFeedbackItemById } from "./use-feedback-item";
import type { FeedbackItem } from "../../domain/types";

interface UseFeedbackDetailReturn {
  selectedItemId: string | null;
  selectedItem: FeedbackItem | null;
  isDetailOpen: boolean;
  onDetailOpenChange: (open: boolean) => void;
  handleItemClick: (item: FeedbackItem) => void;
}

export const useFeedbackDetail = (): UseFeedbackDetailReturn => {
  const [placeholder, setPlaceholder] = useState<FeedbackItem | null>(null);

  const { selectedItemId, isOpen, open, onOpenChange } =
    useDetailPanelUrl("feedbackId");

  const { data: selectedItem } = useFeedbackItemById(selectedItemId, placeholder);

  const handleItemClick = useCallback(
    (item: FeedbackItem) => {
      setPlaceholder(item);
      open(item.id);
    },
    [open],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
      if (!nextOpen) setPlaceholder(null);
    },
    [onOpenChange],
  );

  return {
    selectedItemId,
    selectedItem: selectedItem ?? null,
    isDetailOpen: isOpen,
    onDetailOpenChange: handleOpenChange,
    handleItemClick,
  };
};
