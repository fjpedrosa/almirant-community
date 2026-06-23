"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { githubKeys } from "./use-github-summary";

export const useGithubSync = (projectId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => githubApi.sync(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: githubKeys.all,
      });
    },
  });
};
