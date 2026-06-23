import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CurrencyCode, ExpenseFilterBarProps, ExpenseStatus } from "../../domain/types";

const STATUS_KEYS: ExpenseStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "paid",
  "void",
];

const CURRENCY_OPTIONS: CurrencyCode[] = [
  "EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "MXN", "BRL", "CLP", "COP", "ARS",
];

const ALL_VALUE = "__all__";

export const ExpenseFilterBar = ({
  filters,
  hasActiveFilters,
  onSearchChange,
  onStatusChange,
  onCurrencyChange,
  onDateFromChange,
  onDateToChange,
  onClearFilters,
}: ExpenseFilterBarProps) => {
  const t = useTranslations("expenses");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder={t("filter.searchPlaceholder")}
        value={filters.search ?? ""}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-9 w-56"
      />

      <Select
        value={filters.status ?? ALL_VALUE}
        onValueChange={(v) => onStatusChange(v === ALL_VALUE ? undefined : (v as ExpenseStatus))}
      >
        <SelectTrigger className="h-9 w-44">
          <SelectValue placeholder={t("filter.allStatuses")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t("filter.allStatuses")}</SelectItem>
          {STATUS_KEYS.map((statusKey) => (
            <SelectItem key={statusKey} value={statusKey}>
              {t(`status.${statusKey}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.currency ?? ALL_VALUE}
        onValueChange={(v) => onCurrencyChange(v === ALL_VALUE ? undefined : (v as CurrencyCode))}
      >
        <SelectTrigger className="h-9 w-32">
          <SelectValue placeholder={t("filter.currency")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>{t("filter.allCurrencies")}</SelectItem>
          {CURRENCY_OPTIONS.map((code) => (
            <SelectItem key={code} value={code}>
              {code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={filters.dateFrom ?? ""}
        onChange={(e) => onDateFromChange(e.target.value || undefined)}
        className="h-9 w-40"
        aria-label={t("filter.fromDate")}
      />

      <Input
        type="date"
        value={filters.dateTo ?? ""}
        onChange={(e) => onDateToChange(e.target.value || undefined)}
        className="h-9 w-40"
        aria-label={t("filter.toDate")}
      />

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="h-9 gap-1">
          <X className="h-4 w-4" />
          {t("filter.clearFilters")}
        </Button>
      )}
    </div>
  );
};
