"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { seedKeys, seedMutationKeys } from "../../domain/query-keys";
import { seedsApi } from "../../infrastructure/api/planning-api";
import type {
  CreateSeedRequest,
  PaginatedSeedsResponse,
  Seed,
  SeedStatus,
  SeedWithRelations,
  UpdateSeedRequest,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const useSeeds = (params?: URLSearchParams) => {
  return useQuery({
    queryKey: seedKeys.list(params?.toString() ?? ""),
    queryFn: () => seedsApi.list(params) as Promise<SeedWithRelations[]>,
    placeholderData: keepPreviousData,
  });
};

export const useSeedsWithPagination = (params?: URLSearchParams) => {
  return useQuery({
    queryKey: seedKeys.list(`paginated:${params?.toString() ?? ""}`),
    queryFn: async (): Promise<PaginatedSeedsResponse> => {
      const result = await seedsApi.listWithMeta(params);
      return {
        items: result.data as SeedWithRelations[],
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
  });
};

export const useSeed = (id: string | null) => {
  return useQuery({
    queryKey: seedKeys.detail(id ?? ""),
    queryFn: () => seedsApi.get(id!) as Promise<SeedWithRelations>,
    enabled: !!id,
  });
};

export const useSelectedSeeds = (projectId?: string) => {
  return useQuery({
    queryKey: [...seedKeys.selected(), projectId ?? "all"],
    queryFn: () =>
      seedsApi.getSelected(projectId) as Promise<SeedWithRelations[]>,
  });
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const useCreateSeed = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSeedRequest) =>
      seedsApi.create(data) as Promise<Seed>,
    onSuccess: () => {
      for (const queryKey of seedMutationKeys()) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useUpdateSeed = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSeedRequest }) =>
      seedsApi.update(id, data),
    onSuccess: (_result, variables) => {
      for (const queryKey of seedMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useDeleteSeed = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => seedsApi.delete(id),
    onSuccess: (_result, id) => {
      for (const queryKey of seedMutationKeys(id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useSetSeedStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: SeedStatus }) =>
      seedsApi.setStatus(id, status),
    onSuccess: (_result, variables) => {
      for (const queryKey of seedMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useToggleSeedSelection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, selected }: { id: string; selected: boolean }) =>
      seedsApi.toggleSelectedForIdeation(id, selected),
    onSuccess: (_result, variables) => {
      for (const queryKey of seedMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useBulkSeedSelection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, selected }: { ids: string[]; selected: boolean }) =>
      seedsApi.bulkSelectForIdeation(ids, selected),
    onSuccess: () => {
      for (const queryKey of seedMutationKeys()) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
