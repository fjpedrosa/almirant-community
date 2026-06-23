"use client";

import { useTranslations } from "next-intl";
import { Check, FolderOpen, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { IdeaInlineProjectProps } from "../../domain/types";

export const IdeaInlineProject: React.FC<IdeaInlineProjectProps> = ({
  currentProjectId,
  currentProjectName,
  projects,
  onChange,
  isLoading = false,
}) => {
  const t = useTranslations("ideas.project");
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !currentProjectId && "text-muted-foreground",
          )}
        >
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          {currentProjectName ?? t("noProject")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={t("searchProject")} />
          <CommandList>
            <CommandEmpty>{t("noProjectsFound")}</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onChange(null)}>
                <span className="text-muted-foreground">{t("noProject")}</span>
                {!currentProjectId && (
                  <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                )}
              </CommandItem>
              {projects.map((project) => {
                const isSelected = project.id === currentProjectId;
                return (
                  <CommandItem
                    key={project.id}
                    onSelect={() => onChange(project.id)}
                  >
                    {project.name}
                    {isSelected && (
                      <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
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
