"use client";

import { useQuery } from "@tanstack/react-query";
import { agentJobsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { jobCollectionPollInterval } from "../../domain/polling";
import type { AgentJob } from "../../domain/types";

export const agentJobKeys = {
  all: ["agent-jobs"] as const,
  byBoard: (boardId: string) => [...agentJobKeys.all, "board", boardId] as const,
  byWorkItem: (workItemId: string) => [...agentJobKeys.all, "work-item", workItemId] as const,
  runs: (queryKey: string) => [...agentJobKeys.all, "runs", queryKey] as const,
  logs: (jobId: string, queryKey: string) => [...agentJobKeys.all, "logs", jobId, queryKey] as const,
  interactions: (jobId: string) => [...agentJobKeys.all, "interactions", jobId] as const,
  workItemInteractions: (workItemId: string) => [...agentJobKeys.all, "work-item-interactions", workItemId] as const,
  pendingCount: () => [...agentJobKeys.all, "pending-questions"] as const,
};

const hasActiveJobs = (jobs: AgentJob[] | undefined): boolean => {
  if (!jobs || jobs.length === 0) return false;
  return jobs.some((j) => j.status === "queued" || j.status === "running" || j.status === "finalizing" || j.status === "waiting_for_input" || j.status === "paused");
};

export const useActiveAgentJobs = (boardId: string) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(agentJobKeys.byBoard(boardId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => agentJobsApi.getByBoard(boardId),
    enabled: !!boardId && !!confirmedActiveTeamId,
    refetchInterval: (query) => {
      const jobs = query.state.data as AgentJob[] | undefined;
      return hasActiveJobs(jobs) ? 5000 : 30000;
    },
  });
};

export const useAgentJobStatus = (workItemId: string) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(agentJobKeys.byWorkItem(workItemId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<AgentJob[]> => {
      const result = await agentJobsApi.getByWorkItem(workItemId);

      // Back-compat: allow both request<T>() and requestWithMeta<T>() patterns.
      if (Array.isArray(result)) return result as AgentJob[];
      if (result && typeof result === "object" && "data" in result) {
        return (result as { data: unknown }).data as AgentJob[];
      }
      return [];
    },
    select: (jobs) => jobs.find((j) => j.status === "queued" || j.status === "running" || j.status === "finalizing" || j.status === "waiting_for_input" || j.status === "paused") ?? null,
    enabled: !!workItemId && !!confirmedActiveTeamId,
    // Poll only while this work item has an active job; once it is terminal the
    // status is fixed. `agent-job:status-changed` WS events invalidate this key,
    // so a new job for the work item still refreshes the badge.
    refetchInterval: (query) => {
      const jobs = (query.state.data as AgentJob[] | undefined) ?? [];
      return jobCollectionPollInterval(
        jobs.map((job) => job.status),
        5000,
        false,
      );
    },
  });
};
