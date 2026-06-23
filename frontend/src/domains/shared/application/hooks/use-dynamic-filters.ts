'use client';

import { useState, useCallback, useMemo } from 'react';
import type {
  AppliedFilter,
  FilterDefinition,
  FilterOperator,
  DynamicFiltersConfig,
} from '../../domain/filter-types';

type UseDynamicFiltersReturn = {
  appliedFilters: AppliedFilter[];
  availableFilters: FilterDefinition[];
  addFilter: (filterDef: FilterDefinition, operator: FilterOperator, value: string | string[]) => void;
  removeFilter: (filterId: string) => void;
  updateFilter: (filterId: string, value: string | string[]) => void;
  clearFilters: () => void;
  getFilterParams: () => Record<string, string>;
  canAddFilter: (filterDef: FilterDefinition) => boolean;
};

export const formatDisplayValue = (
  value: string | string[],
  filterDef: FilterDefinition,
): string => {
  if (!value) return '';
  if (Array.isArray(value) && value.length === 0) return '';

  switch (filterDef.type) {
    case 'select': {
      const option = filterDef.options?.find((opt) => opt.value === value);
      return option?.label || String(value);
    }
    case 'multi_select': {
      if (Array.isArray(value)) {
        return value
          .map((v) => {
            const opt = filterDef.options?.find((o) => o.value === v);
            return opt?.label || v;
          })
          .join(', ');
      }
      const singleOpt = filterDef.options?.find((opt) => opt.value === value);
      return singleOpt?.label || String(value);
    }
    case 'boolean':
      return value === 'true' ? 'Si' : 'No';
    case 'date_range': {
      if (Array.isArray(value)) {
        const [from, to] = value;
        if (from && to) return `${from} → ${to}`;
        if (from) return `desde ${from}`;
        if (to) return `hasta ${to}`;
      }
      return String(value);
    }
    case 'async_select':
      return String(value);
    default:
      return String(value);
  }
};

const buildInitialFilters = (cfg: DynamicFiltersConfig): AppliedFilter[] => {
  if (!cfg.initialFilters || cfg.initialFilters.length === 0) return [];
  const filters: AppliedFilter[] = [];
  for (const init of cfg.initialFilters) {
    const def = cfg.definitions.find((d) => d.id === init.fieldId);
    if (!def) continue;
    filters.push({
      id: `${init.fieldId}_initial`,
      fieldId: init.fieldId,
      label: def.label,
      operator: init.operator,
      value: init.value,
      displayValue: formatDisplayValue(init.value, def),
    });
  }
  return filters;
};

export const useDynamicFilters = (
  config: DynamicFiltersConfig,
): UseDynamicFiltersReturn => {
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilter[]>(
    () => buildInitialFilters(config),
  );

  const availableFilters = useMemo(() => {
    if (config.allowDuplicates) return config.definitions;
    const appliedFieldIds = appliedFilters.map((f) => f.fieldId);
    return config.definitions.filter((f) => !appliedFieldIds.includes(f.id));
  }, [config.definitions, config.allowDuplicates, appliedFilters]);

  const canAddFilter = useCallback(
    (filterDef: FilterDefinition): boolean => {
      if (config.maxFilters && appliedFilters.length >= config.maxFilters) return false;
      if (!config.allowDuplicates) {
        return !appliedFilters.some((f) => f.fieldId === filterDef.id);
      }
      return true;
    },
    [appliedFilters, config.maxFilters, config.allowDuplicates],
  );

  const addFilter = useCallback(
    (filterDef: FilterDefinition, operator: FilterOperator, value: string | string[]) => {
      if (!canAddFilter(filterDef)) return;

      const newFilter: AppliedFilter = {
        id: `${filterDef.id}_${Date.now()}`,
        fieldId: filterDef.id,
        label: filterDef.label,
        operator,
        value,
        displayValue: formatDisplayValue(value, filterDef),
      };

      setAppliedFilters((prev) => [...prev, newFilter]);
    },
    [canAddFilter],
  );

  const removeFilter = useCallback((filterId: string) => {
    setAppliedFilters((prev) => prev.filter((f) => f.id !== filterId));
  }, []);

  const updateFilter = useCallback(
    (filterId: string, value: string | string[]) => {
      setAppliedFilters((prev) =>
        prev.map((filter) => {
          if (filter.id !== filterId) return filter;
          const filterDef = config.definitions.find((f) => f.id === filter.fieldId);
          return {
            ...filter,
            value,
            displayValue: filterDef ? formatDisplayValue(value, filterDef) : String(value),
          };
        }),
      );
    },
    [config.definitions],
  );

  const clearFilters = useCallback(() => {
    setAppliedFilters(buildInitialFilters(config));
  }, [config]);

  const getFilterParams = useCallback((): Record<string, string> => {
    const params: Record<string, string> = {};
    appliedFilters.forEach((filter) => {
      if (Array.isArray(filter.value)) {
        if (filter.value.length > 0) {
          params[filter.fieldId] = filter.value.join(',');
        }
      } else {
        params[filter.fieldId] = filter.value;
      }
    });
    return params;
  }, [appliedFilters]);

  return {
    appliedFilters,
    availableFilters,
    addFilter,
    removeFilter,
    updateFilter,
    clearFilters,
    getFilterParams,
    canAddFilter,
  };
};
