"use client";

import { useMemo } from "react";
import { useRepositories } from "@/domains/projects/application/hooks/use-repositories";
import type { RepoOption } from "../../domain/types";

export const useProjectRepos = (projectId: string | null | undefined) => {
  const { data, isLoading, error } = useRepositories(projectId ?? "");

  const repos: RepoOption[] = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    return data.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.url ? `${repo.name} (${repo.url})` : repo.name,
    }));
  }, [data]);

  return { repos, isLoading, error };
};
