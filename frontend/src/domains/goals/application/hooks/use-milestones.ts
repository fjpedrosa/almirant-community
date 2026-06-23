"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { milestonesApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  CreateMilestoneRequest,
  MilestoneWithProgress,
  UpdateMilestoneRequest,
} from "../../domain/types";

export const milestoneKeys = {
  all: ["milestones"] as const,
  lists: () => [...milestoneKeys.all, "list"] as const,
  list: (projectId: string) => [...milestoneKeys.lists(), projectId] as const,
  details: () => [...milestoneKeys.all, "detail"] as const,
  detail: (id: string) => [...milestoneKeys.details(), id] as const,
};

export const useMilestones = (projectId: string | null) => {
  const scopedKey = useOrgScopedKey(milestoneKeys.list(projectId ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => milestonesApi.list(projectId!) as Promise<MilestoneWithProgress[]>,
    enabled: !!projectId,
  });
};

export const useMilestone = (id: string | null) => {
  const scopedKey = useOrgScopedKey(milestoneKeys.detail(id ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => milestonesApi.get(id!) as Promise<MilestoneWithProgress>,
    enabled: !!id,
  });
};

export const useCreateMilestone = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateMilestoneRequest) =>
      milestonesApi.create(payload) as Promise<MilestoneWithProgress>,
    onSuccess: (milestone) => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.list(milestone.projectId) });
      queryClient.invalidateQueries({ queryKey: milestoneKeys.all });
    },
  });
};

export const useUpdateMilestone = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateMilestoneRequest }) =>
      milestonesApi.update(id, payload) as Promise<MilestoneWithProgress>,
    onSuccess: (milestone, variables) => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: milestoneKeys.list(milestone.projectId) });
    },
  });
};

export const useDeleteMilestone = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => milestonesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.all });
    },
  });
};

export const useAddWorkItemsToMilestone = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, workItemIds }: { id: string; workItemIds: string[] }) =>
      milestonesApi.addWorkItems(id, workItemIds) as Promise<{
        linked: number;
        milestone: MilestoneWithProgress;
      }>,
    onSuccess: ({ milestone }, variables) => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: milestoneKeys.list(milestone.projectId) });
    },
  });
};

export const useRemoveWorkItemFromMilestone = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, workItemId }: { id: string; workItemId: string }) =>
      milestonesApi.removeWorkItem(id, workItemId) as Promise<{
        removed: boolean;
        milestone: MilestoneWithProgress;
      }>,
    onSuccess: ({ milestone }, variables) => {
      queryClient.invalidateQueries({ queryKey: milestoneKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: milestoneKeys.list(milestone.projectId) });
    },
  });
};
