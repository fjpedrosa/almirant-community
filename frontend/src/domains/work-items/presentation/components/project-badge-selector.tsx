"use client";

import { useState } from "react";
import { Check, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface ProjectBadgeSelectorProps {
  projects: { id: string; name: string }[];
  currentProjectId: string | undefined;
  onChangeProject: (projectId: string | undefined) => void;
}

export const ProjectBadgeSelector: React.FC<ProjectBadgeSelectorProps> = ({
  projects,
  currentProjectId,
  onChangeProject,
}) => {
  const t = useTranslations("workItems.form");
  const [open, setOpen] = useState(false);

  const currentProject = projects.find((p) => p.id === currentProjectId);
  const displayLabel = currentProject?.name ?? t("fromBoard");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-7 gap-1.5 px-2 text-xs font-medium",
            "hover:bg-accent/50",
            !currentProject && "text-muted-foreground"
          )}
        >
          <FolderKanban className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[120px]">{displayLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandList>
            <CommandItem
              value="__none__"
              onSelect={() => {
                onChangeProject(undefined);
                setOpen(false);
              }}
              className="flex items-center gap-2 text-xs"
            >
              <span className="flex-1">{t("fromBoard")}</span>
              {!currentProjectId && (
                <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
            </CommandItem>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={project.name}
                onSelect={() => {
                  onChangeProject(project.id);
                  setOpen(false);
                }}
                className="flex items-center gap-2 text-xs"
              >
                <span className="flex-1 truncate">{project.name}</span>
                {project.id === currentProjectId && (
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
