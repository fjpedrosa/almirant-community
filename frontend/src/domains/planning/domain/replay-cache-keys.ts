import { orgScopedKey } from "@/lib/org-scoped-key";
import { planningSessionKeys } from "./query-keys";

/**
 * Org-scoped React Query keys for the planning transcript/replay loaders.
 *
 * `loadMessagesFromLogs`, `loadReplayTraceForJob` and `loadGeneratedItemsFromSession`
 * historically fetched DIRECTLY (bypassing React Query), so navigating A -> B -> A
 * or a spurious remount re-downloaded everything (up to ~20k chunks). Routing them
 * through `queryClient.fetchQuery` with these STABLE, workspace-partitioned keys lets
 * the cache dedupe and reuse instead.
 *
 * Guarantees: same inputs -> deeply equal array (stable), and partitioned by org so
 * there is no cross-workspace cache bleed.
 */
export const planningReplayCacheKeys = {
  messagesFromLogs: (sessionId: string, orgId: string | null | undefined) =>
    orgScopedKey(planningSessionKeys.replayLogs(sessionId), orgId),
  generatedItems: (sessionId: string, orgId: string | null | undefined) =>
    orgScopedKey(planningSessionKeys.workItems(sessionId), orgId),
  replayTrace: (jobId: string, orgId: string | null | undefined) =>
    orgScopedKey(planningSessionKeys.replayTrace(jobId), orgId),
} as const;
