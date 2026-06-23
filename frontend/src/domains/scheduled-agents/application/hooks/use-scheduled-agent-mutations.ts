"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { scheduledAgentsApi } from "@/lib/api/client";
import { scheduledAgentKeys } from "./use-scheduled-agents";
import type {
  CreateScheduledAgentData,
  UpdateScheduledAgentData,
} from "../../domain/types";

export const useCreateScheduledAgent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateScheduledAgentData) =>
      scheduledAgentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduledAgentKeys.all });
    },
  });
};

export const useUpdateScheduledAgent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateScheduledAgentData }) =>
      scheduledAgentsApi.update(id, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: scheduledAgentKeys.all });
      queryClient.invalidateQueries({
        queryKey: scheduledAgentKeys.detail(variables.id),
      });
    },
  });
};

export const useDeleteScheduledAgent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => scheduledAgentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduledAgentKeys.all });
    },
  });
};

export const useTriggerScheduledAgent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => scheduledAgentsApi.trigger(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scheduledAgentKeys.all });
    },
  });
};

export const useToggleScheduledAgent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      scheduledAgentsApi.update(id, { enabled }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: scheduledAgentKeys.all });
      queryClient.invalidateQueries({
        queryKey: scheduledAgentKeys.detail(variables.id),
      });
    },
  });
};
