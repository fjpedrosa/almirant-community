import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { AsyncSelectInput } from './async-select-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FilterDefinition, FilterOperator, FilterOption } from '../../../domain/filter-types';

const MAX_INLINE_OPTIONS = 5;

type FilterValueInputProps = {
  filter: FilterDefinition;
  operator: FilterOperator;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  autoFocus?: boolean;
};

const FilterOptionPill = ({
  option,
  isSelected,
}: {
  option: FilterOption;
  isSelected?: boolean;
}) => (
  <span
    className={cn(
      'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
      option.className ??
        (isSelected
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-muted/60 text-foreground'),
    )}
  >
    {option.color && (
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: option.color }}
        aria-hidden="true"
      />
    )}
    <span className="truncate">{option.label}</span>
    {option.count !== undefined && (
      <span className="text-[10px] opacity-70">{option.count}</span>
    )}
  </span>
);

export const FilterValueInput = ({
  filter,
  operator: _operator, // eslint-disable-line @typescript-eslint/no-unused-vars
  value,
  onChange,
  autoFocus,
}: FilterValueInputProps) => {
  const t = useTranslations('common');

  const [localValue, setLocalValue] = useState(value);
  const isDebounced = filter.type === 'text' || filter.type === 'number';
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Sync local state when external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounced onChange for text/number
  useEffect(() => {
    if (!isDebounced) return;
    debounceTimerRef.current = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 800);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [localValue, isDebounced]); // intentionally exclude onChange and value to prevent loops

  switch (filter.type) {
    case 'text':
      return (
        <Input
          value={(localValue as string) || ''}
          onChange={(e) => setLocalValue(e.target.value)}
          placeholder={filter.placeholder || t('typeToFilter')}
          className="h-8 text-sm"
          autoFocus={autoFocus}
        />
      );

    case 'number':
      return (
        <Input
          type="number"
          value={(localValue as string) || ''}
          onChange={(e) => setLocalValue(e.target.value)}
          placeholder={filter.placeholder}
          className="h-8 text-sm"
          autoFocus={autoFocus}
        />
      );

    case 'select': {
      const optionCount = filter.options?.length ?? 0;

      if (optionCount > 0 && optionCount < MAX_INLINE_OPTIONS) {
        return (
          <div className="-mx-1">
            {filter.options!.map((option) => {
              const isSelected = value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none cursor-pointer',
                    isSelected
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                  )}
                  onClick={() => onChange(option.value)}
                >
                  <FilterOptionPill option={option} isSelected={isSelected} />
                  {isSelected && <Check className="h-3.5 w-3.5 text-foreground" />}
                </button>
              );
            })}
          </div>
        );
      }

      return (
        <Select value={value as string} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={t('selectOption')} />
          </SelectTrigger>
          <SelectContent>
            {filter.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <FilterOptionPill option={option} isSelected={value === option.value} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    case 'multi_select': {
      const selected: string[] = Array.isArray(value) ? value : [];

      const toggleOption = (optionValue: string) => {
        if (selected.includes(optionValue)) {
          onChange(selected.filter((v) => v !== optionValue));
        } else {
          onChange([...selected, optionValue]);
        }
      };

      return (
        <div className="-mx-1 max-h-48 overflow-y-auto">
          {filter.options?.map((option) => {
            const isChecked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-2 py-1.5 cursor-pointer',
                  isChecked ? 'bg-accent/50' : 'hover:bg-accent/30',
                )}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => toggleOption(option.value)}
                />
                <FilterOptionPill option={option} isSelected={isChecked} />
              </label>
            );
          })}
        </div>
      );
    }

    case 'boolean': {
      const booleanOptions = [
        { value: 'true', label: t('yes') },
        { value: 'false', label: t('no') },
      ];

      return (
        <div className="-mx-1">
          {booleanOptions.map((option) => {
            const isSelected = String(value) === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={cn(
                  'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none cursor-pointer',
                  isSelected
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50',
                )}
                onClick={() => onChange(option.value)}
              >
                <span>{option.label}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-foreground" />}
              </button>
            );
          })}
        </div>
      );
    }

    case 'date_range': {
      const dateValue = Array.isArray(value) ? value : ['', ''];
      const fromDate = dateValue[0] || '';
      const toDate = dateValue[1] || '';

      return (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t('from')}</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => onChange([e.target.value, toDate])}
              min={filter.dateSettings?.minDate}
              max={filter.dateSettings?.maxDate || toDate || undefined}
              className="h-8 text-sm"
              autoFocus={autoFocus}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t('to')}</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => onChange([fromDate, e.target.value])}
              min={filter.dateSettings?.minDate || fromDate || undefined}
              max={filter.dateSettings?.maxDate}
              className="h-8 text-sm"
            />
          </div>
        </div>
      );
    }

    case 'async_select':
      return (
        <AsyncSelectInput
          filter={filter}
          value={value}
          onChange={(val) => onChange(val)}
        />
      );

    default:
      return (
        <Input
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={filter.placeholder || t('value')}
          className="h-8 text-sm"
          autoFocus={autoFocus}
        />
      );
  }
};
