"use client";

import { useQuery } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { GithubPullRequest, GithubPrState } from "../../domain/types";
import { githubKeys } from "./use-github-summary";

export const useGithubPrs = (
  projectId: string,
  state?: GithubPrState
) => {
  const scopedKey = useOrgScopedKey([...githubKeys.prs(projectId), state]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      githubApi.getPullRequests(projectId, state) as Promise<
        GithubPullRequest[]
      >,
    enabled: !!projectId,
    staleTime: 30_000,
  });
};
