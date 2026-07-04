import { Suspense } from "react";
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { ProjectsPageContainer } from "@/domains/projects/presentation/containers/projects-page-container";
import { projectsServerApi } from "@/lib/api/server-client";
import { projectKeys } from "@/domains/projects/application/hooks/use-projects";
import { orgScopedKey } from "@/lib/org-scoped-key";
import { getServerSession } from "@/lib/server-session";
import { ProjectsPageSkeleton } from "@/components/skeletons";

function ProjectsPageContent() {
  return <ProjectsPageContainer />;
}

export default async function ProjectsPage() {
  const queryClient = new QueryClient();
  const session = await getServerSession();
  const orgId = session?.session.activeOrganizationId ?? null;

  try {
    await queryClient.prefetchQuery({
      // Scope with the SAME `org:<id>` suffix the client hook uses, so the
      // dehydrated cache actually hydrates instead of triggering a refetch.
      queryKey: orgScopedKey(projectKeys.list(""), orgId),
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
