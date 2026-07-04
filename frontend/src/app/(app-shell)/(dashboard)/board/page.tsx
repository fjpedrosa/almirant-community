import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { BoardAreaContainer } from "@/domains/boards/presentation/containers/board-area-container";
import { boardsServerApi, workItemsServerApi } from "@/lib/api/server-client";
import { boardKeys } from "@/domains/boards/application/hooks/use-boards";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";
import { orgScopedKey } from "@/lib/org-scoped-key";
import { getServerSession } from "@/lib/server-session";

const DEFAULT_AREA = "desarrollo";

export default async function BoardsPage() {
  const queryClient = new QueryClient();
  const session = await getServerSession();
  const orgId = session?.session.activeOrganizationId ?? null;

  try {
    // Prefetch boards AND the ~550KB work-items payload in parallel (S6). The
    // work-items query keys by `area` (route param) with no real dependency on
    // boards, so it need not wait behind `boardsLoading`; serving it from
    // hydration removes the client cascade (boards → chunk → work-items ~2.6s).
    await Promise.all([
      queryClient.prefetchQuery({
        // Scope with the SAME `org:<id>` suffix the client hook uses, so the
        // dehydrated cache actually hydrates instead of triggering a refetch.
        queryKey: orgScopedKey(boardKeys.listByArea(DEFAULT_AREA), orgId),
        queryFn: () => boardsServerApi.listByArea(DEFAULT_AREA),
      }),
      queryClient.prefetchQuery({
        // MUST equal `useWorkItemsByArea`'s registered key: the shared
        // `workItemKeys.byAreaBase(area)` (trailing "" filter) + `org:<id>`.
        queryKey: orgScopedKey(workItemKeys.byAreaBase(DEFAULT_AREA), orgId),
        queryFn: () => workItemsServerApi.getByArea(DEFAULT_AREA),
      }),
    ]);
  } catch {
    // Prefetch failure is non-fatal
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BoardAreaContainer area={DEFAULT_AREA} />
    </HydrationBoundary>
  );
}
