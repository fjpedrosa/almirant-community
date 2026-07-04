"use client";

import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { agentJobsApi, requestWithMeta } from "@/lib/api/client";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import {
  activeJobPollInterval,
  jobCollectionPollInterval,
} from "../../domain/polling";
import { agentJobKeys } from "./use-agent-jobs";
import type {
  AgentJob,
  AgentJobLogsFilters,
  AgentJobLog,
  AgentJobLogsMeta,
  AgentJobStatus,
  AgentJobType,
} from "../../domain/types";

type AgentRunsParams = {
  page?: number;
  limit?: number;
  status?: AgentJobStatus;
  jobType?: AgentJobType;
  workItemId?: string;
};

type UseAgentRunsOptions = {
  enabled?: boolean;
};

type UseAgentJobLogsOptions = {
  enabled?: boolean;
  activeRefetchIntervalMs?: number;
  isActiveJob?: boolean;
};

const DEFAULT_RUNS_LIMIT = 30;
const DEFAULT_LOGS_LIMIT = 100;

const ACTIVE_RUNS_REFETCH_MS = 8_000;
const ACTIVE_LOGS_REFETCH_MS = 5_000;

const serializeQuery = (record: Record<string, unknown>): string => {
  const sorted = Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(sorted);
};

const buildRunsParams = (params?: AgentRunsParams): URLSearchParams => {
  const query = new URLSearchParams();
  query.set("page", String(params?.page ?? 1));
  query.set("limit", String(params?.limit ?? DEFAULT_RUNS_LIMIT));
  if (params?.status) query.set("status", params.status);
  if (params?.jobType) query.set("jobType", params.jobType);
  if (params?.workItemId) query.set("workItemId", params.workItemId);
  return query;
};

const buildLogsParams = (filters?: AgentJobLogsFilters): URLSearchParams => {
  const query = new URLSearchParams();
  query.set("limit", String(filters?.limit ?? DEFAULT_LOGS_LIMIT));
  if (typeof filters?.cursor === "number") query.set("cursor", String(filters.cursor));
  if (filters?.level) query.set("level", filters.level);
  if (filters?.phase) query.set("phase", filters.phase);
  if (filters?.eventType) query.set("eventType", filters.eventType);
  if (filters?.from) query.set("from", filters.from);
  if (filters?.to) query.set("to", filters.to);
  return query;
};

const parseLogsMeta = (meta: unknown, fallbackLimit: number): AgentJobLogsMeta => {
  if (!meta || typeof meta !== "object") {
    return {
      nextCursor: null,
      hasMore: false,
      limit: fallbackLimit,
    };
  }

  const candidate = meta as Partial<AgentJobLogsMeta>;
  return {
    nextCursor:
      typeof candidate.nextCursor === "number" ? candidate.nextCursor : null,
    hasMore: candidate.hasMore === true,
    limit:
      typeof candidate.limit === "number" ? candidate.limit : fallbackLimit,
  };
};

export const useAgentRuns = (
  params?: AgentRunsParams,
  options?: UseAgentRunsOptions
) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const paramsKey = useMemo(
    () =>
      serializeQuery({
        page: params?.page ?? 1,
        limit: params?.limit ?? DEFAULT_RUNS_LIMIT,
        status: params?.status,
        jobType: params?.jobType,
        workItemId: params?.workItemId,
      }),
    [params?.jobType, params?.limit, params?.page, params?.status, params?.workItemId]
  );

  const query = useQuery({
    queryKey: [
      ...agentJobKeys.runs(paramsKey),
      `org:${confirmedActiveTeamId ?? "none"}`,
    ],
    queryFn: async () => {
      const requestParams = buildRunsParams(params);
      const result = await requestWithMeta<AgentJob[]>(
        `/agent-jobs?${requestParams.toString()}`
      );
      return {
        data: result.data,
        total: result.meta.total,
      };
    },
    enabled:
      (options?.enabled ?? true) &&
      !!confirmedActiveTeamId,
    // Poll fast while any run is active; stop entirely once all runs are
    // terminal. The WebSocket provider invalidates `agentJobKeys.all` on
    // `agent-job:status-changed`, so new/updated runs still refresh the list.
    refetchInterval: (queryState) => {
      const jobs = queryState.state.data?.data ?? [];
      return jobCollectionPollInterval(
        jobs.map((job) => job.status),
        ACTIVE_RUNS_REFETCH_MS,
        false,
      );
    },
  });

  return {
    runs: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export const useAgentRunsByWorkItem = (
  workItemId: string | null | undefined,
  options?: UseAgentRunsOptions
) => {
  return useAgentRuns(
    {
      page: 1,
      limit: DEFAULT_RUNS_LIMIT,
      workItemId: workItemId ?? undefined,
    },
    { enabled: !!workItemId && (options?.enabled ?? true) }
  );
};

export const useAgentJobLogs = (
  jobId: string | null | undefined,
  filters?: AgentJobLogsFilters,
  options?: UseAgentJobLogsOptions
) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const limit = filters?.limit ?? DEFAULT_LOGS_LIMIT;
  const queryKey = useMemo(
    () =>
      serializeQuery({
        limit,
        cursor: filters?.cursor,
        level: filters?.level,
        phase: filters?.phase,
        eventType: filters?.eventType,
        from: filters?.from,
        to: filters?.to,
      }),
    [
      filters?.cursor,
      filters?.eventType,
      filters?.from,
      filters?.level,
      filters?.phase,
      filters?.to,
      limit,
    ]
  );

  const query = useQuery({
    queryKey: [
      ...agentJobKeys.logs(jobId ?? "none", queryKey),
      `org:${confirmedActiveTeamId ?? "none"}`,
    ],
    queryFn: async () => {
      if (!jobId) {
        return {
          logs: [],
          meta: parseLogsMeta(null, limit),
        };
      }

      const params = buildLogsParams(filters);
      const result = await requestWithMeta<AgentJobLog[]>(
        `/agent-jobs/${jobId}/logs?${params.toString()}`
      );

      return {
        logs: [...result.data].sort((a, b) => a.seq - b.seq),
        meta: parseLogsMeta(result.meta, limit),
      };
    },
    enabled:
      !!jobId &&
      !!confirmedActiveTeamId &&
      (options?.enabled ?? true),
    // A terminal job's logs are frozen: stop polling and mark them permanently
    // fresh so remounts don't refetch. Active jobs keep streaming at 5s.
    refetchInterval: activeJobPollInterval(
      options?.isActiveJob === true,
      options?.activeRefetchIntervalMs ?? ACTIVE_LOGS_REFETCH_MS,
    ),
    staleTime: options?.isActiveJob === true ? 0 : Infinity,
  });

  return {
    logs: query.data?.logs ?? [],
    meta: query.data?.meta ?? parseLogsMeta(null, limit),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export const useInfiniteAgentJobLogs = (
  jobId: string | null | undefined,
  filters?: Omit<AgentJobLogsFilters, "cursor">,
  options?: UseAgentJobLogsOptions
) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const limit = filters?.limit ?? DEFAULT_LOGS_LIMIT;
  const queryKey = useMemo(
    () =>
      serializeQuery({
        limit,
        level: filters?.level,
        phase: filters?.phase,
        eventType: filters?.eventType,
        from: filters?.from,
        to: filters?.to,
      }),
    [
      filters?.eventType,
      filters?.from,
      filters?.level,
      filters?.phase,
      filters?.to,
      limit,
    ]
  );

  const query = useInfiniteQuery({
    queryKey: [
      ...agentJobKeys.logs(jobId ?? "none", queryKey),
      "infinite",
      `org:${confirmedActiveTeamId ?? "none"}`,
    ],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam }) => {
      if (!jobId) {
        return {
          logs: [] as AgentJobLog[],
          meta: parseLogsMeta(null, limit),
        };
      }

      const params = buildLogsParams({
        ...filters,
        cursor: pageParam,
        limit,
      });
      const result = await requestWithMeta<AgentJobLog[]>(
        `/agent-jobs/${jobId}/logs?${params.toString()}`
      );

      return {
        logs: [...result.data].sort((a, b) => a.seq - b.seq),
        meta: parseLogsMeta(result.meta, limit),
      };
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.meta.hasMore) return undefined;
      return lastPage.meta.nextCursor ?? undefined;
    },
    enabled:
      !!jobId &&
      !!confirmedActiveTeamId &&
      (options?.enabled ?? true),
    // A terminal job's logs are frozen: stop polling and mark them permanently
    // fresh so remounts don't refetch. Active jobs keep streaming at 5s.
    refetchInterval: activeJobPollInterval(
      options?.isActiveJob === true,
      options?.activeRefetchIntervalMs ?? ACTIVE_LOGS_REFETCH_MS,
    ),
    staleTime: options?.isActiveJob === true ? 0 : Infinity,
  });

  const logs = query.data?.pages.flatMap((page) => page.logs) ?? [];
  const currentMeta = query.data?.pages.at(-1)?.meta ?? parseLogsMeta(null, limit);

  return {
    logs,
    meta: currentMeta,
    hasMore: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

type TranscriptChunk = { seq: number; message: string; timestamp: string };

type UseAgentTranscriptOptions = {
  enabled?: boolean;
};

export const useAgentTranscript = (
  jobId: string | null | undefined,
  options?: UseAgentTranscriptOptions
) => {
  const { confirmedActiveTeamId } = useActiveTeam();

  const query = useQuery({
    queryKey: ["agent-jobs", jobId ?? "none", "transcript", `org:${confirmedActiveTeamId ?? "none"}`],
    queryFn: async () => {
      const result = await agentJobsApi.getTranscript(jobId!);
      return result;
    },
    enabled:
      !!jobId &&
      !!confirmedActiveTeamId &&
      (options?.enabled ?? true),
    staleTime: 15_000,
  });

  return {
    transcript: query.data?.transcript ?? "",
    chunks: (query.data?.chunks ?? []) as TranscriptChunk[],
    hasMore: query.data?.hasMore ?? false,
    nextCursor: query.data?.nextCursor ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
