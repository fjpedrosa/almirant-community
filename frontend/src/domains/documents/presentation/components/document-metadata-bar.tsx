"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pin, PinOff, Pencil, Eye, Trash2, Check, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { DynamicIcon, hasIcon } from "@/lib/icon-map";
import { formatDistanceToNow } from "date-fns";
import type { DocumentMetadataBarProps } from "../../domain/types";

export const DocumentMetadataBar: React.FC<DocumentMetadataBarProps> = ({
  title,
  categoryName,
  categoryColor,
  categoryIcon,
  projectName,
  projectColor,
  wordCount,
  sizeBytes,
  updatedAt,
  isPinned,
  isEditing,
  projects,
  currentProjectId,
  onChangeProject,
  onToggleEdit,
  onTogglePin,
  onDelete,
}) => {
  const t = useTranslations("documents");
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b bg-card/50">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-sm font-semibold truncate">{title}</h2>
        {categoryName && (
          <span className="inline-flex items-center gap-1 shrink-0">
            {hasIcon(categoryIcon) ? (
              <DynamicIcon name={categoryIcon} className="w-3 h-3" style={{ color: categoryColor || "#8b5cf6" }} />
            ) : (
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: categoryColor || "#8b5cf6" }}
              />
            )}
            <span className="text-xs text-muted-foreground">{categoryName}</span>
          </span>
        )}
        <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-6 gap-1.5 px-2 text-xs font-medium shrink-0",
                "hover:bg-accent/50",
                !projectName && "text-muted-foreground"
              )}
            >
              {projectColor && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: projectColor }}
                />
              )}
              {!projectColor && <FolderKanban className="h-3 w-3 shrink-0" />}
              <span className="truncate max-w-[120px]">
                {projectName ?? t("form.noProject")}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-0" align="start">
            <Command>
              <CommandList>
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChangeProject(null);
                    setProjectPopoverOpen(false);
                  }}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="flex-1">{t("form.noProject")}</span>
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
                      setProjectPopoverOpen(false);
                    }}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
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
        <span className="text-xs text-muted-foreground shrink-0">
          {t("words", { count: wordCount ?? 0 })}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatSize(sizeBytes)}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onTogglePin} aria-label={isPinned ? "Unpin document" : "Pin document"}>
          {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleEdit} aria-label={isEditing ? "View document" : "Edit document"}>
          {isEditing ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete} aria-label="Delete document">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};
