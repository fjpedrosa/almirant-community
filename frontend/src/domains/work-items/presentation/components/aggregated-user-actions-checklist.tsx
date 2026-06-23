import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChecklistItem {
  text: string;
  checked: boolean;
}

const parseItems = (markdown: string): ChecklistItem[] => {
  const lines = markdown.split("\n");
  const items: ChecklistItem[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const taskMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      items.push({ checked: taskMatch[1] !== " ", text: taskMatch[2] });
      continue;
    }
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      items.push({ checked: false, text: bulletMatch[1] });
    }
  }
  return items;
};

const rebuildMarkdown = (items: ChecklistItem[]): string =>
  items.map((it) => `- [${it.checked ? "x" : " "}] ${it.text}`).join("\n");

interface TaskGroup {
  itemId: string;
  taskId: string | null;
  items: ChecklistItem[];
  originalMarkdown: string;
}

interface AggregatedUserActionsChecklistProps {
  entries: { itemId: string; taskId: string | null; userActions: string }[];
  onToggle: (itemId: string, updatedMarkdown: string) => void;
}

export const AggregatedUserActionsChecklist: React.FC<AggregatedUserActionsChecklistProps> = ({
  entries,
  onToggle,
}) => {
  const [groups, setGroups] = useState<TaskGroup[]>(() =>
    entries.map((e) => ({
      itemId: e.itemId,
      taskId: e.taskId,
      items: parseItems(e.userActions),
      originalMarkdown: e.userActions,
    }))
  );

  useEffect(() => {
    setGroups(
      entries.map((e) => ({
        itemId: e.itemId,
        taskId: e.taskId,
        items: parseItems(e.userActions),
        originalMarkdown: e.userActions,
      }))
    );
  }, [entries]);

  const handleToggle = useCallback(
    (groupIdx: number, itemIdx: number) => {
      setGroups((prev) => {
        const updated = prev.map((g, gi) => {
          if (gi !== groupIdx) return g;
          const newItems = g.items.map((it, ii) =>
            ii === itemIdx ? { ...it, checked: !it.checked } : it
          );
          return { ...g, items: newItems };
        });
        const group = updated[groupIdx];
        onToggle(group.itemId, rebuildMarkdown(group.items));
        return updated;
      });
    },
    [onToggle]
  );

  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);
  if (totalItems === 0) return null;

  const showHeaders = groups.length > 1;

  return (
    <div className="space-y-2">
      {groups.map((group, gi) => {
        if (group.items.length === 0) return null;
        return (
          <div key={group.itemId}>
            {showHeaders && (
              <p className="text-[10px] font-semibold text-muted-foreground mb-1">
                {group.taskId ?? group.itemId.slice(0, 8)}
              </p>
            )}
            <ul className="space-y-1">
              {group.items.map((item, ii) => (
                <li
                  key={ii}
                  className="flex items-start gap-1.5 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggle(gi, ii);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors",
                      item.checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40 hover:border-primary/60"
                    )}
                  >
                    {item.checked && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span
                    className={cn(
                      "text-[12px] leading-[1.35]",
                      item.checked
                        ? "text-muted-foreground line-through"
                        : "text-foreground/80"
                    )}
                  >
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
};
