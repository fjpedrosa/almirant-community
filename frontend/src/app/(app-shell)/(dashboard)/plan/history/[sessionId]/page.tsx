import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { SessionReplayContainer } from "@/domains/planning/presentation/containers/session-replay-container";
import { planningSessionKeys } from "@/domains/planning/domain/query-keys";
import { planningServerApi } from "@/lib/api/server-client";

interface SessionReplayPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function SessionReplayPage({
  params,
}: SessionReplayPageProps) {
  const { sessionId } = await params;
  const queryClient = new QueryClient();

  // Prefetch the replay payload server-side (S6). These planning queries are
  // NOT org-scoped, so the SSR key is the SAME plain key the client hook
  // `useSessionReplay` registers — hydration matches, no client refetch.
  // `prefetchQuery` swallows queryFn errors, so a failed leg is non-fatal: the
  // client-side hook fetches it as a fallback.

  // Session detail — the above-the-fold header. Key from the shared
  // `planningSessionKeys.detail` builder the client hook also uses.
  await queryClient.prefetchQuery({
    queryKey: planningSessionKeys.detail(sessionId),
    queryFn: () => planningServerApi.getSession(sessionId),
  });

  // Latest job output (the replay body) in ONE call. The backend resolves the
  // newest job of the session and returns its output, collapsing the old
  // list-jobs -> fetch-output chain. Key mirrors the client hook's
  // `planningSessionKeys.latestOutput` so the dehydrated cache hydrates.
  await queryClient.prefetchQuery({
    queryKey: planningSessionKeys.latestOutput(sessionId),
    queryFn: () => planningServerApi.getLatestOutput(sessionId),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SessionReplayContainer sessionId={sessionId} />
    </HydrationBoundary>
  );
}
