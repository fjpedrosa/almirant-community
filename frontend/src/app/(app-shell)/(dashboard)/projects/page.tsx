import { Suspense } from "react";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { ProjectsPageContainer } from "@/domains/projects/presentation/containers/projects-page-container";
import { projectsServerApi } from "@/lib/api/server-client";
import { projectKeys } from "@/domains/projects/application/hooks/use-projects";
import { ProjectsPageSkeleton } from "@/components/skeletons";

function ProjectsPageContent() {
  return <ProjectsPageContainer />;
}

export default async function ProjectsPage() {
  const queryClient = new QueryClient();

  try {
    await queryClient.prefetchQuery({
      queryKey: projectKeys.list(""),
      queryFn: () => projectsServerApi.list(),
    });
  } catch {
    // Prefetch failure is non-fatal. The client-side React Query hook inside
    // ProjectsPageContainer will perform its own fetch as a fallback.
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<ProjectsPageSkeleton />}>
        <ProjectsPageContent />
      </Suspense>
    </HydrationBoundary>
  );
}
