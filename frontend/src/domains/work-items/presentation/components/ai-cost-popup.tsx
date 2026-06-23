import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AiCostBadge } from "./ai-cost-badge";
import type { AiCostPopupProps } from "../../domain/types";

export const AiCostPopup: React.FC<AiCostPopupProps> = ({
  summary,
  sessions,
  children,
}) => {
  if (summary.sessionCount === 0) return null;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        className="w-72 bg-popover text-popover-foreground border rounded-lg p-0 shadow-lg"
      >
        <AiCostBadge summary={summary} sessions={sessions} compact={false} />
      </TooltipContent>
    </Tooltip>
  );
};
