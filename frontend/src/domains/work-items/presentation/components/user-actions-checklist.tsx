import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChecklistItem {
  text: string;
  checked: boolean;
}

/**
 * Parse a markdown string into checklist items.
 * Supports:
 *  - `- [ ] text`  /  `- [x] text`  (GFM task list)
 *  - `- text`  /  `* text`          (plain bullets → treated as unchecked)
 */
const parseItems = (markdown: string): ChecklistItem[] => {
  const lines = markdown.split("\n");
  const items: ChecklistItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // GFM task list
    const taskMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      items.push({ checked: taskMatch[1] !== " ", text: taskMatch[2] });
      continue;
    }

    // Plain bullet
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      items.push({ checked: false, text: bulletMatch[1] });
      continue;
    }
  }

  return items;
};

/**
 * Rebuild the markdown string after toggling item at `index`.
 * Converts all items to GFM task-list format so state is persisted.
 */
const rebuildMarkdown = (items: ChecklistItem[]): string =>
  items.map((it) => `- [${it.checked ? "x" : " "}] ${it.text}`).join("\n");

interface UserActionsChecklistProps {
  markdown: string;
  onToggle: (updatedMarkdown: string) => void;
}

export const UserActionsChecklist: React.FC<UserActionsChecklistProps> = ({
  markdown,
  onToggle,
}) => {
  const [localItems, setLocalItems] = useState<ChecklistItem[]>(() =>
    parseItems(markdown)
  );

  // Sync local state when the prop changes (e.g. server response)
  useEffect(() => {
    setLocalItems(parseItems(markdown));
  }, [markdown]);

  const handleToggle = useCallback(
    (index: number) => {
      const updated = localItems.map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item
      );
      setLocalItems(updated);
      onToggle(rebuildMarkdown(updated));
    },
    [localItems, onToggle]
  );

  if (localItems.length === 0) {
    return (
      <p className="text-[12px] leading-[1.35] text-foreground/80">
        {markdown}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {localItems.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-1.5 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            handleToggle(i);
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
  );
};
