import type { PaginationMeta } from "@/domains/shared/domain/types";

// Enums / literals
export type ExpenseStatus = "draft" | "pending_approval" | "approved" | "rejected" | "paid" | "void";
export type InvoiceProcessingStatus = "pending" | "processing" | "processed" | "failed";
export type ExpenseRecurrence = "weekly" | "monthly" | "quarterly" | "yearly";
export type CurrencyCode =
  | "EUR"
  | "USD"
  | "GBP"
  | "CHF"
  | "JPY"
  | "CAD"
  | "AUD"
  | "MXN"
  | "BRL"
  | "CLP"
  | "COP"
  | "ARS";

// Entity types
export interface ExpenseCategory {
  id: string;
  organizationId: string;
  parentId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  order: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  id: string;
  organizationId: string;
  projectId: string | null;
  categoryId: string | null;
  paidByUserId: string | null;
  recurringExpenseId: string | null;
  title: string;
  description: string | null;
  vendor: string | null;
  amount: string;
  currency: CurrencyCode;
  amountEur: string | null;
  exchangeRate: string | null;
  status: ExpenseStatus;
  expenseDate: string;
  invoiceFileName: string | null;
  invoiceFileUrl: string | null;
  invoiceFileSize: number | null;
  invoiceMimeType: string | null;
  invoiceProcessingStatus: InvoiceProcessingStatus | null;
  invoiceProcessedData: Record<string, unknown> | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseWithRelations extends Expense {
  category: ExpenseCategory | null;
  paidByUser: { id: string; name: string; email: string; image: string | null } | null;
  tags: Array<{ id: string; name: string; color: string | null }>;
}

export interface RecurringExpense {
  id: string;
  organizationId: string;
  projectId: string | null;
  categoryId: string | null;
  paidByUserId: string | null;
  title: string;
  vendor: string | null;
  amount: string;
  currency: CurrencyCode;
  recurrence: ExpenseRecurrence;
  anchorDate: string;
  nextRenewalDate: string | null;
  alertDaysBefore: number | null;
  isActive: boolean;
  startedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyRate {
  id: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: string;
  rateDate: string;
  fetchedAt: string;
}

// Request types
export interface CreateExpenseRequest {
  title: string;
  description?: string | null;
  vendor?: string | null;
  amount: string;
  currency: CurrencyCode;
  categoryId?: string | null;
  paidByUserId?: string | null;
  expenseDate: string;
  status?: ExpenseStatus;
  projectId?: string | null;
}

export interface UpdateExpenseRequest extends Partial<CreateExpenseRequest> {}

export interface CreateCategoryRequest {
  name: string;
  icon?: string | null;
  color?: string | null;
  parentId?: string | null;
}

export interface UpdateCategoryRequest extends Partial<CreateCategoryRequest> {}

export interface CreateRecurringExpenseRequest {
  title: string;
  vendor?: string | null;
  amount: string;
  currency: CurrencyCode;
  recurrence: ExpenseRecurrence;
  anchorDate: string;
  alertDaysBefore?: number;
  categoryId?: string | null;
  paidByUserId?: string | null;
  projectId?: string | null;
}

export interface UpdateRecurringExpenseRequest extends Partial<CreateRecurringExpenseRequest> {}

// Filter types
export interface ExpenseFilters {
  search?: string;
  paidByUserId?: string;
  categoryId?: string;
  status?: ExpenseStatus;
  currency?: CurrencyCode;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  limit: number;
}

// Dashboard / aggregation types
export interface ExpenseByPerson {
  userId: string;
  userName: string;
  userImage: string | null;
  totalAmount: string;
  expenseCount: number;
}

export interface ExpenseByCategory {
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  totalAmount: string;
  expenseCount: number;
}

export interface ExpenseTimeline {
  month: string;
  totalAmount: string;
  expenseCount: number;
}

export interface ExpenseAggregations {
  totalAmount: string;
  byPerson: ExpenseByPerson[];
  byCategory: ExpenseByCategory[];
  byMonth: ExpenseTimeline[];
  recentExpenses: ExpenseWithRelations[];
}

export interface RecurringSummary {
  totalMonthlyAmount: string;
  activeCount: number;
}

// Paginated response
export interface PaginatedExpensesResponse {
  items: ExpenseWithRelations[];
  meta: PaginationMeta;
}

// Component props
export interface ExpenseListProps {
  items: ExpenseWithRelations[];
  isLoading: boolean;
  hasActiveFilters: boolean;
  onOpenItem: (item: ExpenseWithRelations) => void;
  onDelete: (item: ExpenseWithRelations) => void;
}

export interface ExpenseFilterBarProps {
  filters: ExpenseFilters;
  hasActiveFilters: boolean;
  onSearchChange: (v: string) => void;
  onStatusChange: (v: ExpenseStatus | undefined) => void;
  onCurrencyChange: (v: CurrencyCode | undefined) => void;
  onPaidByChange: (v: string | undefined) => void;
  onCategoryChange: (v: string | undefined) => void;
  onDateFromChange: (v: string | undefined) => void;
  onDateToChange: (v: string | undefined) => void;
  onClearFilters: () => void;
}

export interface ExpenseDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ExpenseWithRelations | null;
  isLoading: boolean;
  onStatusChange: (status: ExpenseStatus) => void;
  onDelete: () => void;
  onEdit: () => void;
}

export interface CreateExpenseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ExpenseCategory[];
  isPending: boolean;
  onSubmit: () => void;
}
