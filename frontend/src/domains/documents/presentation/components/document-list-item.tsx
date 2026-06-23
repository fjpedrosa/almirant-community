import { cn } from "@/lib/utils";
import { DynamicIcon, hasIcon } from "@/lib/icon-map";
import { Badge } from "@/components/ui/badge";
import type { DocumentListItemProps } from "../../domain/types";

export const DocumentListItem: React.FC<DocumentListItemProps> = ({
  title,
  categoryName,
  categoryColor,
  categoryIcon,
  projectName,
  projectColor,
  wordCount,
  isSelected,
  onClick,
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-lg transition-colors",
        isSelected
          ? "bg-primary/10 border border-primary/20"
          : "hover:bg-accent/50"
      )}
    >
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-medium truncate flex-1">{title}</p>
        {projectName && (
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 shrink-0 gap-1 font-normal"
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: projectColor || "#6366f1" }}
            />
            {projectName}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2 mt-1">
        {categoryName && (
          <span className="inline-flex items-center gap-1">
            {hasIcon(categoryIcon) ? (
              <DynamicIcon name={categoryIcon} className="w-2.5 h-2.5" style={{ color: categoryColor || "#8b5cf6" }} />
            ) : (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: categoryColor || "#8b5cf6" }}
              />
            )}
            <span className="text-xs text-muted-foreground">{categoryName}</span>
          </span>
        )}
        {wordCount !== null && wordCount !== undefined && (
          <span className="text-xs text-muted-foreground">{wordCount}w</span>
        )}
      </div>
    </button>
  );
};
