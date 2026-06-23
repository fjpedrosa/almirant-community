"use client";

import { useQuery } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { GithubWorkflowRun } from "../../domain/types";
import { githubKeys } from "./use-github-summary";

export const useGithubActions = (
  projectId: string,
  limit?: number
) => {
  const scopedKey = useOrgScopedKey([...githubKeys.actions(projectId), limit]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      githubApi.getActions(projectId, limit) as Promise<GithubWorkflowRun[]>,
    enabled: !!projectId,
    staleTime: 30_000,
  });
};
