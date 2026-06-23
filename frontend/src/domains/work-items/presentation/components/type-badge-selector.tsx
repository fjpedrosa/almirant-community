"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { typeBadgeColors } from "./work-item-card";
import type { WorkItemType } from "../../domain/types";

interface TypeBadgeSelectorProps {
  value: WorkItemType;
  onChange: (value: WorkItemType) => void;
  availableTypes: WorkItemType[];
}

export const TypeBadgeSelector: React.FC<TypeBadgeSelectorProps> = ({
  value,
  onChange,
  availableTypes,
}) => {
  const tTypes = useTranslations("workItemTypes");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "cursor-pointer select-none",
            typeBadgeColors[value]
          )}
        >
          {tTypes(value)}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-0" align="start">
        <Command>
          <CommandList>
            {availableTypes.map((type) => (
              <CommandItem
                key={type}
                value={type}
                onSelect={() => {
                  onChange(type);
                  setOpen(false);
                }}
                className="flex items-center gap-2"
              >
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    typeBadgeColors[type]
                  )}
                />
                {tTypes(type)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
