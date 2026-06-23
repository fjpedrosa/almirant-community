"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import type {
  ProjectWithRelations,
  CreateProjectRequest,
  UpdateProjectRequest,
  PaginatedProjectsResponse,
} from "../../domain/types";

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => [...projectKeys.all, "list"] as const,
  list: (filters: string) => [...projectKeys.lists(), filters] as const,
  details: () => [...projectKeys.all, "detail"] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
  detailBatch: (id: string) => [...projectKeys.all, "detail-batch", id] as const,
  linkedGithubUrls: () => [...projectKeys.all, "linked-github-urls"] as const,
  statsByType: (id: string) => [...projectKeys.all, "stats-by-type", id] as const,
  nightlyValidation: (id: string) => [...projectKeys.all, "nightly-validation", id] as const,
  aiConfig: (id: string) => [...projectKeys.all, "ai-config", id] as const,
  discordChannel: (projectId: string) => [...projectKeys.all, "discord-channel", projectId] as const,
  discordNotificationPrefs: (projectId: string) => [...projectKeys.all, "discord-notification-prefs", projectId] as const,
};

export const useProjects = (params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(projectKeys.list(params?.toString() || ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => projectsApi.list(params) as Promise<ProjectWithRelations[]>,
    placeholderData: keepPreviousData,
    enabled: !!confirmedActiveTeamId,
  });
};

export const useProjectsWithPagination = (params?: URLSearchParams) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(projectKeys.list(params?.toString() || "paginated"));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<PaginatedProjectsResponse> => {
      const result = await projectsApi.listWithMeta(params);
      return {
        projects: result.data as ProjectWithRelations[],
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
    enabled: !!confirmedActiveTeamId,
  });
};

export const useProject = (id: string) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(projectKeys.detail(id));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => projectsApi.get(id) as Promise<ProjectWithRelations>,
    enabled: !!id && !!confirmedActiveTeamId,
  });
};

export const useCreateProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectRequest) => projectsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
};

export const useUpdateProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProjectRequest }) =>
      projectsApi.update(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detailBatch(variables.id) });
    },
  });
};

export const useDeleteProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
};

export const useArchiveProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
};
