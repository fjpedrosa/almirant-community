import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChatPageSkeletonProps {
  sidebarItems?: number;
  messages?: number;
  className?: string;
}

export function ChatPageSkeleton({
  sidebarItems = 6,
  messages = 4,
  className,
}: ChatPageSkeletonProps) {
  return (
    <div className={cn("flex h-full w-full overflow-hidden", className)}>
      {/* Sidebar (hidden on mobile) */}
      <div className="hidden md:flex h-full flex-col w-64 border-r border-border bg-muted/30 shrink-0">
        {/* Header */}
        <div className="flex flex-col gap-1.5 px-3 pt-4 pb-3">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-9 flex-1" />
            <Skeleton className="size-8" />
          </div>
          <Skeleton className="h-9 w-full" />
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-hidden py-2 px-3 space-y-2">
          {/* Group label */}
          <Skeleton className="h-4 w-16 mb-2" />
          {Array.from({ length: sidebarItems }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="relative flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Chat messages area */}
        <div className="flex-1 overflow-hidden p-4 space-y-4">
          {Array.from({ length: messages }, (_, i) => {
            const isUser = i % 2 === 1;
            return isUser ? (
              /* User message - right aligned */
              <div key={i} className="flex justify-end">
                <div className="space-y-2 max-w-md">
                  <Skeleton className="h-4 w-48 ml-auto" />
                  <Skeleton className="h-4 w-32 ml-auto" />
                </div>
              </div>
            ) : (
              /* Assistant message - left aligned with avatar */
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-2 max-w-xl">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  {i === 0 && <Skeleton className="h-4 w-1/2" />}
                </div>
              </div>
            );
          })}
        </div>

        {/* Input bar at bottom */}
        <div className="border-t border-border p-4">
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
