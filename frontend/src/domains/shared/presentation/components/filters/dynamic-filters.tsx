'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FilterChip } from './filter-chip';
import { FilterAddButton } from './filter-add-button';
import { FilterValueInput } from './filter-value-input';
import type {
  DynamicFiltersConfig,
  FilterDefinition,
  FilterOperator,
  AppliedFilter,
} from '../../../domain/filter-types';

type DynamicFiltersProps = {
  config: DynamicFiltersConfig;
  appliedFilters: AppliedFilter[];
  onAddFilter: (filter: FilterDefinition, operator: FilterOperator, value: string | string[]) => void;
  onRemoveFilter: (filterId: string) => void;
  onUpdateFilter: (filterId: string, value: string | string[]) => void;
  onClearFilters: () => void;
  availableFilters: FilterDefinition[];
  searchSlot?: React.ReactNode;
};

const shouldCloseOnValueChange = (filterDef: FilterDefinition): boolean => {
  return filterDef.type === 'select' || filterDef.type === 'boolean' || filterDef.type === 'async_select';
};

const appliesOnValueChange = (filterDef: FilterDefinition): boolean => {
  return shouldCloseOnValueChange(filterDef) || filterDef.type === 'multi_select';
};

const isFilterValueEmpty = (value: string | string[] | null | undefined): boolean => {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
};

export const DynamicFilters = ({
  config,
  appliedFilters,
  onAddFilter,
  onRemoveFilter,
  onUpdateFilter,
  onClearFilters,
  availableFilters,
  searchSlot,
}: DynamicFiltersProps) => {
  const t = useTranslations('common');
  const [editingFilter, setEditingFilter] = useState<{
    definition: FilterDefinition;
    operator: FilterOperator;
    value: string | string[];
    existingId?: string;
  } | null>(null);

  const handleSelectNewFilter = (
    filterDef: FilterDefinition,
    operator: FilterOperator,
    value: string | string[],
  ) => {
    const existingFilter = appliedFilters.find((filter) => filter.fieldId === filterDef.id);

    if (isFilterValueEmpty(value)) {
      if (existingFilter) onRemoveFilter(existingFilter.id);
      return;
    }

    if (existingFilter) {
      onUpdateFilter(existingFilter.id, value);
      return;
    }

    onAddFilter(filterDef, operator, value);
  };

  const handleEditFilter = (filterId: string) => {
    const filter = appliedFilters.find((f) => f.id === filterId);
    if (!filter) return;

    const filterDef = config.definitions.find((f) => f.id === filter.fieldId);
    if (!filterDef) return;

    setEditingFilter({
      definition: filterDef,
      operator: filter.operator,
      value: filter.value,
      existingId: filterId,
    });
  };

  const handleValueChange = (newValue: string | string[]) => {
    if (!editingFilter) return;

    if (editingFilter.definition.type === 'multi_select') {
      setEditingFilter({ ...editingFilter, value: newValue });
      if (editingFilter.existingId) {
        if (isFilterValueEmpty(newValue)) {
          onRemoveFilter(editingFilter.existingId);
        } else {
          onUpdateFilter(editingFilter.existingId, newValue);
        }
      } else if (!isFilterValueEmpty(newValue)) {
        onAddFilter(editingFilter.definition, editingFilter.operator, newValue);
      }
      return;
    }

    // For select/boolean with few options, auto-apply on selection
    if (shouldCloseOnValueChange(editingFilter.definition) && !isFilterValueEmpty(newValue)) {
      if (editingFilter.existingId) {
        onUpdateFilter(editingFilter.existingId, newValue);
      } else {
        onAddFilter(editingFilter.definition, editingFilter.operator, newValue);
      }
      setEditingFilter(null);
      return;
    }

    setEditingFilter({ ...editingFilter, value: newValue });
  };

  const handleApplyManual = () => {
    if (!editingFilter || isFilterValueEmpty(editingFilter.value)) return;

    if (editingFilter.existingId) {
      onUpdateFilter(editingFilter.existingId, editingFilter.value);
    } else {
      onAddFilter(editingFilter.definition, editingFilter.operator, editingFilter.value);
    }
    setEditingFilter(null);
  };

  const needsManualApply = editingFilter && !appliesOnValueChange(editingFilter.definition);

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {searchSlot}

        <FilterAddButton
          availableFilters={availableFilters}
          onSelectFilter={handleSelectNewFilter}
          onClearFilters={onClearFilters}
          hasAppliedFilters={appliedFilters.length > 0}
          disabled={
            config.maxFilters ? appliedFilters.length >= config.maxFilters : false
          }
        />

        {/* Applied filter chips inline */}
        {appliedFilters.map((filter) => (
          <FilterChip
            key={filter.id}
            filter={filter}
            filterDefinition={config.definitions.find((definition) => definition.id === filter.fieldId)}
            onRemove={onRemoveFilter}
            onEdit={handleEditFilter}
          />
        ))}

        {appliedFilters.length > 0 && (
          <button
            onClick={onClearFilters}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
          >
            {t('clear')}
          </button>
        )}
      </div>

      {/* Filter value dialog */}
      <Dialog
        open={!!editingFilter}
        onOpenChange={(open) => !open && setEditingFilter(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {editingFilter?.definition.label}
            </DialogTitle>
          </DialogHeader>

          {editingFilter && (
            <div className="space-y-3">
              <FilterValueInput
                filter={editingFilter.definition}
                operator={editingFilter.operator}
                value={editingFilter.value}
                onChange={handleValueChange}
                autoFocus
              />

              {needsManualApply && (
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingFilter(null)}
                  >
                    {t('cancel')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyManual}
                    disabled={isFilterValueEmpty(editingFilter.value)}
                  >
                    {t('apply')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
