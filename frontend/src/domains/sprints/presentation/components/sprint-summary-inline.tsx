import { useTranslations } from "next-intl";
import { CheckCircle2, Zap, Bot } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { SprintSummaryInlineProps } from "../../domain/types";

const formatCurrency = (amount: number): string => {
  if (amount === 0) return "$0";
  return `$${amount.toFixed(2)}`;
};

export const SprintSummaryInline: React.FC<SprintSummaryInlineProps> = ({
  summary,
  isLoading,
}) => {
  const t = useTranslations("sprints.summary");

  if (isLoading) {
    return (
      <div className="flex items-center gap-4 px-3 py-2 bg-muted/30 rounded-md">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 bg-muted/30 rounded-md text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        <span>
          <span className="font-medium text-foreground">
            {summary.completedCount}
          </span>{" "}
          {t("completed")}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Zap className="h-3.5 w-3.5 text-amber-500" />
        <span>
          <span className="font-medium text-foreground">
            {summary.velocity.toFixed(1)}
          </span>{" "}
          {t("velocity")}
        </span>
      </div>
      {summary.aiCost > 0 && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Bot className="h-3.5 w-3.5 text-purple-500" />
          <span>
            <span className="font-medium text-foreground">
              {formatCurrency(summary.aiCost)}
            </span>{" "}
            {t("aiCost")}
          </span>
        </div>
      )}
    </div>
  );
};
