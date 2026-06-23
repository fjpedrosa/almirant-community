"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { typeBadgeColors } from "./work-item-card";
import type { WorkItemType } from "../../domain/types";

interface ParentSelectorProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  parents: { id: string; title: string; type: WorkItemType }[];
  isLoading?: boolean;
  disabled?: boolean;
}

const typeGroupOrder: WorkItemType[] = ["epic", "feature", "story"];

// Note: typeLabels uses the workItemTypes namespace for headings

// Usage:
// <ParentSelector
//   value={selectedParentId}
//   onChange={(id) => setSelectedParentId(id)}
//   parents={availableParents}
//   isLoading={isLoadingParents}
//   disabled={isEpicType}
// />

export const ParentSelector: React.FC<ParentSelectorProps> = ({
  value,
  onChange,
  parents,
  isLoading = false,
  disabled = false,
}) => {
  const t = useTranslations("workItems.form");
  const tCommon = useTranslations("common");
  const tTypes = useTranslations("workItemTypes");
  const [open, setOpen] = useState(false);

  const selectedParent = parents.find((p) => p.id === value);

  const groupedParents = typeGroupOrder.reduce<
    Record<string, { id: string; title: string; type: WorkItemType }[]>
  >((acc, type) => {
    const items = parents.filter((p) => p.type === type);
    if (items.length > 0) {
      acc[type] = items;
    }
    return acc;
  }, {});

  const handleSelect = (parentId: string) => {
    onChange(parentId === value ? undefined : parentId);
    setOpen(false);
  };

  const handleClear = () => {
    onChange(undefined);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t("selectParentPlaceholder")}
          disabled={disabled || isLoading}
          className="w-full justify-between font-normal"
        >
          {isLoading ? (
            <span className="text-muted-foreground">{tCommon("loading")}</span>
          ) : selectedParent ? (
            <span className="flex items-center gap-2 truncate">
              <Badge
                variant="outline"
                className={cn("text-xs shrink-0", typeBadgeColors[selectedParent.type])}
              >
                {selectedParent.type}
              </Badge>
              <span className="truncate">{selectedParent.title}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t("selectParentPlaceholder")}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("searchItem")} />
          <CommandList>
            <CommandEmpty>{t("noItemsFound")}</CommandEmpty>

            <CommandGroup>
              <CommandItem onSelect={handleClear} className="text-muted-foreground">
                <X className="mr-2 h-4 w-4" />
                {t("noParent")}
                {!value && <Check className="ml-auto h-4 w-4" />}
              </CommandItem>
            </CommandGroup>

            {Object.entries(groupedParents).map(([type, items]) => (
              <CommandGroup key={type} heading={tTypes(type as WorkItemType)}>
                {items.map((parent) => (
                  <CommandItem
                    key={parent.id}
                    value={`${parent.type} ${parent.title}`}
                    onSelect={() => handleSelect(parent.id)}
                  >
                    <Badge
                      variant="outline"
                      className={cn("text-xs mr-2 shrink-0", typeBadgeColors[parent.type])}
                    >
                      {parent.type}
                    </Badge>
                    <span className="truncate">{parent.title}</span>
                    {value === parent.id && <Check className="ml-auto h-4 w-4 shrink-0" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
