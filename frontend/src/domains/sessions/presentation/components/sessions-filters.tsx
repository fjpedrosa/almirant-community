"use client";

import { DynamicFilters } from "@/domains/shared/presentation/components/filters/dynamic-filters";
import type { DynamicFiltersConfig, AppliedFilter, FilterDefinition, FilterOperator } from "@/domains/shared/domain/filter-types";

interface SessionsFiltersProps {
  config: DynamicFiltersConfig;
  appliedFilters: AppliedFilter[];
  availableFilters: FilterDefinition[];
  onAddFilter: (filter: FilterDefinition, operator: FilterOperator, value: string | string[]) => void;
  onRemoveFilter: (filterId: string) => void;
  onUpdateFilter: (filterId: string, value: string | string[]) => void;
  onClearFilters: () => void;
}

export const SessionsFilters: React.FC<SessionsFiltersProps> = ({
  config,
  appliedFilters,
  availableFilters,
  onAddFilter,
  onRemoveFilter,
  onUpdateFilter,
  onClearFilters,
}) => {
  return (
    <DynamicFilters
      config={config}
      appliedFilters={appliedFilters}
      availableFilters={availableFilters}
      onAddFilter={onAddFilter}
      onRemoveFilter={onRemoveFilter}
      onUpdateFilter={onUpdateFilter}
      onClearFilters={onClearFilters}
    />
  );
};
