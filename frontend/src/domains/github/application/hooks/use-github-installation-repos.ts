"use client";

import { useQuery } from "@tanstack/react-query";
import { githubApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { githubKeys } from "./use-github-summary";
import type { GithubAvailableRepo } from "../../domain/types";

const fetchAllInstallationRepos = async (
  installationId: number
): Promise<GithubAvailableRepo[]> => {
  const allRepos: GithubAvailableRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const repos = (await githubApi.getInstallationRepos(
      installationId,
      page,
      perPage
    )) as GithubAvailableRepo[];

    allRepos.push(...repos);

    if (repos.length < perPage) break;
    page++;
  }

  return allRepos;
};

export const useGithubInstallationRepos = (
  installationId: number | null
) => {
  const scopedKey = useOrgScopedKey(githubKeys.installationRepos(installationId!));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => fetchAllInstallationRepos(installationId!),
    enabled: !!installationId,
    staleTime: 5 * 60 * 1000,
  });
};
