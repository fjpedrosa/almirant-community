"use client";

import { useQuery } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { GithubEvent } from "../../domain/types";
import { githubKeys } from "./use-github-summary";

export const useGithubActivity = (
  projectId: string,
  limit?: number,
  enabled = true
) => {
  const scopedKey = useOrgScopedKey([...githubKeys.activity(projectId), limit]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      githubApi.getActivity(projectId, limit) as Promise<GithubEvent[]>,
    enabled: !!projectId && enabled,
    staleTime: 30_000,
  });
};
