import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface DetailPageSkeletonProps {
  className?: string;
}

export function DetailPageSkeleton({ className }: DetailPageSkeletonProps) {
  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Title */}
      <Skeleton className="h-8 w-64" />

      {/* Tabs bar */}
      <div className="flex items-center gap-4 border-b pb-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-28" />
      </div>

      {/* Content area */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}
