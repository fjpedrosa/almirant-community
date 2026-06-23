"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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
import { Check, ChevronsUpDown } from "lucide-react";
import type { OwnerMultiSelectFilterProps } from "../../../domain/types";

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

export const OwnerMultiSelectFilter: React.FC<OwnerMultiSelectFilterProps> = ({
  owners,
  selectedOwnerIds,
  onChange,
  placeholder: placeholderProp,
}) => {
  const t = useTranslations("shared.filters");
  const placeholder = placeholderProp ?? t("allOwners");
  const [open, setOpen] = useState(false);

  const selectedOwners = owners.filter((o) =>
    selectedOwnerIds.includes(o.id)
  );

  const handleToggle = (ownerId: string) => {
    if (selectedOwnerIds.includes(ownerId)) {
      const next = selectedOwnerIds.filter((id) => id !== ownerId);
      onChange(next.length > 0 ? next : []);
    } else {
      onChange([...selectedOwnerIds, ownerId]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[180px] justify-between font-normal h-9 px-3"
        >
          {selectedOwners.length > 0 ? (
            <span className="flex items-center gap-1 truncate">
              {selectedOwners.length === 1 ? (
                <span className="truncate text-sm">{selectedOwners[0].name}</span>
              ) : (
                <span className="text-sm">
                  {t("ownerCount", { count: selectedOwners.length })}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[240px] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("searchOwner")} />
          <CommandList>
            <CommandEmpty>{t("noOwnersFound")}</CommandEmpty>

            <CommandGroup>
              {owners.map((owner) => (
                <CommandItem
                  key={owner.id}
                  value={`${owner.name} ${owner.email ?? ""}`}
                  onSelect={() => handleToggle(owner.id)}
                >
                  <Avatar className="size-5 shrink-0">
                    {owner.image && (
                      <AvatarImage src={owner.image} alt={owner.name} />
                    )}
                    <AvatarFallback className="text-[8px]">
                      {getInitials(owner.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm">{owner.name}</span>
                  {selectedOwnerIds.includes(owner.id) && (
                    <Check className="ml-auto h-4 w-4 shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
