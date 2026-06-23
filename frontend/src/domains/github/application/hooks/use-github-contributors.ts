"use client";

import { useQuery } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { GithubContributor } from "../../domain/types";
import { githubKeys } from "./use-github-summary";

export const useGithubContributors = (projectId: string) => {
  const scopedKey = useOrgScopedKey(githubKeys.contributors(projectId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      githubApi.getContributors(projectId) as Promise<GithubContributor[]>,
    select: (contributors) => {
      const byLogin = new Map<string, GithubContributor>();

      for (const contributor of contributors) {
        const login = contributor.login.trim().toLowerCase();
        if (!login) continue;

        const current = byLogin.get(login);
        if (!current) {
          byLogin.set(login, {
            ...contributor,
            login,
          });
          continue;
        }

        byLogin.set(login, {
          ...current,
          commitCount: current.commitCount + contributor.commitCount,
          name: current.name ?? contributor.name ?? null,
          avatarUrl: current.avatarUrl ?? contributor.avatarUrl ?? null,
        });
      }

      return Array.from(byLogin.values()).sort(
        (a, b) => b.commitCount - a.commitCount
      );
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
};
