import { Skeleton } from "@/components/ui/skeleton";
import { DonutChart } from "@/components/charts/donut-chart";
import type { DonutChartDataItem } from "@/components/charts/donut-chart";

interface UsageSessionDonutProps {
  breakdown: Record<string, number>;
  isLoading: boolean;
}

const SESSION_COLORS: Record<string, string> = {
  implement: "#6366f1",
  validate: "#06b6d4",
  planning: "#f59e0b",
  review: "#8b5cf6",
  chat: "#22c55e",
};

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function UsageSessionDonut({ breakdown, isLoading }: UsageSessionDonutProps) {
  if (isLoading) {
    return <Skeleton className="h-[250px] w-full rounded-lg" />;
  }

  const entries = Object.entries(breakdown).filter(([, val]) => val > 0);

  if (entries.length === 0) {
    return null;
  }

  const totalMinutes = Math.round(
    entries.reduce((sum, [, seconds]) => sum + seconds, 0) / 60
  );

  const data: DonutChartDataItem[] = entries
    .sort(([, a], [, b]) => b - a)
    .map(([type, seconds]) => ({
      label: capitalize(type),
      value: Math.round(seconds / 60),
      color: SESSION_COLORS[type] ?? "#94a3b8",
    }));

  return (
    <DonutChart
      data={data}
      height={250}
      centerText={String(totalMinutes)}
      centerSubtext="min"
    />
  );
}
