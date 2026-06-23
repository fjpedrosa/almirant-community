"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, Filter, Search, X } from "lucide-react";
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
import type {
  SeedStatus,
  SeedSource,
  SeedPriority,
  SeedFilters,
} from "@/domains/planning/domain/types";
import type { SeedsFilterBarProps } from "../../domain/types";
import {
  getSeedSourceLabel,
  getSeedStatusLabel,
} from "./seed-inline-status";

const SEED_STATUS_OPTIONS: SeedStatus[] = [
  "draft",
  "active",
  "to_review",
  "approved",
  "archived",
  "rejected",
];

const SEED_SOURCE_OPTIONS: SeedSource[] = [
  "manual",
  "feedback",
  "ai_generated",
  "import",
];

const SEED_PRIORITY_OPTIONS: SeedPriority[] = [
  "low",
  "medium",
  "high",
  "urgent",
];

export const SeedsFilterBar: React.FC<SeedsFilterBarProps> = ({
  filters,
  hasActiveFilters,
  activeFilters,
  owners,
  projects,
  tags,
  hideStatusFilter,
  onSearchChange,
  onStatusChange,
  onSourceChange,
  onPriorityChange,
  onOwnerChange,
  onProjectChange,
  onTagChange,
  onSelectedForIdeationChange,
  onClearFilters,
  onRemoveFilter,
}) => {
  const t = useTranslations("seeds.filters");
  const tp = useTranslations("seeds.priority");
  const ts = useTranslations("seeds");

  const resolveFilterValue = (filter: {
    key: keyof SeedFilters;
    value: string;
  }) => {
    if (filter.key === "ownerUserId") {
      return owners.find((o) => o.id === filter.value)?.name ?? filter.value;
    }
    if (filter.key === "projectId") {
      return projects.find((p) => p.id === filter.value)?.name ?? filter.value;
    }
    if (filter.key === "tagId" && tags) {
      return tags.find((tag) => tag.id === filter.value)?.name ?? filter.value;
    }
    if (filter.key === "status") {
      return getSeedStatusLabel(filter.value as SeedStatus, ts);
    }
    if (filter.key === "source") {
      return getSeedSourceLabel(filter.value as SeedSource, ts);
    }
    if (filter.key === "priority") {
      return tp(filter.value as SeedPriority);
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div className="relative min-w-[240px] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={displayValue}
            placeholder={t("searchSeeds")}
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

        {/* Status filter (hidden when tabs control status grouping) */}
        {!hideStatusFilter && (
          <Select
            value={filters.status || "all"}
            onValueChange={(value) =>
              onStatusChange(value === "all" ? undefined : (value as SeedStatus))
            }
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder={t("status")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              {SEED_STATUS_OPTIONS.map((status) => (
                <SelectItem key={status} value={status}>
                  {getSeedStatusLabel(status, ts)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Source filter */}
        <Select
          value={filters.source || "all"}
          onValueChange={(value) =>
            onSourceChange(value === "all" ? undefined : (value as SeedSource))
          }
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder={t("source")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allSources")}</SelectItem>
            {SEED_SOURCE_OPTIONS.map((source) => (
              <SelectItem key={source} value={source}>
                {getSeedSourceLabel(source, ts)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Priority filter */}
        <Select
          value={filters.priority || "all"}
          onValueChange={(value) =>
            onPriorityChange(
              value === "all" ? undefined : (value as SeedPriority),
            )
          }
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder={t("priority")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            {SEED_PRIORITY_OPTIONS.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {tp(priority)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Owner filter */}
        <Select
          value={filters.ownerUserId || "all"}
          onValueChange={(value) =>
            onOwnerChange(value === "all" ? undefined : value)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("owner")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allOwners")}</SelectItem>
            {owners.map((owner) => (
              <SelectItem key={owner.id} value={owner.id}>
                {owner.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Project filter */}
        <Select
          value={filters.projectId || "all"}
          onValueChange={(value) =>
            onProjectChange(value === "all" ? undefined : value)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("project")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allProjects")}</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Tag filter (single select via Popover/Command) */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              className="h-9 w-[180px] justify-between font-normal"
            >
              {filters.tagId ? (
                (tags ?? []).find((tag) => tag.id === filters.tagId)?.name ??
                "Tag"
              ) : (
                <span className="text-muted-foreground">{t("allTags")}</span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[240px] p-0" align="start">
            <Command>
              <CommandInput placeholder={t("searchTag")} />
              <CommandList>
                <CommandEmpty>{t("noTags")}</CommandEmpty>
                <CommandGroup>
                  {(tags ?? []).map((tag) => (
                    <CommandItem
                      key={tag.id}
                      value={tag.name}
                      onSelect={() =>
                        onTagChange(
                          filters.tagId === tag.id ? undefined : tag.id,
                        )
                      }
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: tag.color ?? undefined,
                        }}
                      />
                      <span className="truncate">{tag.name}</span>
                      {filters.tagId === tag.id && (
                        <Check className="ml-auto h-4 w-4 shrink-0" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Selected for ideation filter */}
        <Select
          value={
            filters.selectedForIdeation === undefined
              ? "all"
              : filters.selectedForIdeation
                ? "yes"
                : "no"
          }
          onValueChange={(value) =>
            onSelectedForIdeationChange(
              value === "all" ? undefined : value === "yes",
            )
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("ideation")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            <SelectItem value="yes">{t("forIdeation")}</SelectItem>
            <SelectItem value="no">{t("noIdeation")}</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            <X className="mr-1 h-4 w-4" />
            {t("clearFilters")}
          </Button>
        )}
      </div>

      {/* Active filter badges */}
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
