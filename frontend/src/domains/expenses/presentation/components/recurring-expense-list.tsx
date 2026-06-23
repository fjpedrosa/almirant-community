import { Button } from "@/components/ui/button";
import { RecurringExpenseStatusBadge } from "./recurring-expense-status-badge";
import type { RecurringExpense } from "../../domain/types";

const RECURRENCE_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function formatRenewalDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  items: RecurringExpense[];
  isLoading: boolean;
  onToggleActive: (item: RecurringExpense) => void;
  onDelete: (id: string) => void;
}

export const RecurringExpenseList = ({ items, isLoading, onToggleActive, onDelete }: Props) => {
  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Loading recurring expenses...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No recurring expenses found.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Title / Vendor</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
            <th className="px-4 py-3 text-left font-medium">Recurrence</th>
            <th className="px-4 py-3 text-left font-medium">Next Renewal</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/25">
              <td className="px-4 py-3">
                <div className="font-medium">{item.title}</div>
                {item.vendor && (
                  <div className="text-xs text-muted-foreground">{item.vendor}</div>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {item.amount} {item.currency}
              </td>
              <td className="px-4 py-3">
                {RECURRENCE_LABELS[item.recurrence] ?? item.recurrence}
              </td>
              <td className="px-4 py-3">{formatRenewalDate(item.nextRenewalDate)}</td>
              <td className="px-4 py-3">
                <RecurringExpenseStatusBadge
                  isActive={item.isActive}
                  cancelledAt={item.cancelledAt}
                />
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onToggleActive(item)}
                  >
                    {item.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(item.id)}
                  >
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
