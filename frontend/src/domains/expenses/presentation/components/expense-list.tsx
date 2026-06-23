import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ExpenseListProps, ExpenseStatus, ExpenseWithRelations } from "../../domain/types";
import { ExpenseCategoryBadge } from "./expense-category-badge";
import { ExpenseCurrencyBadge } from "./expense-currency-badge";

const STATUS_VARIANTS: Record<
  ExpenseStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "secondary",
  pending_approval: "outline",
  approved: "default",
  rejected: "destructive",
  paid: "default",
  void: "secondary",
};

const SKELETON_ROWS = 5;

const ExpenseRowSkeleton = () => (
  <TableRow>
    {Array.from({ length: 7 }).map((_, i) => (
      <TableCell key={i}>
        <Skeleton className="h-4 w-full" />
      </TableCell>
    ))}
  </TableRow>
);

const formatAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return num.toFixed(2);
};

const formatDate = (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
};

interface ExpenseRowProps {
  item: ExpenseWithRelations;
  onOpenItem: (item: ExpenseWithRelations) => void;
  onDelete: (item: ExpenseWithRelations) => void;
}

const ExpenseRow = ({ item, onOpenItem, onDelete }: ExpenseRowProps) => {
  const t = useTranslations("expenses");

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => onOpenItem(item)}
    >
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {formatDate(item.expenseDate)}
      </TableCell>
      <TableCell>
        <div className="font-medium">{item.title}</div>
        {item.vendor && (
          <div className="text-xs text-muted-foreground">{item.vendor}</div>
        )}
      </TableCell>
      <TableCell className="text-right font-mono whitespace-nowrap">
        {formatAmount(item.amount)}
      </TableCell>
      <TableCell>
        <ExpenseCurrencyBadge currency={item.currency} />
      </TableCell>
      <TableCell>
        <ExpenseCategoryBadge category={item.category} />
      </TableCell>
      <TableCell>
        {item.paidByUser ? (
          <span className="text-sm">{item.paidByUser.name}</span>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANTS[item.status]}>{t(`status.${item.status}`)}</Badge>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">{t("list.deleteAriaLabel")}</span>
        </Button>
      </TableCell>
    </TableRow>
  );
};

export const ExpenseList = ({ items, isLoading, hasActiveFilters, onOpenItem, onDelete }: ExpenseListProps) => {
  const t = useTranslations("expenses");

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">{t("list.date")}</TableHead>
            <TableHead>{t("list.titleVendor")}</TableHead>
            <TableHead className="text-right w-28">{t("list.amount")}</TableHead>
            <TableHead className="w-28">{t("list.currency")}</TableHead>
            <TableHead>{t("list.category")}</TableHead>
            <TableHead>{t("list.paidBy")}</TableHead>
            <TableHead className="w-28">{t("list.status")}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <ExpenseRowSkeleton key={i} />
            ))
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                {hasActiveFilters
                  ? t("list.emptyFiltered")
                  : t("list.emptyDefault")}
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <ExpenseRow
                key={item.id}
                item={item}
                onOpenItem={onOpenItem}
                onDelete={onDelete}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};
