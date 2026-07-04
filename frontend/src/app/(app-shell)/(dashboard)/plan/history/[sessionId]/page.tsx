import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { SessionReplayContainer } from "@/domains/planning/presentation/containers/session-replay-container";
import { planningSessionKeys } from "@/domains/planning/domain/query-keys";
import { planningServerApi, agentJobsServerApi } from "@/lib/api/server-client";

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

  // Latest job + its transcript (the replay body). Two-step: the job id is
  // derived from the jobs response, exactly as `useSessionReplay` does. Keys
  // mirror that hook's inline literals so the dehydrated cache hydrates.
  try {
    const jobs = await agentJobsServerApi.listBySession(sessionId);
    queryClient.setQueryData(["agent-jobs", "by-session", sessionId], jobs);

    const latestJobId = jobs?.[0]?.id ?? null;
    if (latestJobId) {
      await queryClient.prefetchQuery({
        queryKey: ["agent-jobs", latestJobId, "output", "replay"],
        queryFn: () => agentJobsServerApi.getOutput(latestJobId),
      });
    }
  } catch {
    // Non-fatal — the client hook refetches jobs/output on mount.
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SessionReplayContainer sessionId={sessionId} />
    </HydrationBoundary>
  );
}
