"use client";

import { BarTimelineChart } from "@/components/charts";
import { Skeleton } from "@/components/ui/skeleton";
import type { UsageHourlyPoint } from "../../application/hooks/use-usage-daily-data";

interface UsageHourlyDistributionProps {
  data: UsageHourlyPoint[];
  isLoading: boolean;
  noDataMessage: string;
  sessionsLabel: string;
  peakLabel: string;
  minutesLabel: string;
}

const formatMinutes = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
};

export const UsageHourlyDistribution: React.FC<UsageHourlyDistributionProps> = ({
  data,
  isLoading,
  noDataMessage,
  sessionsLabel,
  peakLabel,
  minutesLabel,
}) => {
  if (isLoading) {
    return <Skeleton className="h-44 w-full sm:h-[260px]" />;
  }

  const hasData = data.some((entry) => entry.totalJobs > 0 || entry.totalSeconds > 0);

  if (!hasData) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-muted-foreground sm:h-[260px]">
        {noDataMessage}
      </div>
    );
  }

  const chartData = data.map((entry) => ({
    date: entry.label,
    value: entry.totalJobs,
  }));

  const peak = data.reduce((currentPeak, entry) => {
    if (entry.totalJobs > currentPeak.totalJobs) return entry;
    if (entry.totalJobs === currentPeak.totalJobs && entry.totalSeconds > currentPeak.totalSeconds) return entry;
    return currentPeak;
  }, data[0]!);

  return (
    <div className="space-y-3">
      <div className="h-44 sm:h-[240px]">
        <BarTimelineChart
          data={chartData}
          height="100%"
          yAxisLabel={sessionsLabel}
          showGrid
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {peakLabel}: <span className="font-medium text-foreground">{peak.label}</span>
        {" · "}
        {peak.totalJobs} {sessionsLabel.toLowerCase()}
        {" · "}
        {formatMinutes(peak.totalSeconds)} {minutesLabel.toLowerCase()}
      </p>
    </div>
  );
};
