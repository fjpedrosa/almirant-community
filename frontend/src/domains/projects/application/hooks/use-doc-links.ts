"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { docLinksApi } from "@/lib/api/client";
import type {
  ProjectDocLink,
  CreateDocLinkRequest,
  UpdateDocLinkRequest,
} from "../../domain/types";
import { projectKeys } from "./use-projects";

export const docLinkKeys = {
  all: ["doc-links"] as const,
  lists: () => [...docLinkKeys.all, "list"] as const,
  list: (projectId: string) => [...docLinkKeys.lists(), projectId] as const,
};

export const useDocLinks = (projectId: string) => {
  return useQuery({
    queryKey: docLinkKeys.list(projectId),
    queryFn: () => docLinksApi.list(projectId) as Promise<ProjectDocLink[]>,
    enabled: !!projectId,
  });
};

export const useCreateDocLink = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: CreateDocLinkRequest }) =>
      docLinksApi.create(projectId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: docLinkKeys.list(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detailBatch(variables.projectId) });
    },
  });
};

export const useUpdateDocLink = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, linkId, data }: { projectId: string; linkId: string; data: UpdateDocLinkRequest }) =>
      docLinksApi.update(projectId, linkId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: docLinkKeys.list(variables.projectId) });
    },
  });
};

export const useDeleteDocLink = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, linkId }: { projectId: string; linkId: string }) =>
      docLinksApi.delete(projectId, linkId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: docLinkKeys.list(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detailBatch(variables.projectId) });
    },
  });
};

export const useReorderDocLinks = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, linkIds }: { projectId: string; linkIds: string[] }) =>
      docLinksApi.reorder(projectId, linkIds),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: docLinkKeys.list(variables.projectId) });
    },
  });
};
