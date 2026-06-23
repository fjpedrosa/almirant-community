import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SidebarContentSkeletonProps {
  className?: string;
}

export function SidebarContentSkeleton({
  className,
}: SidebarContentSkeletonProps) {
  return (
    <div className={cn("flex gap-6 p-6", className)}>
      {/* Sidebar */}
      <div className="w-64 shrink-0 space-y-3">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-md" />
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}
