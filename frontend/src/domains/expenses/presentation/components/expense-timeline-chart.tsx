import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaTimelineChart } from "@/components/charts/area-timeline-chart";
import type { TimelineDataItem } from "../../application/hooks/use-expense-dashboard";

interface Props {
  data: TimelineDataItem[];
  isLoading: boolean;
}

export const ExpenseTimelineChart = ({ data, isLoading }: Props) => {
  const t = useTranslations("expenses");

  if (isLoading) return <Skeleton className="h-[300px]" />;
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground text-sm text-center py-12">
        {t("charts.noTimeline")}
      </p>
    );
  }
  return (
    <AreaTimelineChart
      data={data}
      title={t("charts.monthlySpend")}
      dateFormat="MMM yyyy"
      height={300}
    />
  );
};
