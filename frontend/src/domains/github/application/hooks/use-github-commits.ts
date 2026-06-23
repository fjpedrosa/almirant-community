"use client";

import { useQuery } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { GithubCommit } from "../../domain/types";
import { githubKeys } from "./use-github-summary";

export const useGithubCommits = (
  projectId: string,
  limit?: number
) => {
  const scopedKey = useOrgScopedKey([...githubKeys.commits(projectId), limit]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      githubApi.getCommits(projectId, limit) as Promise<GithubCommit[]>,
    enabled: !!projectId,
    staleTime: 30_000,
  });
};
