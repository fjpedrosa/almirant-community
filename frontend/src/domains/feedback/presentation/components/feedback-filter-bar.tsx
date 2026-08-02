"use client";

import { useState, useEffect } from "react";
import { Search, X, Filter } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  FeedbackFilterBarProps,
  FeedbackStatus,
  FeedbackCategory,
  FeedbackItemFilters,
} from "../../domain/types";

const STATUS_OPTIONS: FeedbackStatus[] = [
  "new",
  "triaged",
  "in_progress",
  "pending_validation",
  "implementing",
  "deployed",
  "verified",
  "cancelled",
];

const CATEGORY_OPTIONS: FeedbackCategory[] = [
  "bug",
  "feature_request",
  "improvement",
  "question",
  "praise",
  "other",
];

export const FeedbackFilterBar: React.FC<FeedbackFilterBarProps> = ({
  filters,
  hasActiveFilters,
  activeFilters,
  onSearchChange,
  onStatusChange,
  onCategoryChange,
  onClearFilters,
  onRemoveFilter,
}) => {
  const t = useTranslations("feedback");

  // Local state for debounced search input
  const [searchValue, setSearchValue] = useState(filters.search || "");
  const [isLocalEdit, setIsLocalEdit] = useState(false);

  // Debounced search handler - only triggers when user types
  useEffect(() => {
    if (!isLocalEdit) return;
    const timer = setTimeout(() => {
      onSearchChange(searchValue);
      setIsLocalEdit(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue, isLocalEdit, onSearchChange]);

  // Derive displayed value: local edit value takes priority, otherwise sync from props
  const displayValue = isLocalEdit ? searchValue : (filters.search || "");

  return (
    <div className="space-y-3">
      {/* Filter Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("filters.searchPlaceholder")}
            value={displayValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
              setIsLocalEdit(true);
            }}
            className="pl-9 pr-9"
          />
          {displayValue && (
            <button
              onClick={() => {
                setSearchValue("");
                setIsLocalEdit(false);
                onSearchChange("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status Select */}
        <Select
          value={filters.status || "all"}
          onValueChange={(value) =>
            onStatusChange(value === "all" ? undefined : (value as FeedbackStatus))
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("filters.status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
            {STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`statuses.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Category Select */}
        <Select
          value={filters.category || "all"}
          onValueChange={(value) =>
            onCategoryChange(
              value === "all" ? undefined : (value as FeedbackCategory)
            )
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t("filters.category")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allCategories")}</SelectItem>
            {CATEGORY_OPTIONS.map((category) => (
              <SelectItem key={category} value={category}>
                {t(`categories.${category}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear Filters Button */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            <X className="h-4 w-4 mr-1" />
            {t("filters.clearFilters")}
          </Button>
        )}
      </div>

      {/* Active Filters Badges */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {activeFilters.map((filter) => (
            <Badge
              key={filter.key}
              variant="secondary"
              className="gap-1 pr-1"
            >
              <span className="text-muted-foreground">{filter.label}:</span>
              <span>{filter.value}</span>
              <button
                onClick={() => onRemoveFilter(filter.key as keyof FeedbackItemFilters)}
                className="ml-1 rounded-full p-0.5 hover:bg-muted"
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
