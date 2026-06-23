import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SprintItemRowProps } from "../../domain/types";

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-400",
};

const typeBadgeColors: Record<string, string> = {
  epic: "border-purple-500/50 text-purple-600 bg-purple-500/10",
  feature: "border-blue-500/50 text-blue-600 bg-blue-500/10",
  story: "border-green-500/50 text-green-600 bg-green-500/10",
  task: "border-zinc-500/50 text-zinc-600 bg-zinc-500/10",
};

export const SprintItemRow: React.FC<SprintItemRowProps> = ({
  title,
  type,
  priority,
  assignee,
  completedAt,
}) => {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 text-sm">
      <div className={cn("h-2 w-2 rounded-full shrink-0", priorityColors[priority])} />
      <span className="truncate flex-1">{title}</span>
      <Badge variant="outline" className={cn("text-[10px] shrink-0", typeBadgeColors[type])}>
        {type}
      </Badge>
      {assignee && (
        <span className="text-xs text-muted-foreground shrink-0 max-w-[80px] truncate">
          {assignee}
        </span>
      )}
      {completedAt && (
        <span className="text-xs text-muted-foreground shrink-0">
          {new Date(completedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
        </span>
      )}
    </div>
  );
};
