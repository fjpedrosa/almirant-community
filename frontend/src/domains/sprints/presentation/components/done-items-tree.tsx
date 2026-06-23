import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { typeIcons, typeColors, priorityColors } from "@/domains/work-items/presentation/components/work-item-style";
import type { DoneItemTreeNode } from "../../application/utils/build-done-items-tree";
import type { WorkItemType, Priority } from "@/domains/work-items/domain/types";

interface DoneItemsTreeProps {
  items: DoneItemTreeNode[];
  isLoading: boolean;
}

const TreeNode: React.FC<{
  node: DoneItemTreeNode;
  collapsedIds: Set<string>;
  onToggle: (id: string) => void;
  depth: number;
}> = ({ node, collapsedIds, onToggle, depth }) => {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedIds.has(node.item.id);
  const Icon = typeIcons[node.item.type as WorkItemType];
  const color = typeColors[node.item.type as WorkItemType];

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 text-sm min-w-0",
          depth > 0 && "pl-3"
        )}
        style={{ paddingLeft: depth > 0 ? `${depth * 12}px` : undefined }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.item.id)}
            className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors"
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <Icon className={cn("h-3.5 w-3.5 shrink-0", color)} />
        {!hasChildren && (
          <div
            className={cn(
              "h-2 w-2 rounded-full shrink-0",
              priorityColors[node.item.priority as Priority]
                ? ""
                : "bg-slate-400"
            )}
            style={{
              backgroundColor:
                node.item.priority === "urgent"
                  ? "rgb(239 68 68)"
                  : node.item.priority === "high"
                    ? "rgb(249 115 22)"
                    : node.item.priority === "medium"
                      ? "rgb(234 179 8)"
                      : "rgb(96 165 250)",
            }}
          />
        )}
        <span
          className={cn(
            "truncate flex-1 min-w-0",
            node.isVirtualParent && "text-muted-foreground italic"
          )}
        >
          {node.item.title}
        </span>
      </div>
      {hasChildren && !isCollapsed && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.item.id}
              node={child}
              collapsedIds={collapsedIds}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const DoneItemsTree: React.FC<DoneItemsTreeProps> = ({
  items,
  isLoading,
}) => {
  const t = useTranslations("sprints.close");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const handleToggle = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 p-3 border rounded-lg bg-amber-500/10 border-amber-500/20">
        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
        <p className="text-sm text-amber-600">{t("noCompletedTasks")}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[250px] max-h-[250px]">
      <div className="space-y-0">
        {items.map((node) => (
          <TreeNode
            key={node.item.id}
            node={node}
            collapsedIds={collapsedIds}
            onToggle={handleToggle}
            depth={0}
          />
        ))}
      </div>
    </ScrollArea>
  );
};
