import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RecurrenceType } from "../../domain/types";

interface RecurrenceBadgeProps {
  recurrenceType?: RecurrenceType | null;
  recurrenceCount?: number | null;
}

const getRecurrenceConfig = (
  type: RecurrenceType | null | undefined
): { label: string; className: string } | null => {
  switch (type) {
    case "exact_recurrence":
      return {
        label: "Recurrent",
        className:
          "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
      };
    case "cross_runtime_recurrence":
      return {
        label: "Cross-runtime",
        className:
          "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400",
      };
    case "variant":
      return {
        label: "Variant",
        className:
          "border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
      };
    case "new":
    case null:
    case undefined:
    default:
      return null;
  }
};

export const RecurrenceBadge: React.FC<RecurrenceBadgeProps> = ({
  recurrenceType,
  recurrenceCount,
}) => {
  const config = getRecurrenceConfig(recurrenceType);

  if (!config) {
    return null;
  }

  const countLabel =
    recurrenceCount != null && recurrenceCount > 0
      ? ` (${recurrenceCount})`
      : "";

  return (
    <Badge
      variant="outline"
      className={cn("text-xs", config.className)}
      data-testid="recurrence-badge"
    >
      {config.label}
      {countLabel}
    </Badge>
  );
};
