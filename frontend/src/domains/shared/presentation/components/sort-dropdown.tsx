"use client";

import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Represents a single sort option with a label and value.
 * @template T - The type of the sort field value (typically a string union type)
 */
export type SortOption<T extends string = string> = {
  label: string;
  value: T;
};

/**
 * Props for the SortDropdown component.
 * @template T - The type of the sort field value
 */
export type SortDropdownProps<T extends string = string> = {
  /** List of available sort options */
  options: SortOption<T>[];
  /** Currently selected sort field */
  sortBy: T;
  /** Current sort direction */
  sortDirection: "asc" | "desc";
  /** Callback fired when sort changes (field or direction) */
  onSortChange: (sortBy: T, sortDirection: "asc" | "desc") => void;
  /** Default sort field - used to determine "active" highlight state */
  defaultSortBy?: T;
  /** Default sort direction - used with defaultSortBy for "active" highlight */
  defaultSortDirection?: "asc" | "desc";
  /** Placeholder text when no option is selected */
  placeholder?: string;
  /** Additional class names for the container */
  className?: string;
  /** Accessible label for the sort dropdown */
  ariaLabel?: string;
};

/**
 * A reusable presentational sort dropdown component.
 *
 * Combines a Select dropdown for choosing sort field with a toggle button
 * for switching between ascending/descending direction.
 *
 * Follows toolbar styling conventions with h-8 height and text-xs sizing.
 * Highlights when sort differs from default values.
 *
 * @example
 * ```tsx
 * // Usage with typed sort fields
 * type LeadSortField = "name" | "createdAt" | "status";
 *
 * const sortOptions: SortOption<LeadSortField>[] = [
 *   { label: "Name", value: "name" },
 *   { label: "Created", value: "createdAt" },
 *   { label: "Status", value: "status" },
 * ];
 *
 * <SortDropdown
 *   options={sortOptions}
 *   sortBy={currentSortBy}
 *   sortDirection={currentDirection}
 *   onSortChange={(field, direction) => {
 *     setCurrentSortBy(field);
 *     setCurrentDirection(direction);
 *   }}
 *   defaultSortBy="createdAt"
 *   defaultSortDirection="desc"
 * />
 * ```
 */
export const SortDropdown = <T extends string = string>({
  options,
  sortBy,
  sortDirection,
  onSortChange,
  defaultSortBy,
  defaultSortDirection = "desc",
  placeholder = "Sort by",
  className,
  ariaLabel = "Sort options",
}: SortDropdownProps<T>) => {
  // Determine if current sort differs from default (for highlight styling)
  const isActive =
    defaultSortBy !== undefined &&
    (sortBy !== defaultSortBy || sortDirection !== defaultSortDirection);

  const handleFieldChange = (value: string) => {
    onSortChange(value as T, sortDirection);
  };

  const handleDirectionToggle = () => {
    const newDirection = sortDirection === "asc" ? "desc" : "asc";
    onSortChange(sortBy, newDirection);
  };

  const currentLabel = options.find((opt) => opt.value === sortBy)?.label;

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Select value={sortBy} onValueChange={handleFieldChange}>
        <SelectTrigger
          size="sm"
          className={cn(
            "h-8 text-xs gap-1.5",
            isActive &&
              "border-blue-500/50 text-blue-600 dark:text-blue-400 bg-blue-500/10"
          )}
          aria-label={ariaLabel}
        >
          <ArrowUpDown
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              isActive
                ? "text-blue-600 dark:text-blue-400"
                : "text-muted-foreground"
            )}
          />
          <SelectValue placeholder={placeholder}>
            {currentLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="icon-sm"
        className={cn(
          "h-8 w-8 shrink-0",
          isActive &&
            "border-blue-500/50 text-blue-600 dark:text-blue-400 bg-blue-500/10"
        )}
        onClick={handleDirectionToggle}
        aria-label={
          sortDirection === "asc" ? "Sort ascending" : "Sort descending"
        }
        title={sortDirection === "asc" ? "Ascending" : "Descending"}
      >
        {sortDirection === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
};
