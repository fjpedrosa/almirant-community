import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { BoardAreaContainer } from "@/domains/boards/presentation/containers/board-area-container";
import { boardsServerApi } from "@/lib/api/server-client";
import { boardKeys } from "@/domains/boards/application/hooks/use-boards";
import { orgScopedKey } from "@/lib/org-scoped-key";
import { getServerSession } from "@/lib/server-session";

const DEFAULT_AREA = "desarrollo";

export default async function BoardsPage() {
  const queryClient = new QueryClient();
  const session = await getServerSession();
  const orgId = session?.session.activeOrganizationId ?? null;

  try {
    await queryClient.prefetchQuery({
      // Scope with the SAME `org:<id>` suffix the client hook uses, so the
      // dehydrated cache actually hydrates instead of triggering a refetch.
      queryKey: orgScopedKey(boardKeys.listByArea(DEFAULT_AREA), orgId),
      queryFn: () => boardsServerApi.listByArea(DEFAULT_AREA),
    });
  } catch {
    // Prefetch failure is non-fatal
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BoardAreaContainer area={DEFAULT_AREA} />
    </HydrationBoundary>
  );
}
