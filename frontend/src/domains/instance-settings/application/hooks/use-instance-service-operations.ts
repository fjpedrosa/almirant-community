"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { instanceServiceOperationsApi } from "../api/instance-service-operations-api";
import type {
  ControllableInstanceService,
  OperationsSectionProps,
  StartServiceOperationResponse,
} from "../../domain/types";

export const instanceServiceOperationsKeys = {
  all: ["instance-service-operations"] as const,
  status: () => [...instanceServiceOperationsKeys.all, "status"] as const,
  job: (jobId: string) =>
    [...instanceServiceOperationsKeys.all, "job", jobId] as const,
};

export const useInstanceServiceOperations = (): OperationsSectionProps => {
  const queryClient = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: instanceServiceOperationsKeys.status(),
    queryFn: () => instanceServiceOperationsApi.getStatus(),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.activeOperation?.status === "running" ||
        data?.activeOperation?.status === "queued"
        ? 5_000
        : 30_000;
    },
  });

  const operationJobQuery = useQuery({
    queryKey: activeJobId
      ? instanceServiceOperationsKeys.job(activeJobId)
      : instanceServiceOperationsKeys.job("idle"),
    queryFn: () => {
      if (!activeJobId) throw new Error("No active operation job");
      return instanceServiceOperationsApi.getOperationJob(activeJobId);
    },
    enabled: Boolean(activeJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "queued" ? 2_000 : false;
    },
  });

  useEffect(() => {
    const status = operationJobQuery.data?.status;
    if (status === "success" || status === "failed") {
      setActiveJobId(null);
      void queryClient.invalidateQueries({
        queryKey: instanceServiceOperationsKeys.all,
      });
    }
  }, [operationJobQuery.data?.status, queryClient]);

  const onOperationStarted = (result: StartServiceOperationResponse) => {
    setActiveJobId(result.jobId);
    void queryClient.invalidateQueries({
      queryKey: instanceServiceOperationsKeys.all,
    });
  };

  const restartMutation = useMutation({
    mutationFn: ({
      service,
      force,
    }: {
      service: ControllableInstanceService;
      force?: boolean;
    }) => instanceServiceOperationsApi.restartService(service, { force }),
    onSuccess: onOperationStarted,
  });

  const cleanupMutation = useMutation({
    mutationFn: () => instanceServiceOperationsApi.cleanupExitedContainers(),
    onSuccess: onOperationStarted,
  });

  const handleRestartService = (
    service: ControllableInstanceService,
    options?: { force?: boolean },
  ) => {
    restartMutation.mutate({ service, force: options?.force });
  };

  const handleCleanupExitedContainers = () => {
    cleanupMutation.mutate();
  };

  return {
    status: statusQuery.data ?? null,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    isStartingOperation:
      restartMutation.isPending ||
      cleanupMutation.isPending ||
      operationJobQuery.data?.status === "running" ||
      operationJobQuery.data?.status === "queued",
    onRefresh: () => {
      void statusQuery.refetch();
    },
    onRestartService: handleRestartService,
    onCleanupExitedContainers: handleCleanupExitedContainers,
  };
};
