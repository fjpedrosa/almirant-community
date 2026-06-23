'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AppliedFilter, FilterDefinition, FilterOption } from '../../../domain/filter-types';

type FilterChipProps = {
  filter: AppliedFilter;
  onRemove: (filterId: string) => void;
  onEdit?: (filterId: string) => void;
  filterDefinition?: FilterDefinition;
};

const FilterValuePill = ({ option }: { option: FilterOption }) => (
  <span
    className={cn(
      'inline-flex max-w-[7rem] items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium',
      option.className ?? 'border-border bg-muted/60 text-foreground',
    )}
  >
    {option.color && (
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: option.color }}
        aria-hidden="true"
      />
    )}
    <span className="truncate">{option.label}</span>
  </span>
);

const renderFilterValue = (
  filter: AppliedFilter,
  filterDefinition: FilterDefinition | undefined,
) => {
  if (!Array.isArray(filter.value) || !filterDefinition?.options) {
    const displayValue =
      filter.displayValue ||
      (Array.isArray(filter.value) ? filter.value.join(', ') : filter.value);

    return (
      <span className="text-foreground pr-1">
        {displayValue}
      </span>
    );
  }

  const optionByValue = new Map(
    filterDefinition.options.map((option) => [option.value, option]),
  );
  const selectedOptions = filter.value.map((value) =>
    optionByValue.get(value) ?? { value, label: value },
  );
  const visibleOptions = selectedOptions.slice(0, 3);
  const hiddenCount = selectedOptions.length - visibleOptions.length;

  return (
    <span className="flex max-w-[18rem] items-center gap-1 overflow-hidden pr-1">
      {visibleOptions.map((option) => (
        <FilterValuePill key={option.value} option={option} />
      ))}
      {hiddenCount > 0 && (
        <span className="rounded-full border border-border bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          +{hiddenCount}
        </span>
      )}
    </span>
  );
};

export const FilterChip = ({
  filter,
  onRemove,
  onEdit,
  filterDefinition,
}: FilterChipProps) => {
  return (
    <div
      className="inline-flex items-center h-7 rounded-md border bg-background text-sm cursor-pointer hover:border-foreground/30 transition-colors"
      onClick={() => onEdit?.(filter.id)}
    >
      <span className="pl-2 pr-1 text-muted-foreground font-medium">
        {filter.label}
      </span>
      {renderFilterValue(filter, filterDefinition)}
      <button
        type="button"
        className="inline-flex items-center justify-center h-full px-1 rounded-r-md text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(filter.id);
        }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};
