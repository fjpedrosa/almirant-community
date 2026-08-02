import { Badge } from "@/components/ui/badge";
import { MessageSquareText } from "lucide-react";
import type { FeedbackOriginBadgeProps } from "../../domain/types";

export const FeedbackOriginBadge: React.FC<FeedbackOriginBadgeProps> = ({
  feedbackTitle,
}) => {
  return (
    <Badge variant="outline" className="gap-1.5 text-xs font-normal text-muted-foreground">
      <MessageSquareText className="h-3 w-3" />
      <span className="truncate max-w-[200px]">From feedback: {feedbackTitle}</span>
    </Badge>
  );
};
