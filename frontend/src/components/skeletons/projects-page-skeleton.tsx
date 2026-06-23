import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

function ProjectCardSkeleton() {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="w-3 h-3 rounded-full" />
            <Skeleton className="h-5 w-32" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="space-y-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="flex flex-wrap gap-1">
          <Skeleton className="h-5 w-14 rounded" />
          <Skeleton className="h-5 w-12 rounded" />
          <Skeleton className="h-5 w-10 rounded" />
        </div>
        <Skeleton className="h-3 w-24" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
      </CardContent>
    </Card>
  );
}

export function ProjectsPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-5 sm:space-y-6 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32 sm:h-9" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
          <Skeleton className="h-9 w-full sm:w-28" />
          <Skeleton className="h-9 w-full sm:w-32" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="space-y-1">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-10 w-full sm:w-[280px]" />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="relative w-full sm:max-w-sm">
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-10 w-full sm:w-[180px]" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <ProjectCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
