import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Hash, Zap, TrendingUp, TrendingDown } from "lucide-react";

interface UserUsageKpiCardsProps {
  billableSeconds: number;
  totalJobs: number;
  breakdown: Record<string, number>;
  previousBillableSeconds: number;
  isLoading: boolean;
}

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};

const getMostActiveType = (breakdown: Record<string, number>): string => {
  let maxKey = "\u2014";
  let maxVal = 0;
  for (const [key, val] of Object.entries(breakdown)) {
    if (val > maxVal) {
      maxVal = val;
      maxKey = key;
    }
  }
  return maxKey.charAt(0).toUpperCase() + maxKey.slice(1);
};

const computeTrend = (
  current: number,
  previous: number
): { label: string; isUp: boolean } => {
  if (previous === 0) {
    return { label: current > 0 ? "+100%" : "0%", isUp: current > 0 };
  }
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? "+" : "";
  return { label: `${sign}${change.toFixed(1)}%`, isUp: change >= 0 };
};

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subtext?: string;
  subtextClassName?: string;
  isLoading: boolean;
  gradient: string;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  subtext,
  subtextClassName,
  isLoading,
  gradient,
}: KpiCardProps) {
  return (
    <div
      className={`relative h-28 overflow-hidden rounded-lg border bg-gradient-to-br ${gradient} p-4`}
    >
      <Icon className="absolute right-3 top-3 h-8 w-8 opacity-20" />
      <div className="flex h-full flex-col justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div>
            <p className="text-2xl font-bold">{value}</p>
            {subtext && (
              <p className={`text-xs ${subtextClassName ?? "text-muted-foreground"}`}>
                {subtext}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function UserUsageKpiCards({
  billableSeconds,
  totalJobs,
  breakdown,
  previousBillableSeconds,
  isLoading,
}: UserUsageKpiCardsProps) {
  const trend = computeTrend(billableSeconds, previousBillableSeconds);
  const TrendIcon = trend.isUp ? TrendingUp : TrendingDown;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={Clock}
        label="Active Time"
        value={formatDuration(billableSeconds)}
        subtext="This month"
        isLoading={isLoading}
        gradient="from-emerald-50/50 to-emerald-100/50 dark:from-emerald-950/20 dark:to-emerald-900/20"
      />
      <KpiCard
        icon={Hash}
        label="Sessions"
        value={totalJobs.toLocaleString()}
        subtext="This month"
        isLoading={isLoading}
        gradient="from-blue-50/50 to-blue-100/50 dark:from-blue-950/20 dark:to-blue-900/20"
      />
      <KpiCard
        icon={Zap}
        label="Most Active Type"
        value={getMostActiveType(breakdown)}
        isLoading={isLoading}
        gradient="from-purple-50/50 to-purple-100/50 dark:from-purple-950/20 dark:to-purple-900/20"
      />
      <KpiCard
        icon={TrendIcon}
        label="Trend vs Last Month"
        value={trend.label}
        subtextClassName={trend.isUp ? "text-emerald-600" : "text-red-500"}
        subtext={`Previous: ${formatDuration(previousBillableSeconds)}`}
        isLoading={isLoading}
        gradient="from-amber-50/50 to-amber-100/50 dark:from-amber-950/20 dark:to-amber-900/20"
      />
    </div>
  );
}
