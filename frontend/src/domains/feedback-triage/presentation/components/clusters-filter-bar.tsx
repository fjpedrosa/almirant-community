import { SortAsc, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ClusterStatus } from "../../domain/types";
import { ACTIVE_CLUSTER_STATUSES } from "../../domain/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ClustersFiltersState {
  statuses: ClusterStatus[];
  showResolved: boolean;
  minItemCount: number;
  sortBy: "itemCount" | "createdAt";
}

export interface ClustersFilterBarProps {
  filters: ClustersFiltersState;
  onStatusesChange: (statuses: ClusterStatus[]) => void;
  onShowResolvedChange: (showResolved: boolean) => void;
  onMinItemCountChange: (count: number) => void;
  onSortChange: (sortBy: "itemCount" | "createdAt") => void;
  onClearFilters: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All possible active statuses (excludes resolved/dismissed by default) */
const ACTIVE_STATUSES: ClusterStatus[] = ACTIVE_CLUSTER_STATUSES;

/** Resolved/dismissed statuses - hidden unless showResolved is true */
const RESOLVED_STATUSES: ClusterStatus[] = ["resolved", "dismissed"];

/** Display labels for each status */
const STATUS_LABELS: Record<ClusterStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  fix_ready: "Fix Ready",
  resolved: "Resolved",
  regression: "Regression",
  dismissed: "Dismissed",
  promoted: "Promoted",
};

const SORT_OPTIONS: { value: "itemCount" | "createdAt"; label: string }[] = [
  { value: "itemCount", label: "Item count" },
  { value: "createdAt", label: "Date created" },
];

const MIN_COUNT_OPTIONS = [1, 2, 3, 5, 10];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hasActiveFilters = (filters: ClustersFiltersState): boolean => {
  // Check if statuses differ from default (all active statuses selected)
  const defaultStatuses = ACTIVE_CLUSTER_STATUSES;
  const statusesMatch =
    filters.statuses.length === defaultStatuses.length &&
    filters.statuses.every((s) => defaultStatuses.includes(s));

  return (
    !statusesMatch ||
    filters.showResolved ||
    filters.minItemCount > 1 ||
    filters.sortBy !== "itemCount"
  );
};

const getActiveFilterCount = (filters: ClustersFiltersState): number => {
  let count = 0;
  const defaultStatuses = ACTIVE_CLUSTER_STATUSES;
  const statusesMatch =
    filters.statuses.length === defaultStatuses.length &&
    filters.statuses.every((s) => defaultStatuses.includes(s));

  if (!statusesMatch) count++;
  if (filters.showResolved) count++;
  if (filters.minItemCount > 1) count++;
  if (filters.sortBy !== "itemCount") count++;
  return count;
};

// ---------------------------------------------------------------------------
// Component (Pure presentational - no hooks)
// ---------------------------------------------------------------------------

export const ClustersFilterBar: React.FC<ClustersFilterBarProps> = ({
  filters,
  onStatusesChange,
  onShowResolvedChange,
  onMinItemCountChange,
  onSortChange,
  onClearFilters,
}) => {
  const activeCount = getActiveFilterCount(filters);

  // Compute visible statuses based on showResolved toggle
  const visibleStatuses = filters.showResolved
    ? [...ACTIVE_STATUSES, ...RESOLVED_STATUSES]
    : ACTIVE_STATUSES;

  // Toggle a single status on/off
  const toggleStatus = (status: ClusterStatus) => {
    const isSelected = filters.statuses.includes(status);
    let newStatuses: ClusterStatus[];

    if (isSelected) {
      // Remove the status
      newStatuses = filters.statuses.filter((s) => s !== status);
    } else {
      // Add the status
      newStatuses = [...filters.statuses, status];
    }

    // If user deselected all statuses, revert to default active statuses
    if (newStatuses.length === 0) {
      newStatuses = [...ACTIVE_CLUSTER_STATUSES];
    }

    onStatusesChange(newStatuses);
  };

  // Handle showResolved toggle - when turning off, remove resolved/dismissed from selection
  const handleShowResolvedChange = (checked: boolean) => {
    onShowResolvedChange(checked);

    if (!checked) {
      // Remove resolved/dismissed from current statuses if present
      const filteredStatuses = filters.statuses.filter(
        (s) => !RESOLVED_STATUSES.includes(s)
      );
      // If all statuses were removed, revert to default
      if (filteredStatuses.length === 0) {
        onStatusesChange([...ACTIVE_CLUSTER_STATUSES]);
      } else if (filteredStatuses.length !== filters.statuses.length) {
        onStatusesChange(filteredStatuses);
      }
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Status multi-select (chip buttons) */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground shrink-0">Status</Label>
        <div className="flex flex-wrap gap-1">
          {visibleStatuses.map((status) => (
            <Button
              key={status}
              size="xs"
              variant={filters.statuses.includes(status) ? "default" : "outline"}
              onClick={() => toggleStatus(status)}
            >
              {STATUS_LABELS[status]}
            </Button>
          ))}
        </div>
      </div>

      {/* Show resolved/dismissed toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="show-resolved"
          checked={filters.showResolved}
          onCheckedChange={handleShowResolvedChange}
        />
        <Label
          htmlFor="show-resolved"
          className="text-xs text-muted-foreground cursor-pointer"
        >
          Show resolved & dismissed
        </Label>
      </div>

      {/* Min item count filter */}
      <div className="flex items-center gap-2">
        <Label
          htmlFor="min-count-filter"
          className="text-xs text-muted-foreground shrink-0"
        >
          Min items
        </Label>
        <Select
          value={String(filters.minItemCount)}
          onValueChange={(value) => onMinItemCountChange(Number(value))}
        >
          <SelectTrigger id="min-count-filter" className="h-8 w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MIN_COUNT_OPTIONS.map((count) => (
              <SelectItem key={count} value={String(count)}>
                {count}+
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2">
        <Label
          htmlFor="sort-filter"
          className="text-xs text-muted-foreground shrink-0"
        >
          <SortAsc className="h-3.5 w-3.5" />
        </Label>
        <Select
          value={filters.sortBy}
          onValueChange={(value) =>
            onSortChange(value as "itemCount" | "createdAt")
          }
        >
          <SelectTrigger id="sort-filter" className="h-8 w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Clear filters button */}
      {hasActiveFilters(filters) && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground hover:text-foreground"
          onClick={onClearFilters}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
              {activeCount}
            </Badge>
          )}
        </Button>
      )}
    </div>
  );
};
