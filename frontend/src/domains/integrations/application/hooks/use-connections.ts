"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { connectionsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  ProviderConnection,
  CreateConnectionInput,
  UpdateConnectionInput,
  TestConnectionResult,
  TestCredentialsInput,
  RefreshConnectionResult,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const connectionKeys = {
  all: ["connections"] as const,
  lists: () => [...connectionKeys.all, "list"] as const,
  list: (filters: string) => [...connectionKeys.lists(), filters] as const,
  details: () => [...connectionKeys.all, "detail"] as const,
  detail: (id: string) => [...connectionKeys.details(), id] as const,
  usageSummary: () => [...connectionKeys.all, "usage-summary"] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const useConnections = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(connectionKeys.list(params?.toString() || ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      connectionsApi.list(params) as Promise<ProviderConnection[]>,
  });
};

export const useConnection = (id: string) => {
  const scopedKey = useOrgScopedKey(connectionKeys.detail(id));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => connectionsApi.get(id) as Promise<ProviderConnection>,
    enabled: !!id,
  });
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const useCreateConnection = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateConnectionInput) =>
      connectionsApi.create(data) as Promise<ProviderConnection>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    },
  });
};

export const useUpdateConnection = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateConnectionInput }) =>
      connectionsApi.update(id, data) as Promise<ProviderConnection>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    },
  });
};

export const useDeleteConnection = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => connectionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    },
  });
};

export const useTestConnection = () => {
  return useMutation({
    mutationFn: (id: string) =>
      connectionsApi.test(id) as Promise<TestConnectionResult>,
  });
};

export const useTestCredentials = () => {
  return useMutation({
    mutationFn: (data: TestCredentialsInput) =>
      connectionsApi.testCredentials(data) as Promise<TestConnectionResult>,
  });
};

export const useRefreshConnection = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      connectionsApi.refresh(id) as Promise<RefreshConnectionResult>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    },
  });
};

export const useSetDefaultConnection = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => connectionsApi.setDefault(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    },
  });
};

export const useReorderConnections = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectionIds: string[]) =>
      connectionsApi.reorderPriorities(connectionIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    },
  });
};
