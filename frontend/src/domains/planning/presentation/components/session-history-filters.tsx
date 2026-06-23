import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlanningSessionStatus } from "../../domain/types";

interface SessionHistoryFiltersProps {
  status: PlanningSessionStatus | undefined;
  hasActiveFilters: boolean;
  onStatusChange: (status: PlanningSessionStatus | undefined) => void;
  onClearFilters: () => void;
}

export const SessionHistoryFilters: React.FC<SessionHistoryFiltersProps> = ({
  status,
  hasActiveFilters,
  onStatusChange,
  onClearFilters,
}) => {
  return (
    <div className="flex items-center gap-3">
      {/* Status filter */}
      <Select
        value={status ?? "all"}
        onValueChange={(value) =>
          onStatusChange(
            value === "all" ? undefined : (value as PlanningSessionStatus)
          )
        }
      >
        <SelectTrigger className="w-40" size="sm">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
      </Select>

      {/* Clear filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="h-8 gap-1 text-xs"
        >
          <X className="size-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  );
};
