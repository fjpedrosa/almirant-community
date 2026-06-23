"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { integrationBatchesApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import {
  type IntegrationBatch,
  type IntegrationBatchWithItems,
  type CreateIntegrationBatchRequest,
  isBatchActive,
} from "../../domain/types";

export const integrationBatchKeys = {
  all: ["integration-batches"] as const,
  active: (projectId: string) =>
    [...integrationBatchKeys.all, "active", projectId] as const,
  detail: (id: string) => [...integrationBatchKeys.all, "detail", id] as const,
};

const ACTIVE_POLL_INTERVAL_MS = 5_000;

/** Active integration batches in a project. Polls while there is at least one batch in flight. */
export const useActiveIntegrationBatches = (projectId: string) => {
  const scopedKey = useOrgScopedKey(integrationBatchKeys.active(projectId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => integrationBatchesApi.listActive(projectId),
    enabled: !!projectId,
    refetchInterval: (query) => {
      const data = query.state.data as IntegrationBatch[] | undefined;
      if (!data) return false;
      return data.some((b) => isBatchActive(b.status))
        ? ACTIVE_POLL_INTERVAL_MS
        : false;
    },
  });
};

/** Single batch with items. Polls while batch is active. */
export const useIntegrationBatch = (id: string | null) => {
  const scopedKey = useOrgScopedKey(integrationBatchKeys.detail(id ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => integrationBatchesApi.get(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as IntegrationBatchWithItems | undefined;
      if (!data) return false;
      return isBatchActive(data.status) ? ACTIVE_POLL_INTERVAL_MS : false;
    },
  });
};

/** Trigger a new integration batch from the workItems currently in the Validating column. */
export const useTriggerIntegrationBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIntegrationBatchRequest) =>
      integrationBatchesApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationBatchKeys.all });
      // Invalidate work items / boards because items are visually grouped by batch.
      queryClient.invalidateQueries({ queryKey: ["boards"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
};

export const useApproveIntegrationBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => integrationBatchesApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationBatchKeys.all });
      queryClient.invalidateQueries({ queryKey: ["boards"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
};

export const useRejectIntegrationBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => integrationBatchesApi.reject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: integrationBatchKeys.all });
      queryClient.invalidateQueries({ queryKey: ["boards"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });
};
