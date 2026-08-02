"use client";

import { useFeedbackTraceability } from "../../application/hooks/use-feedback-traceability";
import { PromotedWorkItemLink } from "../components/promoted-work-item-link";

interface PromotedWorkItemContainerProps {
  feedbackItemId: string;
}

export const PromotedWorkItemContainer: React.FC<PromotedWorkItemContainerProps> = ({
  feedbackItemId,
}) => {
  const { data, isLoading } = useFeedbackTraceability(feedbackItemId);

  if (isLoading || !data?.workItem) return null;

  return (
    <PromotedWorkItemLink
      workItemId={data.workItem.id}
      workItemTitle={data.workItem.title}
      workItemTaskId={data.workItem.taskId}
    />
  );
};
