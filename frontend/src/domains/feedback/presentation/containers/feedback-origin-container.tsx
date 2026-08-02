"use client";

import { useFeedbackPromotionByWorkItem } from "../../application/hooks/use-feedback-traceability";
import { FeedbackOriginBadge } from "../components/feedback-origin-badge";

interface FeedbackOriginContainerProps {
  workItemId: string;
}

export const FeedbackOriginContainer: React.FC<FeedbackOriginContainerProps> = ({
  workItemId,
}) => {
  const { data: promotion, isLoading } = useFeedbackPromotionByWorkItem(workItemId);

  if (isLoading || !promotion?.feedbackItem) return null;

  return (
    <FeedbackOriginBadge
      feedbackItemId={promotion.feedbackItemId}
      feedbackTitle={promotion.feedbackItem.title}
    />
  );
};
