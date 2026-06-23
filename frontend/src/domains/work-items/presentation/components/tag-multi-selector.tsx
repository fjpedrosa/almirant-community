"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
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
import { useTranslations } from "next-intl";

interface TagMultiSelectorProps {
  value: string[];
  onChange: (value: string[]) => void;
  tags: { id: string; name: string; color: string }[];
  isLoading?: boolean;
  onCreateTag?: (name: string, color: string) => Promise<string>;
  trigger?: React.ReactNode;
}

const TAG_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#6b7280",
];

// Usage:
// <TagMultiSelector
//   value={selectedTagIds}
//   onChange={(ids) => setSelectedTagIds(ids)}
//   tags={availableTags}
//   isLoading={isLoadingTags}
// />

export const TagMultiSelector: React.FC<TagMultiSelectorProps> = ({
  value,
  onChange,
  tags,
  isLoading = false,
  onCreateTag,
  trigger,
}) => {
  const t = useTranslations("workItems.tags");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#6366f1");
  const [isCreatingTag, setIsCreatingTag] = useState(false);

  const handleCreateNewTag = async () => {
    if (!onCreateTag || !newTagName.trim()) return;
    setIsCreatingTag(true);
    try {
      const newId = await onCreateTag(newTagName.trim(), newTagColor);
      onChange([...value, newId]);
      setNewTagName("");
      setNewTagColor("#6366f1");
      setCreatingNew(false);
    } catch {
      // Error handled by parent
    } finally {
      setIsCreatingTag(false);
    }
  };

  const handleSelect = (tagId: string) => {
    if (value.includes(tagId)) {
      onChange(value.filter((id) => id !== tagId));
    } else {
      onChange([...value, tagId]);
    }
  };

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {trigger || (
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={t("selectTags")}
              disabled={isLoading}
              className="w-full justify-between font-normal"
            >
              {isLoading ? (
                <span className="text-muted-foreground">{tCommon("loading")}</span>
              ) : value.length > 0 ? (
                <span className="text-muted-foreground">
                  {t("tagsSelected", { count: value.length })}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {t("selectTags")}
                </span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          )}
        </PopoverTrigger>

        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder={t("searchTag")} />
            <CommandList>
              <CommandEmpty>{t("noTagsFound")}</CommandEmpty>

              <CommandGroup>
                {tags.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => handleSelect(tag.id)}
                  >
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                    {value.includes(tag.id) && (
                      <Check className="ml-auto h-4 w-4 shrink-0" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>

              {onCreateTag && (
                <CommandGroup>
                  {!creatingNew ? (
                    <CommandItem
                      value="__create_new_tag__"
                      onSelect={() => setCreatingNew(true)}
                      className="text-muted-foreground"
                    >
                      <span className="text-sm">{t("createTagOption")}</span>
                    </CommandItem>
                  ) : (
                    <div className="p-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        placeholder={t("tagNamePlaceholder")}
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        className="w-full px-2 py-1 text-sm bg-background border border-border rounded"
                        onKeyDown={(e) => e.stopPropagation()}
                        autoFocus
                      />
                      <div className="flex gap-1 flex-wrap">
                        {TAG_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={cn(
                              "h-5 w-5 cursor-pointer rounded-full border-2 transition-transform",
                              newTagColor === color ? "border-foreground scale-110" : "border-transparent"
                            )}
                            style={{ backgroundColor: color }}
                            onClick={() => setNewTagColor(color)}
                          />
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => {
                            setCreatingNew(false);
                            setNewTagName("");
                          }}
                        >
                          {tCommon("cancel")}
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!newTagName.trim() || isCreatingTag}
                          onClick={handleCreateNewTag}
                        >
                          {isCreatingTag ? tCommon("creating") : tCommon("create")}
                        </Button>
                      </div>
                    </div>
                  )}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {value.map((tagId) => {
            const tag = tags.find((t) => t.id === tagId);
            if (!tag) return null;
            return (
              <Badge
                key={tag.id}
                variant="secondary"
                className="gap-1"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                  borderColor: `${tag.color}40`,
                }}
              >
                {tag.name}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(value.filter((id) => id !== tag.id));
                  }}
                />
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
};
