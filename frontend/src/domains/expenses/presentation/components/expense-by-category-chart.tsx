import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { DonutChart } from "@/components/charts/donut-chart";
import type { DonutDataItem } from "../../application/hooks/use-expense-dashboard";

interface Props {
  data: DonutDataItem[];
  isLoading: boolean;
}

export const ExpenseByCategoryChart = ({ data, isLoading }: Props) => {
  const t = useTranslations("expenses");

  if (isLoading) return <Skeleton className="h-[300px]" />;
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-center py-12">
        {t("charts.noData")}
      </p>
    );
  }
  return (
    <DonutChart
      data={data}
      title={t("charts.byCategory")}
      centerText={`${data.length}`}
      centerSubtext={t("charts.categories")}
    />
  );
};
