import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { BoardAreaContainer } from "@/domains/boards/presentation/containers/board-area-container";
import { boardsServerApi } from "@/lib/api/server-client";
import { boardKeys } from "@/domains/boards/application/hooks/use-boards";

export default async function BoardAreaPage({
  params,
}: {
  params: Promise<{ area: string }>;
}) {
  const { area } = await params;
  const queryClient = new QueryClient();

  try {
    await queryClient.prefetchQuery({
      queryKey: boardKeys.listByArea(area),
      queryFn: () => boardsServerApi.listByArea(area),
    });
  } catch {
    // Prefetch failure is non-fatal. The client-side React Query hook inside
    // BoardAreaContainer will perform its own fetch as a fallback.
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <BoardAreaContainer area={area} />
    </HydrationBoundary>
  );
}
