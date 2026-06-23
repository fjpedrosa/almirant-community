"use client";

import { useState } from "react";
import { Check, Loader2, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { IdeaInlineOwnerProps } from "../../domain/types";

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

export const IdeaInlineOwner: React.FC<IdeaInlineOwnerProps> = ({
  currentOwnerId,
  members,
  onChange,
  isLoading = false,
}) => {
  const t = useTranslations("ideas");

  const currentOwner = currentOwnerId
    ? members.find((m) => m.id === currentOwnerId)
    : null;

  const [open, setOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {currentOwner ? (
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage
                    src={currentOwner.image ?? undefined}
                    alt={currentOwner.name}
                  />
                  <AvatarFallback className="text-[10px]">
                    {getInitials(currentOwner.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm">{currentOwner.name}</span>
              </button>
            ) : (
              <button
                type="button"
                className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60">
                  <User className="h-3 w-3" />
                </div>
                <span className="text-sm text-muted-foreground">{t("owner.unassigned")}</span>
              </button>
            )}
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {currentOwner ? t("owner.changeOwner") : t("owner.assignOwner")}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="w-56 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t("owner.searchMember")} />
          <CommandList>
            <CommandEmpty>{t("owner.noMembersFound")}</CommandEmpty>
            <CommandGroup>
              {members.map((member) => {
                const isSelected = member.id === currentOwnerId;
                return (
                  <CommandItem
                    key={member.id}
                    onSelect={() => {
                      onChange(member.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Avatar className="h-6 w-6 shrink-0">
                      {member.image && (
                        <AvatarImage src={member.image} alt={member.name} />
                      )}
                      <AvatarFallback className="text-[10px]">
                        {getInitials(member.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{member.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {member.email}
                      </span>
                    </div>
                    {isSelected && (
                      <Check className={cn("ml-auto h-4 w-4 shrink-0 text-primary")} />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
