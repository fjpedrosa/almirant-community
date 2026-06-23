"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Filter, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OwnerMultiSelectFilter } from "@/domains/shared/presentation/components/filters/owner-multi-select-filter";
import type { TodoItemPriority, TodoItemStatus, TodosFilterBarProps } from "../../domain/types";

const TODO_STATUS_OPTIONS: TodoItemStatus[] = ["pending", "in_progress", "done", "blocked"];
const TODO_PRIORITY_OPTIONS: TodoItemPriority[] = ["low", "medium", "high", "urgent"];

export const TodosFilterBar: React.FC<TodosFilterBarProps> = ({
  filters,
  hasActiveFilters,
  activeFilters,
  owners,
  projects,
  onSearchChange,
  onStatusChange,
  onPriorityChange,
  onOwnerChange,
  onProjectChange,
  onDueDateChange,
  onClearFilters,
  onRemoveFilter,
}) => {
  const t = useTranslations("todos");

  const getStatusLabel = (status: TodoItemStatus) => t(`status.${status}`);
  const getPriorityLabel = (priority: TodoItemPriority) => t(`priority.${priority}`);

  const resolveFilterValue = (filter: { key: string; value: string }) => {
    if (filter.key === "ownerUserId") {
      return owners.find((o) => o.id === filter.value)?.name ?? filter.value;
    }
    if (filter.key === "projectId") {
      return projects.find((p) => p.id === filter.value)?.name ?? filter.value;
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

  const handleOwnerMultiChange = (ids: string[]) => {
    onOwnerChange(ids.length > 0 ? ids.join(",") : undefined);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={displayValue}
            placeholder={t("filters.searchPlaceholder")}
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

        <Select
          value={filters.status || "all"}
          onValueChange={(value) =>
            onStatusChange(value === "all" ? undefined : (value as TodoItemStatus))
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder={t("filters.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
            {TODO_STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {getStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.priority || "all"}
          onValueChange={(value) =>
            onPriorityChange(value === "all" ? undefined : (value as TodoItemPriority))
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder={t("filters.priority")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allPriorities")}</SelectItem>
            {TODO_PRIORITY_OPTIONS.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {getPriorityLabel(priority)}
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
            <SelectValue placeholder={t("filters.project")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allProjects")}</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          className="w-[170px]"
          value={filters.dueDate ?? ""}
          onChange={(event) => onDueDateChange(event.target.value || undefined)}
        />

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            <X className="h-4 w-4 mr-1" />
            {t("filters.clearFilters")}
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
