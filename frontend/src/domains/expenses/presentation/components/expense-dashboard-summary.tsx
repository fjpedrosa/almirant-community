import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, Receipt, RefreshCw } from "lucide-react";

interface Props {
  totalAmount: string;
  monthlyRecurring: string;
  activeRecurringCount: number;
  recentCount: number;
  isLoading: boolean;
}

const formatEur = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return "€0.00";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(num);
};

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  isLoading: boolean;
}

const StatCard = ({ title, value, icon, isLoading }: StatCardProps) => (
  <Card>
    <CardContent className="pt-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          {isLoading ? (
            <Skeleton className="mt-1 h-7 w-28" />
          ) : (
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          )}
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </div>
    </CardContent>
  </Card>
);

export const ExpenseDashboardSummary = ({
  totalAmount,
  monthlyRecurring,
  activeRecurringCount,
  recentCount,
  isLoading,
}: Props) => {
  const t = useTranslations("expenses");

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title={t("summary.totalExpenses")}
        value={formatEur(totalAmount)}
        icon={<DollarSign className="h-5 w-5" />}
        isLoading={isLoading}
      />
      <StatCard
        title={t("summary.monthlyRecurring")}
        value={formatEur(monthlyRecurring)}
        icon={<TrendingUp className="h-5 w-5" />}
        isLoading={isLoading}
      />
      <StatCard
        title={t("summary.activeSubscriptions")}
        value={String(activeRecurringCount)}
        icon={<RefreshCw className="h-5 w-5" />}
        isLoading={isLoading}
      />
      <StatCard
        title={t("summary.recentExpenses")}
        value={String(recentCount)}
        icon={<Receipt className="h-5 w-5" />}
        isLoading={isLoading}
      />
    </div>
  );
};
