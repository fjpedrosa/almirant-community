"use client";

import { useQuery } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { GithubProjectSummary } from "../../domain/types";

export const githubKeys = {
  all: ["github"] as const,
  summary: (projectId: string) =>
    [...githubKeys.all, "summary", projectId] as const,
  summaries: (projectIds: string[]) =>
    [...githubKeys.all, "summaries", [...projectIds].sort().join(",")] as const,
  prs: (projectId: string) =>
    [...githubKeys.all, "prs", projectId] as const,
  commits: (projectId: string) =>
    [...githubKeys.all, "commits", projectId] as const,
  actions: (projectId: string) =>
    [...githubKeys.all, "actions", projectId] as const,
  contributors: (projectId: string) =>
    [...githubKeys.all, "contributors", projectId] as const,
  activity: (projectId: string) =>
    [...githubKeys.all, "activity", projectId] as const,
  status: () => [...githubKeys.all, "status"] as const,
  installations: () => [...githubKeys.all, "installations"] as const,
  installationRepos: (installationId: number) =>
    [...githubKeys.all, "installation-repos", installationId] as const,
};

export const useGithubSummary = (projectId: string, enabled = true) => {
  const scopedKey = useOrgScopedKey(githubKeys.summary(projectId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      githubApi.getSummary(projectId) as Promise<GithubProjectSummary>,
    enabled: !!projectId && enabled,
    staleTime: 30_000,
  });
};
