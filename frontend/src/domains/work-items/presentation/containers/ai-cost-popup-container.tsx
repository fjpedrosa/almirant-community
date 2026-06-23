"use client";

import { Bot } from "lucide-react";
import { useWorkItemAiSessions } from "../../application/hooks/use-work-item-ai-sessions";
import { AiCostPopup } from "../components/ai-cost-popup";

interface AiCostPopupContainerProps {
  workItemId: string;
}

export const AiCostPopupContainer: React.FC<AiCostPopupContainerProps> = ({
  workItemId,
}) => {
  const { data } = useWorkItemAiSessions(workItemId);

  if (!data?.summary || data.summary.sessionCount === 0) return null;

  return (
    <AiCostPopup summary={data.summary} sessions={data.sessions}>
      <span className="cursor-pointer">
        <Bot className="h-4 w-4 text-muted-foreground transition-colors duration-300 ease-in-out hover:text-foreground" />
      </span>
    </AiCostPopup>
  );
};
