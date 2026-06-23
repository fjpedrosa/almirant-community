"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { skillsApi } from "@/lib/api/client";
import { skillKeys } from "./use-skills";
import type { CreateSkillRequest, UpdateSkillRequest } from "../../domain/types";

export const useCreateSkill = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSkillRequest) => skillsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillKeys.lists() });
      queryClient.invalidateQueries({ queryKey: skillKeys.selector() });
    },
  });
};

export const useUpdateSkill = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateSkillRequest }) =>
      skillsApi.update(id, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: skillKeys.lists() });
      queryClient.invalidateQueries({ queryKey: skillKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: skillKeys.selector() });
    },
  });
};

export const useDeleteSkill = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => skillsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: skillKeys.lists() });
      queryClient.invalidateQueries({ queryKey: skillKeys.selector() });
    },
  });
};
