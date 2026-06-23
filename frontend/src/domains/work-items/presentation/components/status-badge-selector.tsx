"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { BoardColumn } from "@/domains/boards/domain/types";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface StatusBadgeSelectorProps {
  columns: BoardColumn[];
  currentColumnId: string | null;
  onChangeColumn: (id: string) => void;
}

// Usage:
// <StatusBadgeSelector
//   columns={boardColumns}
//   currentColumnId={workItem.columnId}
//   onChangeColumn={(columnId) => moveWorkItem(columnId)}
// />

export const StatusBadgeSelector: React.FC<StatusBadgeSelectorProps> = ({
  columns,
  currentColumnId,
  onChangeColumn,
}) => {
  const [open, setOpen] = useState(false);

  const currentColumn = columns.find((c) => c.id === currentColumnId);

  if (!columns.length || !currentColumnId || !currentColumn) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-7 gap-1.5 px-2 text-xs font-medium",
            "hover:bg-accent/50"
          )}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: currentColumn.color }}
          />
          {currentColumn.name}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandList>
            {columns.map((column) => (
              <CommandItem
                key={column.id}
                value={column.name}
                onSelect={() => {
                  onChangeColumn(column.id);
                  setOpen(false);
                }}
                className="flex items-center gap-2 text-xs"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: column.color }}
                />
                <span className="flex-1">{column.name}</span>
                {column.id === currentColumnId && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
