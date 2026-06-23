"use client";

import { Skeleton } from "@/components/ui/skeleton";
import type { UsageProjectSummaryItem } from "../../application/hooks/use-usage-data";

interface UsageProjectBreakdownProps {
  items: UsageProjectSummaryItem[];
}

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};

const PROJECT_COLORS = [
  "#6366f1", "#06b6d4", "#f59e0b", "#8b5cf6", "#22c55e",
  "#ec4899", "#f97316", "#14b8a6", "#a855f7", "#64748b",
];

function ProjectRow({ item, index }: { item: UsageProjectSummaryItem; index: number }) {
  const color = PROJECT_COLORS[index % PROJECT_COLORS.length];

  if (item.isLoading) {
    return (
      <div className="flex items-center justify-between py-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <div
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm font-medium">{item.name}</span>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{formatDuration(item.totalSeconds)}</span>
        <span>{item.totalJobs} jobs</span>
      </div>
    </div>
  );
}

export function UsageProjectBreakdown({ items }: UsageProjectBreakdownProps) {
  return (
    <div className="divide-y">
      {items.map((item, index) => (
        <ProjectRow key={item.id} item={item} index={index} />
      ))}
    </div>
  );
}
