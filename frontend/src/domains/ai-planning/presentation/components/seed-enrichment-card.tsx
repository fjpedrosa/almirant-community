"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare, Notebook, User, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SeedEnrichmentCardProps } from "@/domains/ai-planning/domain/types";

const MAX_VISIBLE_TAGS = 3;

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

export const SeedEnrichmentCard: React.FC<SeedEnrichmentCardProps> = ({
  seed,
  annotation,
  onAnnotationChange,
  onSeedClick,
  onRemove,
  defaultExpanded = false,
}) => {
  const t = useTranslations("aiPlanning.seedEnrichmentCard");
  const hasAnnotation = annotation.length > 0;
  const [isNoteOpen, setIsNoteOpen] = useState(
    defaultExpanded || hasAnnotation,
  );
  const [hasAutoFocused, setHasAutoFocused] = useState(
    defaultExpanded || hasAnnotation,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on first expansion
  useEffect(() => {
    if (isNoteOpen && !hasAutoFocused) {
      // Wait for the CSS grid-rows transition to finish so the textarea is visible
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 200);
      setHasAutoFocused(true);
      return () => clearTimeout(timer);
    }
  }, [isNoteOpen, hasAutoFocused]);

  const handleNoteToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsNoteOpen((prev) => !prev);
    },
    [],
  );

  const handleTextareaClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      e.stopPropagation();
    },
    [],
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove(seed.id);
    },
    [onRemove, seed.id],
  );

  const tags = seed.tags ?? [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowCount = Math.max(0, tags.length - MAX_VISIBLE_TAGS);

  return (
    <div
      className="group relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-accent/30"
      onClick={() => onSeedClick(seed)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSeedClick(seed);
        }
      }}
      aria-label={`Seed: ${seed.title}`}
    >
      {/* Remove button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute right-1 top-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            onClick={handleRemove}
            aria-label={t("removeSeedAriaLabel")}
          >
            <X className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{t("remove")}</TooltipContent>
      </Tooltip>

      {/* Title */}
      <span
        className="pr-6 text-sm font-semibold leading-tight line-clamp-2"
        title={seed.title}
      >
        {seed.title}
      </span>

      {/* Description preview */}
      {seed.description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {seed.description}
        </p>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {visibleTags.map((tag) => (
            <Badge
              key={tag.id}
              variant="outline"
              className="px-1.5 py-0 text-[10px]"
              style={
                tag.color
                  ? { borderColor: tag.color, color: tag.color }
                  : undefined
              }
            >
              {tag.name}
            </Badge>
          ))}
          {overflowCount > 0 && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              +{overflowCount}
            </Badge>
          )}
        </div>
      )}

      {/* Footer: owner + comment count */}
      <div className="mt-auto flex items-center gap-2">
        {seed.owner ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1.5">
                <Avatar className="size-5">
                  <AvatarImage
                    src={seed.owner.image ?? undefined}
                    alt={seed.owner.name}
                  />
                  <AvatarFallback className="text-[9px]">
                    {getInitials(seed.owner.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-xs text-muted-foreground">
                  {seed.owner.name}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{seed.owner.name}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/60">
              <User className="size-2.5" />
            </span>
            <span className="text-xs text-muted-foreground">{t("unassigned")}</span>
          </span>
        )}

        <span className="flex-1" />

        {(seed.commentCount ?? 0) > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <MessageSquare className="size-3" />
                {seed.commentCount}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t("commentCount", { count: seed.commentCount ?? 0 })}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* "Nota para la IA" — expandable annotation */}
      <div
        className="border-t pt-1"
        onClick={handleTextareaClick}
        onKeyDown={handleTextareaKeyDown}
        role="presentation"
      >
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={handleNoteToggle}
          aria-expanded={isNoteOpen}
        >
          <Notebook className="size-3.5" />
          <span>{t("noteForAi")}</span>
          {hasAnnotation && (
            <span className="ml-auto size-1.5 rounded-full bg-primary" />
          )}
        </button>

        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-in-out",
            isNoteOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <Textarea
              ref={textareaRef}
              value={annotation}
              onChange={(e) => onAnnotationChange(seed.id, e.target.value)}
              onClick={handleTextareaClick}
              onKeyDown={handleTextareaKeyDown}
              placeholder={t("annotationPlaceholder")}
              className="mt-1 min-h-[60px] resize-none text-xs"
              rows={3}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
