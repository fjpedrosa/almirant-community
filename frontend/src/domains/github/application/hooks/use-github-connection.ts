"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import type { GithubInstallation } from "../../domain/types";
import { githubKeys } from "./use-github-summary";

export const useGithubInstallations = () => {
  return useQuery({
    queryKey: githubKeys.installations(),
    queryFn: () =>
      githubApi.getInstallations() as Promise<GithubInstallation[]>,
    staleTime: 60_000,
  });
};

export const useGithubLinkRepo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      installationId,
      repoId,
      githubRepoFullName,
    }: {
      installationId: string;
      repoId: string;
      githubRepoFullName: string;
    }) => githubApi.linkRepo(installationId, repoId, githubRepoFullName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: githubKeys.status() });
      queryClient.invalidateQueries({ queryKey: githubKeys.installations() });
    },
  });
};

export const useGithubUnlinkRepo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      installationId,
      repoId,
    }: {
      installationId: string;
      repoId: string;
    }) => githubApi.unlinkRepo(installationId, repoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: githubKeys.status() });
      queryClient.invalidateQueries({ queryKey: githubKeys.installations() });
    },
  });
};
