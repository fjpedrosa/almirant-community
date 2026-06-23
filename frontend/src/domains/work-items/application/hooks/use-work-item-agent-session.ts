"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { useWsContextOptional } from "@/domains/shared/application/hooks/use-ws-context";
import { useSessionOutput } from "@/domains/sessions/application/hooks/use-session-detail";
import type { AgentSessionListItem } from "@/domains/sessions/domain/types";
import type { WsServerMessage, WsServerPlanningText } from "@/domains/shared/domain/ws-types";

const ACTIVE_STATUSES = new Set(["queued", "running", "finalizing", "waiting_for_input", "paused"]);
const ACTIVE_REFETCH_MS = 5_000;
const IDLE_REFETCH_MS = 20_000;

const workItemAgentSessionKeys = {
  all: ["work-item-agent-sessions"] as const,
  list: (workItemId: string) =>
    [...workItemAgentSessionKeys.all, workItemId] as const,
};

const sortSessions = (
  sessions: AgentSessionListItem[] | undefined
): AgentSessionListItem[] => {
  return [...(sessions ?? [])].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
};

export const useWorkItemAgentSession = (
  workItemId: string | null | undefined
) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const wsContext = useWsContextOptional();
  const scopedKey = useOrgScopedKey(workItemAgentSessionKeys.list(workItemId ?? "none"));

  const sessionsQuery = useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      workItemsApi.getSessions(workItemId!) as Promise<AgentSessionListItem[]>,
    enabled: !!workItemId && !!confirmedActiveTeamId,
    refetchInterval: (query) => {
      const sessions = sortSessions(query.state.data as AgentSessionListItem[] | undefined);
      const hasActiveSession = sessions.some((session) =>
        ACTIVE_STATUSES.has(session.status)
      );
      return hasActiveSession ? ACTIVE_REFETCH_MS : IDLE_REFETCH_MS;
    },
  });

  const sessions = useMemo(
    () => sortSessions(sessionsQuery.data),
    [sessionsQuery.data]
  );
  const activeSession = useMemo(
    () =>
      sessions.find((session) => ACTIVE_STATUSES.has(session.status)) ?? null,
    [sessions]
  );
  const selectedSession = activeSession ?? sessions[0] ?? null;

  const output = useSessionOutput(
    selectedSession?.id,
    selectedSession?.status,
    { enabled: !!selectedSession }
  );
  const refetchSessions = sessionsQuery.refetch;
  const refetchOutput = output.refetch;

  useEffect(() => {
    if (!wsContext || !workItemId) return;

    const unsubscribe = wsContext.subscribe(
      "agent-job:status-changed",
      (message: WsServerMessage) => {
        if (message.type !== "agent-job:status-changed") return;
        if (message.payload.workItemId !== workItemId) return;
        void refetchSessions();
      }
    );

    return unsubscribe;
  }, [refetchSessions, workItemId, wsContext]);

  useEffect(() => {
    if (!wsContext || !selectedSession?.sessionId) return;

    const unsubscribe = wsContext.subscribe(
      "planning:text",
      (message: WsServerMessage) => {
        const planningMessage = message as WsServerPlanningText;
        if (planningMessage.type !== "planning:text") return;
        if (planningMessage.payload.sessionId !== selectedSession.sessionId) {
          return;
        }
        void refetchOutput();
      }
    );

    return unsubscribe;
  }, [refetchOutput, selectedSession?.sessionId, wsContext]);

  return {
    sessions,
    activeSession,
    selectedSession,
    output,
    isLoading: sessionsQuery.isLoading,
    isFetching: sessionsQuery.isFetching,
    error: sessionsQuery.error,
    refetch: sessionsQuery.refetch,
  };
};
