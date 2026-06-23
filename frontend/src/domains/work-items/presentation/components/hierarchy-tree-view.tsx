import { useState } from "react";
import { ChevronRight, ChevronDown, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  typeIcons,
  typeBadgeColors,
  priorityColors,
} from "./work-item-style";
import type { WorkItemWithRelations } from "../../domain/types";
import type { BoardColumn } from "@/domains/boards/domain/types";

interface HierarchyTreeViewProps {
  items: WorkItemWithRelations[];
  onNavigateToChild: (id: string) => void;
  onMoveChild?: (childId: string, columnId: string) => void;
  boardColumns?: BoardColumn[];
  depth?: number;
}

export const HierarchyTreeView: React.FC<HierarchyTreeViewProps> = ({
  items,
  onNavigateToChild,
  onMoveChild,
  boardColumns,
  depth = 0,
}) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {items.map((child) => {
        const Icon = typeIcons[child.type];
        const hasChildren = child.children && child.children.length > 0;
        const isCollapsed = collapsed[child.id] ?? true;

        return (
          <div key={child.id}>
            {/* Row */}
            <div
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group group/tree-item"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              {/* Collapse toggle or spacer */}
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleCollapse(child.id)}
                  className="h-5 w-5 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="h-5 w-5 shrink-0" />
              )}

              {/* Type icon badge */}
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1 py-0 h-5 shrink-0",
                  typeBadgeColors[child.type]
                )}
              >
                <Icon className="h-3 w-3" />
              </Badge>

              {/* Clickable title */}
              <button
                type="button"
                onClick={() => onNavigateToChild(child.id)}
                className="text-sm truncate flex-1 text-left hover:underline"
              >
                {child.title}
              </button>

              {/* Priority indicator */}
              <AlertCircle
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  priorityColors[child.priority]
                )}
              />

              {/* Column pill */}
              {child.columnName && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                  style={{
                    backgroundColor: `${child.columnColor}20`,
                    color: child.columnColor ?? undefined,
                  }}
                >
                  {child.columnName}
                </span>
              )}

              {/* Move to dropdown */}
              {onMoveChild && boardColumns && boardColumns.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px] touch-visible shrink-0 cursor-pointer"
                    >
                      Move to...
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[140px]">
                    {boardColumns.map((col) => (
                      <DropdownMenuItem
                        key={col.id}
                        onClick={() => onMoveChild(child.id, col.id)}
                        className="text-xs gap-2"
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: col.color }}
                        />
                        {col.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Recursively render nested children if expanded and they exist as full WorkItemWithRelations */}
            {/* Note: child.children is a summary array, not full WorkItemWithRelations, so we cannot recurse further */}
            {/* The tree only shows one level of children from the fetched data */}
          </div>
        );
      })}
    </div>
  );
};
