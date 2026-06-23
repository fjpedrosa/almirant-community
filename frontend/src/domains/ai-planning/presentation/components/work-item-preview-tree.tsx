import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { typeBadgeColors } from "@/domains/work-items/presentation/components/work-item-style";
import type { WorkItemPreview, WorkItemPreviewTreeProps } from "../../domain/types";

// Usage:
// <WorkItemPreviewTree
//   items={previewItems}
//   onUpdateItem={(tempId, changes) => updateItem(tempId, changes)}
//   onRemoveItem={(tempId) => removeItem(tempId)}
// />

interface TreeNode extends WorkItemPreview {
  children: TreeNode[];
  depth: number;
}

function buildTree(items: WorkItemPreview[]): TreeNode[] {
  const visibleItems = items.filter((item) => !item.isRemoved);
  const nodeMap = new Map<string, TreeNode>();

  for (const item of visibleItems) {
    nodeMap.set(item.tempId, { ...item, children: [], depth: 0 });
  }

  const roots: TreeNode[] = [];

  for (const node of nodeMap.values()) {
    if (node.parentTempId && nodeMap.has(node.parentTempId)) {
      const parent = nodeMap.get(node.parentTempId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepths(nodes: TreeNode[], depth: number): void {
    for (const node of nodes) {
      node.depth = depth;
      setDepths(node.children, depth + 1);
    }
  }

  setDepths(roots, 0);

  return roots;
}

interface PreviewNodeProps {
  node: TreeNode;
  editingId: string | null;
  editingTitle: string;
  expandedIds: Set<string>;
  onStartEdit: (tempId: string, currentTitle: string) => void;
  onConfirmEdit: (tempId: string) => void;
  onCancelEdit: () => void;
  onEditingTitleChange: (value: string) => void;
  onToggleExpand: (tempId: string) => void;
  onRemoveItem: (tempId: string) => void;
  readOnly?: boolean;
}

const PreviewNode: React.FC<PreviewNodeProps> = ({
  node,
  editingId,
  editingTitle,
  expandedIds,
  onStartEdit,
  onConfirmEdit,
  onCancelEdit,
  onEditingTitleChange,
  onToggleExpand,
  onRemoveItem,
  readOnly,
}) => {
  const t = useTranslations("aiPlanning");
  const isEditing = !readOnly && editingId === node.tempId;
  const isExpanded = expandedIds.has(node.tempId);
  const hasDescription = Boolean(node.description);

  return (
    <div style={{ marginLeft: `${node.depth * 20}px` }}>
      <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
        {/* Type badge */}
        <Badge className={cn("text-[10px] uppercase tracking-wider px-1.5 py-0", typeBadgeColors[node.type])}>
          {node.type}
        </Badge>

        {/* Title: inline-editable */}
        {isEditing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <Input
              value={editingTitle}
              onChange={(e) => onEditingTitleChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onConfirmEdit(node.tempId);
                if (e.key === "Escape") onCancelEdit();
              }}
              className="h-7 text-sm flex-1"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onConfirmEdit(node.tempId)}
              aria-label={t("editTitle")}
              className="size-8"
            >
              <Check className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onCancelEdit}
              aria-label={t("cancel")}
              className="size-8"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ) : readOnly ? (
          <span className="flex-1 min-w-0 text-left text-sm truncate">
            {node.title}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onStartEdit(node.tempId, node.title)}
            className="flex-1 min-w-0 text-left text-sm truncate cursor-text hover:underline decoration-dashed underline-offset-2"
            title={t("editTitle")}
          >
            {node.title}
          </button>
        )}

        {/* Description expand toggle */}
        {hasDescription && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onToggleExpand(node.tempId)}
            aria-label={t("expandDescription")}
            className="size-8 text-muted-foreground"
          >
            {isExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </Button>
        )}

        {/* Delete button (hidden in readOnly mode) */}
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onRemoveItem(node.tempId)}
            aria-label={t("removeItem")}
            className="size-8 text-muted-foreground touch-visible hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Expandable description */}
      {hasDescription && isExpanded && (
        <div
          className="text-xs text-muted-foreground whitespace-pre-wrap rounded-md bg-muted/30 px-3 py-2 mb-1"
          style={{ marginLeft: `${node.depth * 20 + 12}px` }}
        >
          {node.description}
        </div>
      )}

      {/* Children */}
      {node.children.map((child) => (
        <PreviewNode
          key={child.tempId}
          node={child}
          editingId={editingId}
          editingTitle={editingTitle}
          expandedIds={expandedIds}
          onStartEdit={onStartEdit}
          onConfirmEdit={onConfirmEdit}
          onCancelEdit={onCancelEdit}
          onEditingTitleChange={onEditingTitleChange}
          onToggleExpand={onToggleExpand}
          onRemoveItem={onRemoveItem}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
};

export const WorkItemPreviewTree: React.FC<WorkItemPreviewTreeProps> = ({
  items,
  onUpdateItem,
  onRemoveItem,
  readOnly,
}) => {
  const t = useTranslations("aiPlanning");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const tree = buildTree(items);

  const handleStartEdit = (tempId: string, currentTitle: string) => {
    setEditingId(tempId);
    setEditingTitle(currentTitle);
  };

  const handleConfirmEdit = (tempId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed && trimmed !== items.find((i) => i.tempId === tempId)?.title) {
      onUpdateItem(tempId, { title: trimmed });
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const handleToggleExpand = (tempId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) {
        next.delete(tempId);
      } else {
        next.add(tempId);
      }
      return next;
    });
  };

  if (tree.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        {t("noItems")}
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map((node) => (
        <PreviewNode
          key={node.tempId}
          node={node}
          editingId={editingId}
          editingTitle={editingTitle}
          expandedIds={expandedIds}
          onStartEdit={handleStartEdit}
          onConfirmEdit={handleConfirmEdit}
          onCancelEdit={handleCancelEdit}
          onEditingTitleChange={setEditingTitle}
          onToggleExpand={handleToggleExpand}
          onRemoveItem={onRemoveItem}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
};
