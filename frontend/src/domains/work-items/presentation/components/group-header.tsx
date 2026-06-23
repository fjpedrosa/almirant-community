import { ChevronDown, ChevronRight, Crown, Puzzle, BookOpen, SquareCheckBig, Layers, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { typeBadgeColors } from "./work-item-style";
import type { GroupHeaderProps } from "../../domain/types";
import type { WorkItemType } from "../../domain/types";
import { stripTitlePrefix } from "../../domain/title-utils";

const parentTypeIcons: Record<WorkItemType, React.ElementType> = {
  epic: Crown,
  feature: Puzzle,
  story: BookOpen,
  task: SquareCheckBig,
  idea: Lightbulb,
};

export const GroupHeader: React.FC<GroupHeaderProps> = ({
  parentId,
  parentTitle,
  parentType,
  parentTaskId,
  ungroupedLabel,
  itemCount,
  isCollapsed,
  onToggleCollapse,
  depth = 0,
  onParentClick,
}) => {
  const t = useTranslations("workItems.kanban");
  const isUngrouped = parentId === null;
  const Icon = parentType ? parentTypeIcons[parentType] : Layers;
  const ChevronIcon = isCollapsed ? ChevronRight : ChevronDown;
  const isClickable = !isUngrouped && !!parentId && !!onParentClick;

  return (
    <button
      type="button"
      onClick={onToggleCollapse}
      className={cn(
        "w-full flex items-center gap-1.5 py-1.5 rounded-md text-xs",
        "hover:bg-accent/50 transition-colors cursor-pointer select-none",
        "border border-transparent",
        isUngrouped
          ? "text-muted-foreground"
          : "text-foreground"
      )}
      style={{ paddingLeft: 8 + depth * 16, paddingRight: 8 }}
    >
      <ChevronIcon className="h-3 w-3 shrink-0 text-muted-foreground" />

      {isUngrouped ? (
        <>
          <Layers className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate">{ungroupedLabel ?? t("ungrouped")}</span>
        </>
      ) : isClickable ? (
        <span
          className="flex items-center gap-1.5 min-w-0 cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onParentClick(parentId); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {parentType && (
            <Badge
              variant="outline"
              className={cn("text-[9px] px-1 py-0 h-4 shrink-0", typeBadgeColors[parentType])}
            >
              <Icon className="h-2.5 w-2.5" />
            </Badge>
          )}
          {parentTaskId && (
            <span className="text-muted-foreground font-mono shrink-0">{parentTaskId}</span>
          )}
          <span className="font-medium truncate hover:underline">{parentTitle ? stripTitlePrefix(parentTitle) : parentTitle}</span>
        </span>
      ) : (
        <>
          {parentType && (
            <Badge
              variant="outline"
              className={cn("text-[9px] px-1 py-0 h-4 shrink-0", typeBadgeColors[parentType])}
            >
              <Icon className="h-2.5 w-2.5" />
            </Badge>
          )}
          {parentTaskId && (
            <span className="text-muted-foreground font-mono shrink-0">{parentTaskId}</span>
          )}
          <span className="font-medium truncate">{parentTitle ? stripTitlePrefix(parentTitle) : parentTitle}</span>
        </>
      )}

      <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-auto shrink-0">
        {itemCount}
      </Badge>
    </button>
  );
};
