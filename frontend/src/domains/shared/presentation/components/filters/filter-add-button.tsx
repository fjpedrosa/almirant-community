'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FilterValueInput } from './filter-value-input';
import type { FilterDefinition, FilterOperator } from '../../../domain/filter-types';

type FilterAddButtonProps = {
  availableFilters: FilterDefinition[];
  onSelectFilter: (filter: FilterDefinition, operator: FilterOperator, value: string | string[]) => void;
  onClearFilters?: () => void;
  hasAppliedFilters?: boolean;
  disabled?: boolean;
};

type NavigationState =
  | { level: 0 }
  | { level: 1; filter: FilterDefinition; operator: FilterOperator; value: string | string[] };

const shouldCloseOnValueChange = (type: FilterDefinition['type']): boolean => {
  return type === 'select' || type === 'boolean' || type === 'async_select';
};

const appliesOnValueChange = (type: FilterDefinition['type']): boolean => {
  return shouldCloseOnValueChange(type) || type === 'multi_select';
};

const isFilterValueEmpty = (value: string | string[] | null | undefined): boolean => {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
};

export const FilterAddButton = ({
  availableFilters,
  onSelectFilter,
  onClearFilters,
  hasAppliedFilters,
  disabled,
}: FilterAddButtonProps) => {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [navState, setNavState] = useState<NavigationState>({ level: 0 });

  const handleSelectFilterItem = (filter: FilterDefinition) => {
    const operator = filter.defaultOperator || filter.operators[0] || 'equals';
    const initialValue = filter.type === 'multi_select' ? [] : '';
    setNavState({ level: 1, filter, operator, value: initialValue });
  };

  const handleBack = () => {
    setNavState({ level: 0 });
  };

  const handleValueChange = (newValue: string | string[]) => {
    if (navState.level !== 1) return;

    if (navState.filter.type === 'multi_select') {
      setNavState({ ...navState, value: newValue });
      onSelectFilter(navState.filter, navState.operator, newValue);
      return;
    }

    if (shouldCloseOnValueChange(navState.filter.type) && !isFilterValueEmpty(newValue)) {
      onSelectFilter(navState.filter, navState.operator, newValue);
      setOpen(false);
      return;
    }

    setNavState({ ...navState, value: newValue });
  };

  const handleClearFilters = () => {
    onClearFilters?.();
    if (navState.level === 1 && navState.filter.type === 'multi_select') {
      setNavState({ ...navState, value: [] });
    }
  };

  const handleApply = () => {
    if (navState.level !== 1 || isFilterValueEmpty(navState.value)) return;
    onSelectFilter(navState.filter, navState.operator, navState.value);
    setOpen(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setNavState({ level: 0 });
    }
  };

  // Group filters by their group property
  const groups = availableFilters.reduce<Record<string, FilterDefinition[]>>(
    (acc, filter) => {
      const group = filter.group || 'General';
      if (!acc[group]) acc[group] = [];
      acc[group].push(filter);
      return acc;
    },
    {},
  );

  const groupNames = Object.keys(groups);

  const needsManualApply = navState.level === 1 && !appliesOnValueChange(navState.filter.type);
  const canClearFilters = !!onClearFilters && !!hasAppliedFilters;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={(disabled || availableFilters.length === 0) && !canClearFilters}
          className="h-9 gap-1 text-muted-foreground hover:text-foreground border-dashed"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('filter')}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={navState.level === 0 ? 'w-48 p-1' : 'w-56 p-1'}
        align="start"
      >
        {navState.level === 0 ? (
          // Level 0: Filter list
          availableFilters.length === 0 ? (
            <div className="space-y-2">
              {canClearFilters && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('clearAll')}
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground text-center py-3">
                {t('noFiltersAvailable')}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {canClearFilters && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t('clearAll')}
                  </button>
                </div>
              )}
              <ScrollArea className="max-h-[280px]">
                {groupNames.length <= 1 ? (
                  availableFilters.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => handleSelectFilterItem(filter)}
                    >
                      <span>{filter.label}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  ))
                ) : (
                  groupNames.map((groupName, index) => (
                    <div key={groupName}>
                      {index > 0 && (
                        <div className="mx-1 my-1 h-px bg-border" />
                      )}
                      <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        {groupName}
                      </p>
                      {groups[groupName].map((filter) => (
                        <button
                          key={filter.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => handleSelectFilterItem(filter)}
                        >
                          <span>{filter.label}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </ScrollArea>
            </div>
          )
        ) : (
          // Level 1: Value input
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground -ml-1"
                onClick={handleBack}
              >
                <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{navState.filter.label}</span>
              </button>

              {canClearFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('clearAll')}
                </button>
              )}
            </div>

            <FilterValueInput
              filter={navState.filter}
              operator={navState.operator}
              value={navState.value}
              onChange={handleValueChange}
              autoFocus
            />

            {needsManualApply && (
              <div className="flex justify-end pt-1 border-t">
                <Button
                  size="sm"
                  onClick={handleApply}
                  disabled={isFilterValueEmpty(navState.value)}
                >
                  {t('apply')}
                </Button>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
