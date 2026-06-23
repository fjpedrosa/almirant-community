'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { formatDisplayValue } from './use-dynamic-filters';
import type {
  AppliedFilter,
  FilterDefinition,
  FilterOperator,
  DynamicFiltersConfig,
} from '../../domain/filter-types';

type UseUrlDynamicFiltersReturn = {
  appliedFilters: AppliedFilter[];
  availableFilters: FilterDefinition[];
  addFilter: (filterDef: FilterDefinition, operator: FilterOperator, value: string | string[]) => void;
  removeFilter: (filterId: string) => void;
  updateFilter: (filterId: string, value: string | string[]) => void;
  clearFilters: () => void;
  getFilterParams: () => Record<string, string>;
  canAddFilter: (filterDef: FilterDefinition) => boolean;
};

export const stringifyUrlSearchParams = (params: URLSearchParams): string =>
  params.toString().replace(/%2C/gi, ',');

const parseMultiSelectValue = (rawValue: string): string[] =>
  rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const parseFiltersFromUrl = (
  searchParams: URLSearchParams,
  config: DynamicFiltersConfig,
): AppliedFilter[] => {
  const filters: AppliedFilter[] = [];

  for (const def of config.definitions) {
    // Handle date_range with separate _from/_to params
    if (def.type === 'date_range') {
      const from = searchParams.get(`${def.id}_from`);
      const to = searchParams.get(`${def.id}_to`);
      if (!from && !to) continue;

      const value = [from || '', to || ''];
      filters.push({
        id: `${def.id}_url`,
        fieldId: def.id,
        label: def.label,
        operator: 'between',
        value,
        displayValue: formatDisplayValue(value, def),
      });
      continue;
    }

    const rawValue = searchParams.get(def.id);
    if (!rawValue) continue;

    const value = def.type === 'multi_select'
      ? parseMultiSelectValue(rawValue)
      : rawValue;
    if (Array.isArray(value) && value.length === 0) continue;

    const operator = def.defaultOperator || def.operators[0] || 'equals';

    filters.push({
      id: `${def.id}_url`,
      fieldId: def.id,
      label: def.label,
      operator,
      value,
      displayValue: formatDisplayValue(value, def),
    });
  }

  return filters;
};

const getDefaultFilters = (config: DynamicFiltersConfig): AppliedFilter[] => {
  if (!config.initialFilters || config.initialFilters.length === 0) return [];
  const filters: AppliedFilter[] = [];
  for (const init of config.initialFilters) {
    const def = config.definitions.find((d) => d.id === init.fieldId);
    if (!def) continue;
    filters.push({
      id: `${init.fieldId}_default`,
      fieldId: init.fieldId,
      label: def.label,
      operator: init.operator,
      value: init.value,
      displayValue: formatDisplayValue(init.value, def),
    });
  }
  return filters;
};

const hasAnyFilterInUrl = (
  searchParams: URLSearchParams,
  definitions: FilterDefinition[],
): boolean => {
  return definitions.some((def) => {
    if (def.type === 'date_range') {
      return searchParams.has(`${def.id}_from`) || searchParams.has(`${def.id}_to`);
    }
    return searchParams.has(def.id);
  });
};

export const useUrlDynamicFilters = (
  config: DynamicFiltersConfig,
): UseUrlDynamicFiltersReturn => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const appliedFilters = useMemo(() => {
    if (!hasAnyFilterInUrl(searchParams, config.definitions)) {
      return getDefaultFilters(config);
    }
    return parseFiltersFromUrl(searchParams, config);
  }, [searchParams, config]);

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

  const pushParams = useCallback(
    (newParams: URLSearchParams) => {
      if (config.resetPageOnChange) {
        newParams.delete('page');
      }
      const paramString = stringifyUrlSearchParams(newParams);
      const url = paramString ? `${pathname}?${paramString}` : pathname;
      router.push(url, { scroll: false });
    },
    [router, pathname, config.resetPageOnChange],
  );

  const addFilter = useCallback(
    (filterDef: FilterDefinition, _operator: FilterOperator, value: string | string[]) => {
      if (!canAddFilter(filterDef)) return;

      const params = new URLSearchParams(searchParams.toString());

      // If we're overriding defaults for the first time, ensure all defaults are set in URL
      if (!hasAnyFilterInUrl(searchParams, config.definitions)) {
        for (const init of config.initialFilters ?? []) {
          if (init.fieldId !== filterDef.id) {
            const initDef = config.definitions.find((d) => d.id === init.fieldId);
            if (initDef?.type === 'date_range' && Array.isArray(init.value)) {
              if (init.value[0]) params.set(`${init.fieldId}_from`, init.value[0]);
              if (init.value[1]) params.set(`${init.fieldId}_to`, init.value[1]);
            } else {
              const initValue = Array.isArray(init.value) ? init.value.join(',') : init.value;
              params.set(init.fieldId, initValue);
            }
          }
        }
      }

      if (filterDef.type === 'date_range' && Array.isArray(value)) {
        if (value[0]) params.set(`${filterDef.id}_from`, value[0]);
        if (value[1]) params.set(`${filterDef.id}_to`, value[1]);
      } else if (Array.isArray(value)) {
        if (value.length > 0) {
          params.set(filterDef.id, value.join(','));
        }
      } else {
        params.set(filterDef.id, value);
      }

      pushParams(params);
    },
    [canAddFilter, searchParams, config, pushParams],
  );

  const removeFilter = useCallback(
    (filterId: string) => {
      const filter = appliedFilters.find((f) => f.id === filterId);
      if (!filter) return;

      const params = new URLSearchParams(searchParams.toString());

      // If removing a default filter, we need to materialize the other defaults into the URL
      if (!hasAnyFilterInUrl(searchParams, config.definitions)) {
        for (const init of config.initialFilters ?? []) {
          if (init.fieldId !== filter.fieldId) {
            const initDef = config.definitions.find((d) => d.id === init.fieldId);
            if (initDef?.type === 'date_range' && Array.isArray(init.value)) {
              if (init.value[0]) params.set(`${init.fieldId}_from`, init.value[0]);
              if (init.value[1]) params.set(`${init.fieldId}_to`, init.value[1]);
            } else {
              const initValue = Array.isArray(init.value) ? init.value.join(',') : init.value;
              params.set(init.fieldId, initValue);
            }
          }
        }
      }

      const filterDef = config.definitions.find((d) => d.id === filter.fieldId);
      if (filterDef?.type === 'date_range') {
        params.delete(`${filter.fieldId}_from`);
        params.delete(`${filter.fieldId}_to`);
      } else {
        params.delete(filter.fieldId);
      }
      pushParams(params);
    },
    [appliedFilters, searchParams, config, pushParams],
  );

  const updateFilter = useCallback(
    (filterId: string, value: string | string[]) => {
      const filter = appliedFilters.find((f) => f.id === filterId);
      if (!filter) return;

      const params = new URLSearchParams(searchParams.toString());

      // If updating a default filter, materialize the others
      if (!hasAnyFilterInUrl(searchParams, config.definitions)) {
        for (const init of config.initialFilters ?? []) {
          if (init.fieldId !== filter.fieldId) {
            const initDef = config.definitions.find((d) => d.id === init.fieldId);
            if (initDef?.type === 'date_range' && Array.isArray(init.value)) {
              if (init.value[0]) params.set(`${init.fieldId}_from`, init.value[0]);
              if (init.value[1]) params.set(`${init.fieldId}_to`, init.value[1]);
            } else {
              const initValue = Array.isArray(init.value) ? init.value.join(',') : init.value;
              params.set(init.fieldId, initValue);
            }
          }
        }
      }

      const filterDef = config.definitions.find((d) => d.id === filter.fieldId);
      if (filterDef?.type === 'date_range' && Array.isArray(value)) {
        params.delete(`${filter.fieldId}_from`);
        params.delete(`${filter.fieldId}_to`);
        if (value[0]) params.set(`${filter.fieldId}_from`, value[0]);
        if (value[1]) params.set(`${filter.fieldId}_to`, value[1]);
      } else if (Array.isArray(value)) {
        if (value.length > 0) {
          params.set(filter.fieldId, value.join(','));
        } else {
          params.delete(filter.fieldId);
        }
      } else {
        params.set(filter.fieldId, value);
      }

      pushParams(params);
    },
    [appliedFilters, searchParams, config, pushParams],
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());

    // Remove all filter params but preserve reserved params (area, board, search)
    for (const def of config.definitions) {
      params.delete(def.id);
      if (def.type === 'date_range') {
        params.delete(`${def.id}_from`);
        params.delete(`${def.id}_to`);
      }
    }

    pushParams(params);
  }, [searchParams, config, pushParams]);

  const getFilterParams = useCallback((): Record<string, string> => {
    const params: Record<string, string> = {};
    appliedFilters.forEach((filter) => {
      const filterDef = config.definitions.find((d) => d.id === filter.fieldId);
      if (filterDef?.type === 'date_range' && Array.isArray(filter.value)) {
        if (filter.value[0]) params[`${filter.fieldId}_from`] = filter.value[0];
        if (filter.value[1]) params[`${filter.fieldId}_to`] = filter.value[1];
      } else if (Array.isArray(filter.value)) {
        if (filter.value.length > 0) {
          params[filter.fieldId] = filter.value.join(',');
        }
      } else {
        params[filter.fieldId] = filter.value;
      }
    });
    return params;
  }, [appliedFilters, config.definitions]);

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
