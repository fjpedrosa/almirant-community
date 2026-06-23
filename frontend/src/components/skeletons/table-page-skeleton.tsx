import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface TablePageSkeletonProps {
  rows?: number;
  className?: string;
}

export function TablePageSkeleton({
  rows = 5,
  className,
}: TablePageSkeletonProps) {
  return (
    <div className={cn("p-6 space-y-4", className)}>
      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-[150px]" />
        <Skeleton className="h-9 w-[150px]" />
        <Skeleton className="h-9 w-[120px]" />
      </div>

      {/* Table */}
      <div className="space-y-2">
        {/* Table header */}
        <div className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-[200px]" />
          <Skeleton className="h-4 w-[140px]" />
          <Skeleton className="h-4 w-[100px]" />
          <Skeleton className="h-4 w-[120px]" />
        </div>

        {/* Table rows */}
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-4 w-[200px]" />
            <Skeleton className="h-4 w-[140px]" />
            <Skeleton className="h-4 w-[100px]" />
            <Skeleton className="h-4 w-[120px]" />
          </div>
        ))}
      </div>
    </div>
  );
}
