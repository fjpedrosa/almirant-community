"use client";

import { useQuery } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { GithubConnectionStatus } from "../../domain/types";
import { githubKeys } from "./use-github-summary";

export const useGithubStatus = (options?: { enabled?: boolean }) => {
  const scopedKey = useOrgScopedKey(githubKeys.status());
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      githubApi.getStatus() as Promise<GithubConnectionStatus>,
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
};
