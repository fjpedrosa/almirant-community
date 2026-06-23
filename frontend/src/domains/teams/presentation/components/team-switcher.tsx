"use client";

import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, User, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { TeamSwitcherProps } from "../../domain/types";

const getInitials = (name: string): string =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

export const TeamSwitcher: React.FC<
  TeamSwitcherProps & { open: boolean; onOpenChange: (open: boolean) => void }
> = ({ teams, activeTeamId, isLoading, onSelectTeam, open, onOpenChange }) => {
  const t = useTranslations("teamSwitcher");

  const activeTeam = teams.find((team) => team.id === activeTeamId);
  const triggerLabel = activeTeam ? activeTeam.name : t("personal");

  if (isLoading) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs font-medium"
        disabled
      >
        <span className="truncate max-w-[120px]">{t("loading")}</span>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={t("switchTeam")}
          className="h-8 gap-1.5 text-xs font-medium"
        >
          {activeTeam ? (
            <Avatar className="size-5">
              {activeTeam.logo && (
                <AvatarImage src={activeTeam.logo} alt={activeTeam.name} />
              )}
              <AvatarFallback className="text-[10px]">
                {getInitials(activeTeam.name)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <User className="size-4 text-muted-foreground" />
          )}
          <span className="truncate max-w-[120px]">{triggerLabel}</span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("searchTeams")} />
          <CommandList>
            <CommandEmpty>{t("noTeamsFound")}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="personal"
                onSelect={() => {
                  onSelectTeam(null);
                  onOpenChange(false);
                }}
              >
                <User className="size-4 text-muted-foreground" />
                <span>{t("personal")}</span>
                {!activeTeamId && (
                  <Check className="ml-auto size-4 text-primary" />
                )}
              </CommandItem>
            </CommandGroup>
            {teams.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t("teams")}>
                  {teams.map((team) => (
                    <CommandItem
                      key={team.id}
                      value={team.name}
                      onSelect={() => {
                        onSelectTeam(team.id);
                        onOpenChange(false);
                      }}
                    >
                      <Avatar className="size-5">
                        {team.logo && (
                          <AvatarImage src={team.logo} alt={team.name} />
                        )}
                        <AvatarFallback className="text-[10px]">
                          {getInitials(team.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">{team.name}</span>
                      {activeTeamId === team.id && (
                        <Check className="ml-auto size-4 text-primary" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            {teams.length === 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="create-team" disabled>
                    <Plus className="size-4" />
                    <span>{t("createTeam")}</span>
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
