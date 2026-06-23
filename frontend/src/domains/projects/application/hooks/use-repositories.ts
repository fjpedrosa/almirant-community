"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { repositoriesApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  ProjectRepository,
  CreateRepositoryRequest,
  UpdateRepositoryRequest,
} from "../../domain/types";
import { projectKeys } from "./use-projects";

export const repositoryKeys = {
  all: ["repositories"] as const,
  lists: () => [...repositoryKeys.all, "list"] as const,
  list: (projectId: string) => [...repositoryKeys.lists(), projectId] as const,
};

export const useRepositories = (projectId: string) => {
  const scopedKey = useOrgScopedKey(repositoryKeys.list(projectId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => repositoriesApi.list(projectId) as Promise<ProjectRepository[]>,
    enabled: !!projectId,
  });
};

export const useCreateRepository = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: CreateRepositoryRequest }) =>
      repositoriesApi.create(projectId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: repositoryKeys.list(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detailBatch(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: ["projects", "linked-github-urls"] });
    },
  });
};

export const useUpdateRepository = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, repoId, data }: { projectId: string; repoId: string; data: UpdateRepositoryRequest }) =>
      repositoriesApi.update(projectId, repoId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: repositoryKeys.list(variables.projectId) });
    },
  });
};

export const useDeleteRepository = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, repoId }: { projectId: string; repoId: string }) =>
      repositoriesApi.delete(projectId, repoId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: repositoryKeys.list(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detailBatch(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: ["projects", "linked-github-urls"] });
    },
  });
};
