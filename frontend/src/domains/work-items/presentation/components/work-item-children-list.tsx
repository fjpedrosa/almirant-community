"use client";

import { BookOpen, Crown, Lightbulb, Puzzle, SquareCheckBig } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { typeBadgeColors } from "./work-item-style";
import type { WorkItemType } from "../../domain/types";

interface WorkItemChild {
  id: string;
  taskId: string | null;
  type: WorkItemType;
  title: string;
  columnName: string | null;
  columnColor: string | null;
}

interface WorkItemChildrenListProps {
  items: WorkItemChild[];
  isLoading?: boolean;
}

const WorkItemChildrenList: React.FC<WorkItemChildrenListProps> = ({
  items,
  isLoading,
}) => {
  const t = useTranslations("workItems.kanban");
  const typeIcons: Record<WorkItemType, React.ElementType> = {
    epic: Crown,
    feature: Puzzle,
    story: BookOpen,
    task: SquareCheckBig,
    idea: Lightbulb,
  };

  if (isLoading) {
    return (
      <div className="px-3 py-2 space-y-1.5">
        {[1, 2].map((i) => (
          <div key={i} className="h-5 bg-muted/50 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="px-3 pb-2 pt-1.5 flex flex-col gap-1">
      {items.map((child) => (
        <div
          key={child.id}
          className="w-full flex items-center gap-1.5 text-xs min-w-0"
        >
          <Badge
            variant="outline"
            className={cn("text-[9px] px-1 py-0 h-4 shrink-0", typeBadgeColors[child.type])}
          >
            {(() => {
              const Icon = typeIcons[child.type];
              return <Icon className="h-2.5 w-2.5" />;
            })()}
          </Badge>
          <span className="min-w-0 truncate flex-1">
            {child.title}
          </span>
          {child.columnName && (
            <span
              className="shrink-0 max-w-28 truncate text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: child.columnColor ? `${child.columnColor}20` : undefined,
                color: child.columnColor ?? undefined,
              }}
            >
              {child.columnName}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

export { WorkItemChildrenList };
export type { WorkItemChildrenListProps, WorkItemChild };
