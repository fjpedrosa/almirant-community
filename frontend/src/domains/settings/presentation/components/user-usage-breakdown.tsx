import { Skeleton } from "@/components/ui/skeleton";

interface UserUsageBreakdownProps {
  breakdown: Record<string, number>;
  isLoading: boolean;
  noDataMessage?: string;
}

const SESSION_COLORS: Record<string, string> = {
  implement: "#6366f1",
  validate: "#06b6d4",
  planning: "#f59e0b",
  review: "#8b5cf6",
  chat: "#22c55e",
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};

export function UserUsageBreakdown({
  breakdown,
  isLoading,
  noDataMessage,
}: UserUsageBreakdownProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const entries = Object.entries(breakdown).filter(([, val]) => val > 0);
  const total = entries.reduce((sum, [, val]) => sum + val, 0);

  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {noDataMessage ?? "No usage data available yet."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {entries
        .sort(([, a], [, b]) => b - a)
        .map(([type, seconds]) => {
          const pct = total > 0 ? (seconds / total) * 100 : 0;
          const color = SESSION_COLORS[type] ?? "#94a3b8";
          const isPlanning = type === "planning";
          const label =
            type.charAt(0).toUpperCase() +
            type.slice(1) +
            (isPlanning ? " (planning)" : "");

          return (
            <div key={type} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground">
                  {formatDuration(seconds)} ({pct.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}
