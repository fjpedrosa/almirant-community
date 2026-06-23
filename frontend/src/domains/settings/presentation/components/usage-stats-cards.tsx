import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Hash, Zap } from "lucide-react";

interface UsageStatsCardsProps {
  totalSeconds: number;
  totalJobs: number;
  breakdown: Record<string, number>;
  isLoading: boolean;
  totalTimeLabel: string;
  totalJobsLabel: string;
  mostActiveLabel: string;
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

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  isLoading: boolean;
  gradient: string;
}

function StatCard({ icon: Icon, label, value, isLoading, gradient }: StatCardProps) {
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
          <p className="text-2xl font-bold">{value}</p>
        )}
      </div>
    </div>
  );
}

export function UsageStatsCards({
  totalSeconds,
  totalJobs,
  breakdown,
  isLoading,
  totalTimeLabel,
  totalJobsLabel,
  mostActiveLabel,
}: UsageStatsCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        icon={Clock}
        label={totalTimeLabel}
        value={formatDuration(totalSeconds)}
        isLoading={isLoading}
        gradient="from-emerald-50/50 to-emerald-100/50 dark:from-emerald-950/20 dark:to-emerald-900/20"
      />
      <StatCard
        icon={Hash}
        label={totalJobsLabel}
        value={totalJobs.toLocaleString()}
        isLoading={isLoading}
        gradient="from-blue-50/50 to-blue-100/50 dark:from-blue-950/20 dark:to-blue-900/20"
      />
      <StatCard
        icon={Zap}
        label={mostActiveLabel}
        value={getMostActiveType(breakdown)}
        isLoading={isLoading}
        gradient="from-purple-50/50 to-purple-100/50 dark:from-purple-950/20 dark:to-purple-900/20"
      />
    </div>
  );
}
