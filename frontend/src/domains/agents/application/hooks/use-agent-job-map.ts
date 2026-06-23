"use client";

import { useMemo } from "react";
import { useActiveAgentJobs } from "./use-agent-jobs";
import type { AgentJob, AgentJobStatus, BoardAgentSummary } from "../../domain/types";

const STATUS_PRIORITY: Record<AgentJobStatus, number> = {
  running: 6,
  finalizing: 5,
  waiting_for_input: 4,
  paused: 3,
  queued: 3,
  completed: 2,
  incomplete: 1,
  failed: 1,
  cancelled: 0,
};

const pickPreferredJob = (a: AgentJob, b: AgentJob): AgentJob => {
  const pa = STATUS_PRIORITY[a.status] ?? 0;
  const pb = STATUS_PRIORITY[b.status] ?? 0;
  if (pa !== pb) return pa > pb ? a : b;

  // If same status, prefer the most recently updated-ish (fallback to createdAt).
  const ta = (a.startedAt ?? a.createdAt)?.valueOf?.() ?? 0;
  const tb = (b.startedAt ?? b.createdAt)?.valueOf?.() ?? 0;
  return ta >= tb ? a : b;
};

const emptySummary = (): BoardAgentSummary => ({
  running: 0,
  queued: 0,
  completed: 0,
  incomplete: 0,
  failed: 0,
});

export const useAgentJobMap = (boardId: string) => {
  const { data: jobs, isLoading, isFetching } = useActiveAgentJobs(boardId);

  const jobMap = useMemo(() => {
    const map = new Map<string, AgentJob>();
    for (const job of (jobs ?? []) as AgentJob[]) {
      if (!job.workItemId) continue;
      const existing = map.get(job.workItemId);
      map.set(job.workItemId, existing ? pickPreferredJob(existing, job) : job);
    }
    return map;
  }, [jobs]);

  const summary = useMemo(() => {
    const next = emptySummary();
    for (const job of jobMap.values()) {
      if (job.status === "running" || job.status === "finalizing") next.running += 1;
      if (job.status === "queued") next.queued += 1;
      if (job.status === "completed") next.completed += 1;
      if (job.status === "incomplete") next.incomplete += 1;
      if (job.status === "failed") next.failed += 1;
    }
    return next;
  }, [jobMap]);

  const allJobs = useMemo(() => ((jobs ?? []) as AgentJob[]), [jobs]);

  return { jobMap, summary, allJobs, isLoading, isFetching };
};
