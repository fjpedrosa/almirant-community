"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Filter, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OwnerMultiSelectFilter } from "@/domains/shared/presentation/components/filters/owner-multi-select-filter";
import type { IdeaItemStatus, IdeaItemType, IdeasFilterBarProps } from "../../domain/types";
import { getStatusLabels } from "./idea-inline-status";

const IDEA_TYPE_OPTIONS: IdeaItemType[] = ["idea"];
const IDEA_STATUS_OPTIONS: IdeaItemStatus[] = ["draft", "active", "to_review", "approved", "archived", "rejected"];

export const IdeasFilterBar: React.FC<IdeasFilterBarProps> = ({
  filters,
  hasActiveFilters,
  activeFilters,
  owners,
  projects,
  tags,
  hideTypeFilter,
  onSearchChange,
  onTypeChange,
  onStatusChange,
  onOwnerChange,
  onProjectChange,
  onDueDateChange,
  onDiscussedChange,
  onMentionedChange,
  onTagChange,
  onClearFilters,
  onRemoveFilter,
}) => {
  const t = useTranslations("ideas");
  const STATUS_LABELS = getStatusLabels(t);

  const resolveFilterValue = (filter: { key: string; value: string }) => {
    if (filter.key === "ownerUserId") {
      return owners.find((o) => o.id === filter.value)?.name ?? filter.value;
    }
    if (filter.key === "projectId") {
      return projects.find((p) => p.id === filter.value)?.name ?? filter.value;
    }
    if (filter.key === "tagIds" && tags) {
      const values = filter.value.split(",").filter(Boolean);
      if (values.length === 0) return filter.value;
      const labels = values.map((id) => tags.find((tag) => tag.id === id)?.name ?? id);
      return labels.join(", ");
    }
    return filter.value;
  };

  const [searchValue, setSearchValue] = useState(filters.search ?? "");
  const [isLocalEdit, setIsLocalEdit] = useState(false);

  useEffect(() => {
    if (!isLocalEdit) return;
    const timer = setTimeout(() => {
      onSearchChange(searchValue);
      setIsLocalEdit(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [isLocalEdit, onSearchChange, searchValue]);

  const displayValue = isLocalEdit ? searchValue : (filters.search ?? "");

  const selectedOwnerIds = useMemo(
    () =>
      filters.ownerUserId
        ? filters.ownerUserId.split(",").filter(Boolean)
        : [],
    [filters.ownerUserId]
  );
  const selectedTagIds = useMemo(
    () => filters.tagIds ?? [],
    [filters.tagIds],
  );

  const handleOwnerMultiChange = (ids: string[]) => {
    onOwnerChange(ids.length > 0 ? ids.join(",") : undefined);
  };

  const handleToggleTag = (tagId: string) => {
    if (selectedTagIds.includes(tagId)) {
      const next = selectedTagIds.filter((id) => id !== tagId);
      onTagChange(next.length > 0 ? next : undefined);
      return;
    }
    onTagChange([...selectedTagIds, tagId]);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={displayValue}
            placeholder={t("filterBar.searchPlaceholder")}
            className="pl-9 pr-9"
            onChange={(event) => {
              setSearchValue(event.target.value);
              setIsLocalEdit(true);
            }}
          />
          {displayValue && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchValue("");
                setIsLocalEdit(false);
                onSearchChange("");
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {!hideTypeFilter && (
          <Select
            value={filters.type || "all"}
            onValueChange={(value) =>
              onTypeChange(value === "all" ? undefined : (value as IdeaItemType))
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder={t("filterBar.type")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterBar.allTypes")}</SelectItem>
              {IDEA_TYPE_OPTIONS.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`types.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select
          value={filters.status || "all"}
          onValueChange={(value) =>
            onStatusChange(value === "all" ? undefined : (value as IdeaItemStatus))
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder={t("filterBar.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterBar.allStatuses")}</SelectItem>
            {IDEA_STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <OwnerMultiSelectFilter
          owners={owners}
          selectedOwnerIds={selectedOwnerIds}
          onChange={handleOwnerMultiChange}
        />

        <Select
          value={filters.projectId || "all"}
          onValueChange={(value) => onProjectChange(value === "all" ? undefined : value)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("filterBar.project")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterBar.allProjects")}</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              className="h-9 w-[180px] justify-between font-normal"
            >
              {selectedTagIds.length > 0 ? (
                selectedTagIds.length === 1
                  ? (tags ?? []).find((tag) => tag.id === selectedTagIds[0])?.name ?? t("filterBar.tag")
                  : `${selectedTagIds.length} tags`
              ) : (
                <span className="text-muted-foreground">{t("filterBar.allTags")}</span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[240px] p-0" align="start">
            <Command>
              <CommandInput placeholder={t("filterBar.tag")} />
              <CommandList>
                <CommandEmpty>{t("filterBar.allTags")}</CommandEmpty>
                <CommandGroup>
                  {(tags ?? []).map((tag) => (
                    <CommandItem
                      key={tag.id}
                      value={tag.name}
                      onSelect={() => handleToggleTag(tag.id)}
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="truncate">{tag.name}</span>
                      {selectedTagIds.includes(tag.id) && (
                        <Check className="ml-auto h-4 w-4 shrink-0" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Input
          type="date"
          className="w-[170px]"
          value={filters.dueDate ?? ""}
          onChange={(event) => onDueDateChange(event.target.value || undefined)}
        />

        <Select
          value={filters.discussed === undefined ? "all" : filters.discussed ? "true" : "false"}
          onValueChange={(value) =>
            onDiscussedChange(value === "all" ? undefined : value === "true")
          }
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder={t("filterBar.discussed")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterBar.allDiscussed")}</SelectItem>
            <SelectItem value="true">{t("filterBar.discussedOnly")}</SelectItem>
            <SelectItem value="false">{t("filterBar.notDiscussed")}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.mentionedUserId ? "me" : "all"}
          onValueChange={(value) =>
            onMentionedChange(value === "all" ? undefined : value)
          }
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder={t("filterBar.mentioned")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterBar.noMentionFilter")}</SelectItem>
            <SelectItem value="me">{t("filterBar.myMentions")}</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            <X className="h-4 w-4 mr-1" />
            {t("filterBar.clearFilters")}
          </Button>
        )}
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {activeFilters.map((filter) => (
            <Badge key={filter.key} variant="secondary" className="gap-1 pr-1">
              <span className="text-muted-foreground">{filter.label}:</span>
              <span>{resolveFilterValue(filter)}</span>
              <button
                className="ml-1 rounded-full p-0.5 hover:bg-muted"
                onClick={() => onRemoveFilter(filter.key)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};
