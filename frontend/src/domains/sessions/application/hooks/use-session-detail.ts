"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentProvider } from "@/domains/agents/domain/types";
import type { AgentJobStatus } from "@/domains/agents/domain/types";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { request } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { AgentLogChunk } from "@/domains/shared/domain/types";
import { sessionKeys } from "../../domain/query-keys";
import type {
  AgentSessionDetail,
  AgentSessionOutput,
  SessionEventRecord,
} from "../../domain/types";
import { activeJobPollInterval } from "@/domains/agents/domain/polling";
import { isAgentSessionActive, mergeChunks, sortChunks } from "../../domain/utils";
import { buildSessionDisplayChunks } from "../utils/session-events-to-display-chunks";

export { isAgentSessionActive };

// Status only needs coarse freshness (WS also pushes status changes); the live
// content streams below stay at 4s so the transcript keeps flowing.
const SESSION_DETAIL_STATUS_POLL_MS = 8_000;
const SESSION_LIVE_POLL_MS = 4_000;

export const useSessionDetail = (sessionId: string | null | undefined) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(sessionKeys.detail(sessionId ?? ""));

  return useQuery({
    queryKey: scopedKey,
    queryFn: () => request<AgentSessionDetail>(`/agent-jobs/${sessionId!}`),
    enabled: !!sessionId && !!confirmedActiveTeamId,
    staleTime: 15_000,
    refetchInterval: (query) => {
      const detail = query.state.data as AgentSessionDetail | undefined;
      return activeJobPollInterval(
        isAgentSessionActive(detail?.job.status),
        SESSION_DETAIL_STATUS_POLL_MS,
      );
    },
  });
};

export const useSessionOutput = (
  sessionId: string | null | undefined,
  status: AgentJobStatus | null | undefined,
  options?: { enabled?: boolean; provider?: AgentProvider | null },
) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const [rawChunks, setRawChunks] = useState<AgentLogChunk[]>([]);
  const [sessionEvents, setSessionEvents] = useState<SessionEventRecord[]>([]);
  const initialScopedKey = useOrgScopedKey([
    ...sessionKeys.output(sessionId ?? ""),
    "initial",
  ]);

  const initialQuery = useQuery({
    queryKey: initialScopedKey,
    queryFn: () =>
      request<AgentSessionOutput>(`/agent-jobs/${sessionId!}/output?limit=500`),
    enabled: !!sessionId && !!confirmedActiveTeamId && (options?.enabled ?? true),
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!sessionId) {
      setRawChunks([]);
      setSessionEvents([]);
      return;
    }

    if (initialQuery.data) {
      setRawChunks(sortChunks(initialQuery.data.chunks));
    }
  }, [initialQuery.data, sessionId]);

  const resolvedStatus = initialQuery.data?.status ?? status ?? null;
  const isLive = isAgentSessionActive(resolvedStatus);
  const lastRawSeq = rawChunks.at(-1)?.seq;
  const liveCursor = typeof lastRawSeq === "number" ? `&cursor=${lastRawSeq}` : "";

  // Key intentionally omits `lastRawSeq`: including it minted a brand-new query
  // (and cache entry) on every batch, fragmenting the cache and forcing an
  // immediate extra fetch per advance. The cursor still travels via `liveCursor`
  // read at fetch time, so incremental streaming is preserved with a stable key.
  const liveScopedKey = useOrgScopedKey([
    ...sessionKeys.output(sessionId ?? ""),
    "live",
  ]);

  const liveQuery = useQuery({
    queryKey: liveScopedKey,
    queryFn: () =>
      request<AgentSessionOutput>(
        `/agent-jobs/${sessionId!}/output?limit=250${liveCursor}`,
      ),
    enabled:
      !!sessionId &&
      !!confirmedActiveTeamId &&
      (options?.enabled ?? true) &&
      isLive,
    refetchInterval: SESSION_LIVE_POLL_MS,
  });

  useEffect(() => {
    if (!liveQuery.data) return;
    setRawChunks((currentChunks) => mergeChunks(currentChunks, liveQuery.data!.chunks));
  }, [liveQuery.data]);

  const shouldLoadSessionEvents = true;
  const initialSessionEventsScopedKey = useOrgScopedKey([
    ...sessionKeys.sessionEvents(sessionId ?? ""),
    "initial",
  ]);

  const initialSessionEventsQuery = useQuery({
    queryKey: initialSessionEventsScopedKey,
    queryFn: () =>
      request<SessionEventRecord[]>(
        `/agent-jobs/${sessionId!}/session-events?limit=5000`,
      ),
    enabled:
      !!sessionId &&
      !!confirmedActiveTeamId &&
      (options?.enabled ?? true) &&
      shouldLoadSessionEvents,
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!sessionId || !shouldLoadSessionEvents) {
      setSessionEvents([]);
      return;
    }

    if (initialSessionEventsQuery.data) {
      setSessionEvents(
        [...initialSessionEventsQuery.data].sort(
          (left, right) => left.sequenceNum - right.sequenceNum,
        ),
      );
    }
  }, [initialSessionEventsQuery.data, sessionId, shouldLoadSessionEvents]);

  const lastSessionEventSeq = sessionEvents.at(-1)?.sequenceNum;
  const liveSessionEventsCursor =
    typeof lastSessionEventSeq === "number" ? `&after=${lastSessionEventSeq}` : "";

  // Stable key (see `liveScopedKey` above): the `after=` cursor rides on
  // `liveSessionEventsCursor`, so removing `lastSessionEventSeq` from the key
  // stops the per-batch cache churn without breaking live event streaming.
  const liveSessionEventsScopedKey = useOrgScopedKey([
    ...sessionKeys.sessionEvents(sessionId ?? ""),
    "live",
  ]);

  const liveSessionEventsQuery = useQuery({
    queryKey: liveSessionEventsScopedKey,
    queryFn: () =>
      request<SessionEventRecord[]>(
        `/agent-jobs/${sessionId!}/session-events?limit=5000${liveSessionEventsCursor}`,
      ),
    enabled:
      !!sessionId &&
      !!confirmedActiveTeamId &&
      (options?.enabled ?? true) &&
      shouldLoadSessionEvents &&
      isLive,
    refetchInterval: SESSION_LIVE_POLL_MS,
  });

  useEffect(() => {
    if (!liveSessionEventsQuery.data) return;
    setSessionEvents((currentEvents) => {
      const byId = new Map<string, SessionEventRecord>();
      for (const event of currentEvents) {
        byId.set(event.id, event);
      }
      for (const event of liveSessionEventsQuery.data!) {
        byId.set(event.id, event);
      }
      return [...byId.values()].sort(
        (left, right) => left.sequenceNum - right.sequenceNum,
      );
    });
  }, [liveSessionEventsQuery.data]);

  const displayChunks = useMemo(
    () =>
      buildSessionDisplayChunks(
        rawChunks,
        sessionEvents,
        options?.provider ?? null,
      ),
    [options?.provider, rawChunks, sessionEvents],
  );

  const output = useMemo(
    () => ({
      jobId: sessionId ?? "",
      sessionId: initialQuery.data?.sessionId ?? liveQuery.data?.sessionId ?? null,
      status: liveQuery.data?.status ?? resolvedStatus ?? "queued",
      chunks: displayChunks,
      text: displayChunks.map((chunk) => chunk.message).join("\n"),
      nextCursor: liveQuery.data?.nextCursor ?? initialQuery.data?.nextCursor ?? null,
      hasMore: liveQuery.data?.hasMore ?? initialQuery.data?.hasMore ?? false,
      lastSeq: rawChunks.at(-1)?.seq ?? null,
    }),
    [
      displayChunks,
      initialQuery.data?.hasMore,
      initialQuery.data?.nextCursor,
      initialQuery.data?.sessionId,
      liveQuery.data?.hasMore,
      liveQuery.data?.nextCursor,
      liveQuery.data?.sessionId,
      liveQuery.data?.status,
      rawChunks,
      resolvedStatus,
      sessionId,
    ],
  );

  return {
    output,
    chunks: displayChunks,
    rawChunks,
    isLive,
    isLoading:
      initialQuery.isLoading ||
      (shouldLoadSessionEvents && initialSessionEventsQuery.isLoading),
    isFetching:
      initialQuery.isFetching ||
      liveQuery.isFetching ||
      initialSessionEventsQuery.isFetching ||
      liveSessionEventsQuery.isFetching,
    error:
      initialQuery.error ??
      liveQuery.error ??
      (shouldLoadSessionEvents
        ? initialSessionEventsQuery.error ?? liveSessionEventsQuery.error ?? null
        : null),
    refetch: async () => {
      await initialQuery.refetch();
      if (isLive) {
        await liveQuery.refetch();
      }
      if (shouldLoadSessionEvents) {
        await initialSessionEventsQuery.refetch();
        if (isLive) {
          await liveSessionEventsQuery.refetch();
        }
      }
    },
  };
};
