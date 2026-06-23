import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { typeIcons, typeColors } from "./work-item-style";
import type { AncestorInfo } from "../../domain/types";

interface ParentHierarchyBreadcrumbProps {
  segments: AncestorInfo[];
  onSegmentClick?: (id: string) => void;
}

export const ParentHierarchyBreadcrumb = ({
  segments,
  onSegmentClick,
}: ParentHierarchyBreadcrumbProps) => {
  if (segments.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground min-w-0">
      {segments.map((segment, index) => {
        const Icon = typeIcons[segment.type];
        return (
          <div key={segment.id} className="flex items-center gap-1 min-w-0">
            {index > 0 && (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
            )}
            <Icon className={cn("h-3 w-3 shrink-0", typeColors[segment.type])} />
            {segment.taskId && (
              <span className="font-mono text-[10px] shrink-0">
                {segment.taskId}
              </span>
            )}
            <button
              type="button"
              onClick={() => onSegmentClick?.(segment.id)}
              className="truncate max-w-[200px] hover:underline hover:text-foreground transition-colors"
            >
              {segment.title}
            </button>
          </div>
        );
      })}
    </nav>
  );
};
