"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { MentionMember } from "../../domain/types";

export interface MentionSuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface Props {
  items: MentionMember[];
  command: (attrs: { id: string; label: string }) => void;
}

export const MentionSuggestionList = forwardRef<MentionSuggestionListRef, Props>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const safeSelectedIndex =
      items.length === 0 ? -1 : Math.min(selectedIndex, items.length - 1);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) {
        command({ id: item.id, label: item.name || item.email });
      }
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (items.length === 0) return false;

        if (event.key === "ArrowUp") {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          selectItem(safeSelectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-lg border border-border bg-popover p-2 text-sm text-muted-foreground shadow-md">
          No se encontraron miembros
        </div>
      );
    }

    return (
      <div className="max-h-56 overflow-hidden overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
              index === safeSelectedIndex
                ? "bg-violet-500/20 text-violet-900 dark:bg-violet-500/35 dark:text-violet-50"
                : "hover:bg-violet-500/10 dark:hover:bg-violet-500/20"
            )}
            onMouseDown={(event) => {
              // Keep editor focus so TipTap suggestion doesn't close before select command runs.
              event.preventDefault();
              selectItem(index);
            }}
          >
            <Avatar className="h-6 w-6">
              {item.image && <AvatarImage src={item.image} alt={item.name} />}
              <AvatarFallback className="text-[10px]">
                {(item.name || item.email).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="truncate font-medium">
              {item.name || item.email}
            </span>
          </button>
        ))}
      </div>
    );
  }
);

MentionSuggestionList.displayName = "MentionSuggestionList";
