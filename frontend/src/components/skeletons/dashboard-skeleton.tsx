import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface DashboardSkeletonProps {
  kpiCards?: number;
  tableRows?: number;
  className?: string;
}

export function DashboardSkeleton({
  kpiCards = 4,
  tableRows = 5,
  className,
}: DashboardSkeletonProps) {
  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Header */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* KPI Cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: kpiCards }, (_, i) => (
          <div key={i} className="rounded-xl border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-7 w-24" />
              </div>
              <Skeleton className="size-8 rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Charts row - 2 side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </div>
        <div className="rounded-xl border p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </div>
      </div>

      {/* Table section */}
      <div className="rounded-xl border overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-4 px-4 py-3 bg-muted/30 border-b">
          <Skeleton className="h-4 w-[200px]" />
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-4 w-[100px]" />
          <Skeleton className="h-4 w-[80px]" />
        </div>

        {/* Table rows */}
        {Array.from({ length: tableRows }, (_, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-4 px-4 py-3",
              i < tableRows - 1 && "border-b"
            )}
          >
            <Skeleton className="h-4 w-[200px]" />
            <Skeleton className="h-4 w-[120px]" />
            <Skeleton className="h-4 w-[100px]" />
            <Skeleton className="h-4 w-[80px]" />
          </div>
        ))}
      </div>
    </div>
  );
}
