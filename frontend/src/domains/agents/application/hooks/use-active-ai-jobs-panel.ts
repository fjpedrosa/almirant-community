"use client";

import { useMemo } from "react";
import { useLiveTimer } from "./use-live-timer";
import { useCancelAgentJob } from "./use-enqueue-agent-job";
import type { AgentJob, ActiveAiJobItem } from "../../domain/types";

const ACTIVE_STATUSES = new Set(["queued", "running", "finalizing", "waiting_for_input", "paused"]);

export const useActiveAiJobsPanel = (
  jobs: AgentJob[],
  workItemTitles: Map<string, string>,
  unknownLabel: string
) => {
  const cancelMutation = useCancelAgentJob();

  const activeJobs: ActiveAiJobItem[] = useMemo(() => {
    return jobs
      .filter((j) => ACTIVE_STATUSES.has(j.status))
      .sort((a, b) => {
        // Running first, then finalizing, then waiting_for_input, paused, then queued
        const order: Record<string, number> = {
          running: 0,
          finalizing: 1,
          waiting_for_input: 2,
          paused: 3,
          queued: 4,
        };
        return (order[a.status] ?? 4) - (order[b.status] ?? 4);
      })
      .map((j) => ({
        jobId: j.id,
        workItemTitle: j.workItemId
          ? workItemTitles.get(j.workItemId) ?? unknownLabel
          : unknownLabel,
        provider: j.provider,
        status: j.status,
        startedAt: j.startedAt,
      }));
  }, [jobs, workItemTitles, unknownLabel]);

  const hasActiveJobs = activeJobs.length > 0;
  const currentTime = useLiveTimer(hasActiveJobs);

  const handleCancelJob = (jobId: string) => {
    cancelMutation.mutate(jobId);
  };

  return {
    activeJobs,
    currentTime,
    isCancelling: cancelMutation.isPending,
    handleCancelJob,
  };
};
