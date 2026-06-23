"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { githubKeys } from "./use-github-summary";
import type {
  CreateGithubRepoRequest,
  CreateGithubRepoResponse,
} from "../../domain/types";

export const useCreateGithubRepo = (installationId: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateGithubRepoRequest) =>
      githubApi.createRepo(installationId, data) as Promise<CreateGithubRepoResponse>,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: githubKeys.installationRepos(installationId),
      });
      queryClient.invalidateQueries({
        queryKey: githubKeys.all,
      });
    },
  });
};
