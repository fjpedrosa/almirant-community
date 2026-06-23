"use client";

import { useEffect, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentJobsApi } from "@/lib/api/client";
import { useWebSocket } from "@/domains/shared/application/hooks/use-websocket";
import type { AgentJob, AgentDashboardStats } from "../../domain/types";
import { agentJobKeys } from "./use-agent-jobs";

const DASHBOARD_KEY = [...agentJobKeys.all, "dashboard"] as const;
const POLLING_INTERVAL_MS = 30_000;
const RECENT_JOBS_LIMIT = 20;

const isWithinLast24h = (dateStr: string | Date | null): boolean => {
  if (!dateStr) return false;
  const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
  return date.getTime() >= twentyFourHoursAgo;
};

const computeStats = (jobs: AgentJob[]): AgentDashboardStats => {
  let running = 0;
  let queued = 0;
  let completedLast24h = 0;
  let incompleteLast24h = 0;
  let failedLast24h = 0;

  for (const job of jobs) {
    if (job.status === "running" || job.status === "finalizing") running++;
    if (job.status === "queued") queued++;
    if (job.status === "completed" && isWithinLast24h(job.completedAt)) completedLast24h++;
    if (job.status === "incomplete" && isWithinLast24h(job.completedAt)) incompleteLast24h++;
    if (job.status === "failed" && isWithinLast24h(job.completedAt)) failedLast24h++;
  }

  return { running, queued, completedLast24h, incompleteLast24h, failedLast24h };
};

const filterActiveJobs = (jobs: AgentJob[]): AgentJob[] =>
  jobs.filter((j) => j.status === "running" || j.status === "finalizing" || j.status === "queued" || j.status === "waiting_for_input" || j.status === "paused");

const filterRecentJobs = (jobs: AgentJob[]): AgentJob[] =>
  jobs
    .filter((j) => j.status === "completed" || j.status === "incomplete" || j.status === "failed")
    .sort((a, b) => {
      const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return dateB - dateA;
    })
    .slice(0, RECENT_JOBS_LIMIT);

export const useAgentDashboard = () => {
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();

  // Fetch all agent jobs with generous limit
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "200", page: "1" });
      try {
        const result = await agentJobsApi.listWithMeta(params);
        return result.data;
      } catch {
        // Fallback to list without meta
        return agentJobsApi.list(params);
      }
    },
    refetchInterval: POLLING_INTERVAL_MS,
  });

  // Subscribe to WebSocket events for real-time invalidation
  const handleStatusChanged = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
  }, [queryClient]);

  useEffect(() => {
    const unsubscribe = subscribe("agent-job:status-changed", handleStatusChanged);
    return unsubscribe;
  }, [subscribe, handleStatusChanged]);

  const stats = useMemo(() => computeStats(jobs), [jobs]);
  const activeJobs = useMemo(() => filterActiveJobs(jobs), [jobs]);
  const recentJobs = useMemo(() => filterRecentJobs(jobs), [jobs]);

  return {
    stats,
    activeJobs,
    recentJobs,
    isLoading,
  };
};
