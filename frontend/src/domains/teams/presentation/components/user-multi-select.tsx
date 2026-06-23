"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { Check, ChevronsUpDown, X } from "lucide-react";

import { useTranslations } from "next-intl";
import type { UserMultiSelectProps } from "../../domain/types";

// Usage:
// <UserMultiSelect
//   availableUsers={teamMembers}
//   selectedUserIds={["user-1", "user-2"]}
//   onSelect={(id) => addAssignee(id)}
//   onRemove={(id) => removeAssignee(id)}
// />

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

export const UserMultiSelect: React.FC<UserMultiSelectProps> = ({
  availableUsers,
  selectedUserIds,
  onSelect,
  onRemove,
  placeholder,
  disabled = false,
}) => {
  const t = useTranslations("workItems.assignees");
  const [open, setOpen] = useState(false);

  const selectedUsers = availableUsers.filter((u) =>
    selectedUserIds.includes(u.id)
  );

  const handleSelect = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      onRemove(userId);
    } else {
      onSelect(userId);
    }
  };

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={placeholder ?? t("selectAssignees")}
            disabled={disabled}
            className="w-full justify-between font-normal h-auto min-h-9"
          >
            {selectedUsers.length > 0 ? (
              <span className="flex flex-wrap gap-1 py-0.5">
                {selectedUsers.map((user) => (
                  <Badge
                    key={user.id}
                    variant="secondary"
                    className="gap-1 pr-1 text-xs font-normal"
                  >
                    <Avatar className="size-4">
                      {user.image && (
                        <AvatarImage src={user.image} alt={user.name} />
                      )}
                      <AvatarFallback className="text-[8px]">
                        {getInitials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="max-w-[80px] truncate">{user.name}</span>
                    <X
                      className="h-3 w-3 shrink-0 cursor-pointer opacity-60 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(user.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          e.preventDefault();
                          onRemove(user.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={t("removeAssignee", { name: user.name })}
                    />
                  </Badge>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {placeholder ?? t("selectAssignees")}
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder={t("searchMembers")} />
            <CommandList>
              <CommandEmpty>{t("noMembersFound")}</CommandEmpty>

              <CommandGroup>
                {availableUsers.map((user) => (
                  <CommandItem
                    key={user.id}
                    value={`${user.name} ${user.email}`}
                    onSelect={() => handleSelect(user.id)}
                  >
                    <Avatar className="size-6 shrink-0">
                      {user.image && (
                        <AvatarImage src={user.image} alt={user.name} />
                      )}
                      <AvatarFallback className="text-[10px]">
                        {getInitials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-sm">{user.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </div>
                    {selectedUserIds.includes(user.id) && (
                      <Check className="ml-auto h-4 w-4 shrink-0" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
