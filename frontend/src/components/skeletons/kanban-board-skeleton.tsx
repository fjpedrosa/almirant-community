import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface KanbanBoardSkeletonProps {
  columns?: number;
  cardsPerColumn?: number;
  className?: string;
}

export function KanbanBoardSkeleton({
  columns = 4,
  cardsPerColumn = 3,
  className,
}: KanbanBoardSkeletonProps) {
  return (
    <div className={cn("p-6 space-y-4", className)}>
      <Skeleton className="h-10 w-48" />
      <div className="flex gap-4">
        {Array.from({ length: columns }, (_, colIndex) => (
          <div key={colIndex} className="w-[300px] space-y-3">
            <Skeleton className="h-6 w-32" />
            {Array.from({ length: cardsPerColumn }, (_, cardIndex) => (
              <Skeleton
                key={cardIndex}
                className="h-[100px] w-full rounded-lg"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
