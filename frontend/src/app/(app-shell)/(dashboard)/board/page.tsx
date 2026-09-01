import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { BoardAreaContainer } from "@/domains/boards/presentation/containers/board-area-container";
import {
  boardsServerApi,
  viewPreferencesServerApi,
  workItemsServerApi,
} from "@/lib/api/server-client";
import { boardKeys } from "@/domains/boards/application/hooks/use-boards";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";
import {
  getBoardFilterParamsFromSearchParams,
  hasExplicitBoardFilterParams,
  mergePersistedBoardFilterParams,
} from "@/domains/work-items/domain/board-filter-params";
import { orgScopedKey } from "@/lib/org-scoped-key";
import { getServerSession } from "@/lib/server-session";

const DEFAULT_AREA = "desarrollo";

export default async function BoardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const queryClient = new QueryClient();
  const session = await getServerSession();
  const orgId = session?.session.activeOrganizationId ?? null;
  const urlParams = await searchParams;
  const currentFilterParams = getBoardFilterParamsFromSearchParams(urlParams, {
    includeSearch: true,
  });
  const hasExplicitFilters = hasExplicitBoardFilterParams(urlParams);

  try {
    const preferencesPromise =
      orgId && !hasExplicitFilters
        ? viewPreferencesServerApi
            .get(`board-area-${DEFAULT_AREA}`)
            .catch(() => null)
        : Promise.resolve(null);

    const boardsPrefetch = queryClient.prefetchQuery({
      // Scope with the SAME `org:<id>` suffix the client hook uses, so the
      // dehydrated cache actually hydrates instead of triggering a refetch.
      queryKey: orgScopedKey(boardKeys.listByArea(DEFAULT_AREA), orgId),
      queryFn: () => boardsServerApi.listByArea(DEFAULT_AREA),
    });

    const preferences = await preferencesPromise;
    const effectiveFilterParams = mergePersistedBoardFilterParams(
      currentFilterParams,
      preferences ?? {},
      hasExplicitFilters,
    );
    const filterParams =
      Object.keys(effectiveFilterParams).length > 0
        ? effectiveFilterParams
        : undefined;

    // Prefetch boards AND the ~550KB work-items payload in parallel (S6). The
    // work-items query keys by `area` (route param) with no real dependency on
    // boards, so it need not wait behind `boardsLoading`; serving it from
    // hydration removes the client cascade (boards → chunk → work-items ~2.6s).
    await Promise.all([
      boardsPrefetch,
      queryClient.prefetchQuery({
        // MUST equal `useWorkItemsByArea`'s registered key: the shared
        // `workItemKeys.byAreaBase(area, filters)` + `org:<id>`.
        queryKey: orgScopedKey(
          workItemKeys.byAreaBase(DEFAULT_AREA, filterParams),
          orgId,
        ),
        queryFn: () => workItemsServerApi.getByArea(DEFAULT_AREA, filterParams),
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
