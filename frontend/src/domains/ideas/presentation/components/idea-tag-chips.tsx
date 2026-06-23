"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
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
import type { IdeaTagChipsProps } from "../../domain/types";

/**
 * Helper to generate a random pastel hex color for new tags.
 */
const PALETTE = [
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#f43f5e", "#ef4444", "#f97316", "#eab308", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6d28d9",
];

const pickRandomColor = (): string =>
  PALETTE[Math.floor(Math.random() * PALETTE.length)];

/**
 * Convert a hex color to an rgba string with a given alpha for chip backgrounds.
 */
const hexToRgba = (hex: string, alpha: number): string => {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(100,100,100,${alpha})`;
  }
  return `rgba(${r},${g},${b},${alpha})`;
};

/**
 * IdeaTagChips - Inline tag management component for ideas.
 *
 * Displays current tags as colored chips. In full mode (default), each chip has
 * a remove "x" button and a "+" button opens a Command popover to search, select,
 * or create new tags. In compact mode (`isCompact`), chips are smaller and
 * read-only (no add/remove controls).
 *
 * Usage:
 * ```tsx
 * <IdeaTagChips
 *   tags={item.tags}
 *   availableTags={allTags}
 *   onAddTag={(data) => handleAddTag(item.id, data)}
 *   onRemoveTag={(tagId) => handleRemoveTag(item.id, tagId)}
 * />
 *
 * // Compact mode (read-only, smaller)
 * <IdeaTagChips
 *   tags={item.tags}
 *   availableTags={[]}
 *   onAddTag={() => {}}
 *   onRemoveTag={() => {}}
 *   isCompact
 * />
 * ```
 */
export const IdeaTagChips: React.FC<IdeaTagChipsProps> = ({
  tags,
  availableTags,
  onAddTag,
  onRemoveTag,
  isCompact = false,
}) => {
  const t = useTranslations("ideas.tags");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const assignedIds = new Set(tags.map((tag) => tag.id));
  const unassigned = availableTags.filter((tag) => !assignedIds.has(tag.id));

  const trimmedSearch = search.trim();
  const exactMatch = availableTags.some(
    (tag) => tag.name.toLowerCase() === trimmedSearch.toLowerCase(),
  );
  const showCreate = trimmedSearch.length > 0 && !exactMatch;

  const handleSelect = (tagId: string) => {
    onAddTag({ tagId });
    setSearch("");
    setOpen(false);
  };

  const handleCreate = () => {
    const color = pickRandomColor();
    onAddTag({ name: trimmedSearch, color });
    setSearch("");
    setOpen(false);
  };

  // -- Compact mode: small read-only chips --
  if (isCompact) {
    if (tags.length === 0) return null;
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {tags.map((tag) => {
          const bg = tag.color ? hexToRgba(tag.color, 0.15) : undefined;
          const textColor = tag.color ?? undefined;
          return (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium leading-4"
              style={{
                backgroundColor: bg,
                color: textColor,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: tag.color ?? "#999" }}
              />
              {tag.name}
            </span>
          );
        })}
      </div>
    );
  }

  // -- Full mode: chips with remove + add popover --
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tags.map((tag) => {
        const bg = tag.color ? hexToRgba(tag.color, 0.15) : undefined;
        const textColor = tag.color ?? undefined;
        return (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: bg,
              color: textColor,
            }}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: tag.color ?? "#999" }}
            />
            {tag.name}
            <button
              type="button"
              className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTag(tag.id);
              }}
              aria-label={t("removeTag", { name: tag.name })}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            onClick={(e) => e.stopPropagation()}
            aria-label={t("addTag")}
          >
            <Plus className="h-3 w-3" />
            <span className="sr-only">{t("addTag")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={t("searchOrCreate")}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {unassigned.filter((tag) =>
                tag.name.toLowerCase().includes(trimmedSearch.toLowerCase()),
              ).length === 0 && !showCreate ? (
                <CommandEmpty>{t("noTagsAvailable")}</CommandEmpty>
              ) : null}

              {unassigned.filter((tag) =>
                tag.name.toLowerCase().includes(trimmedSearch.toLowerCase()),
              ).length > 0 && (
                <CommandGroup heading={t("existingTags")}>
                  {unassigned
                    .filter((tag) =>
                      tag.name.toLowerCase().includes(trimmedSearch.toLowerCase()),
                    )
                    .map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => handleSelect(tag.id)}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color ?? "#999" }}
                        />
                        {tag.name}
                      </CommandItem>
                    ))}
                </CommandGroup>
              )}

              {showCreate && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem onSelect={handleCreate}>
                      <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>
                        {t("createTag", { name: trimmedSearch })}
                      </span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
};
