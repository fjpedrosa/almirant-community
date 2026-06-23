import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { BoardAreaContainer } from "@/domains/boards/presentation/containers/board-area-container";
import { boardsServerApi } from "@/lib/api/server-client";
import { boardKeys } from "@/domains/boards/application/hooks/use-boards";

const DEFAULT_AREA = "desarrollo";

export default async function BoardsPage() {
  const queryClient = new QueryClient();

  try {
    await queryClient.prefetchQuery({
      queryKey: boardKeys.listByArea(DEFAULT_AREA),
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
