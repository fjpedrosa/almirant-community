export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'between'
  | 'in';

export type FilterType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'boolean'
  | 'date_range'
  | 'async_select';

export type FilterOption = {
  value: string;
  label: string;
  count?: number;
  color?: string | null;
  className?: string;
};

export type AsyncFilterFetcher = (params: {
  search: string;
  page: number;
}) => Promise<{
  options: FilterOption[];
  hasMore: boolean;
}>;

export type FilterDefinition = {
  id: string;
  label: string;
  type: FilterType;
  group?: string;
  operators: FilterOperator[];
  options?: FilterOption[];
  placeholder?: string;
  defaultOperator?: FilterOperator;
  dateSettings?: { minDate?: string; maxDate?: string };
  fetcher?: AsyncFilterFetcher;
};

export type AppliedFilter = {
  id: string;
  fieldId: string;
  label: string;
  operator: FilterOperator;
  value: string | string[];
  displayValue?: string;
};

export type DynamicFiltersConfig = {
  definitions: FilterDefinition[];
  searchPlaceholder?: string;
  maxFilters?: number;
  allowDuplicates?: boolean;
  resetPageOnChange?: boolean;
  initialFilters?: Array<{
    fieldId: string;
    operator: FilterOperator;
    value: string | string[];
  }>;
};
