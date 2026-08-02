import { Badge } from "@/components/ui/badge";
import { ArrowUpRight } from "lucide-react";
import type { PromotedWorkItemLinkProps } from "../../domain/types";

export const PromotedWorkItemLink: React.FC<PromotedWorkItemLinkProps> = ({
  workItemTitle,
  workItemTaskId,
}) => {
  return (
    <Badge variant="outline" className="gap-1.5 text-xs font-normal text-blue-600 dark:text-blue-400">
      <ArrowUpRight className="h-3 w-3" />
      <span className="truncate max-w-[200px]">
        Promoted to: {workItemTaskId ? `${workItemTaskId} - ` : ""}{workItemTitle}
      </span>
    </Badge>
  );
};
