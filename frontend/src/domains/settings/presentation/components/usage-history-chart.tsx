import { Skeleton } from "@/components/ui/skeleton";
import { AreaTimelineChart } from "@/components/charts/area-timeline-chart";

interface UsageHistoryChartProps {
  history: Array<{
    period: string;
    totalSeconds: number;
    totalJobs: number;
    breakdown: Record<string, number>;
  }>;
  isLoading: boolean;
  noDataMessage?: string;
}

/**
 * Converts period string to ISO date.
 * "YYYY-MM" (monthly) -> "YYYY-MM-01"
 * "YYYY-MM-DD" (daily) -> used as-is
 */
const periodToDate = (period: string): string => {
  if (period.length === 7) {
    return `${period}-01`;
  }
  return period;
};

/**
 * Determines the appropriate date format based on period format.
 * Monthly data ("YYYY-MM") -> "MMM yyyy"
 * Daily data ("YYYY-MM-DD") -> "MMM d"
 */
const getDateFormat = (period: string): string => {
  if (period.length === 7) {
    return "MMM yyyy";
  }
  return "MMM d";
};

export function UsageHistoryChart({
  history,
  isLoading,
  noDataMessage,
}: UsageHistoryChartProps) {
  if (isLoading) {
    return (
      <div className="h-44 sm:h-[220px] flex items-center justify-center">
        <Skeleton className="h-full w-full rounded-md" />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {noDataMessage ?? "No history data available yet."}
      </p>
    );
  }

  const dateFormat = getDateFormat(history[0].period);

  const chartData = history.map((entry) => ({
    date: periodToDate(entry.period),
    value: Math.round(entry.totalSeconds / 60),
  }));

  return (
    <div className="h-44 sm:h-[220px]">
      <AreaTimelineChart
        data={chartData}
        height="100%"
        dateFormat={dateFormat}
        yAxisLabel="Minutes"
        showGrid
      />
    </div>
  );
}
