"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { githubApi } from "@/lib/api/client";
import { githubKeys } from "@/domains/github/application/hooks/use-github-summary";
import { useProjectsWithPagination } from "./use-projects";
import type { GithubProjectSummary } from "@/domains/github/domain/types";
import type {
  ProjectGithubInfo,
  ProjectStatus,
  ProjectWithRelations,
} from "../../domain/types";

export const statusLabels: Record<ProjectStatus, string> = {
  active: "Activo",
  archived: "Archivado",
  on_hold: "En pausa",
};

export const statusColors: Record<ProjectStatus, string> = {
  active: "bg-green-500/10 text-green-600",
  archived: "bg-gray-500/10 text-gray-600",
  on_hold: "bg-yellow-500/10 text-yellow-600",
};

export const colorOptions = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#f43f5e", "#78716c", "#64748b", "#475569", "#1e293b",
];

export const useProjectsPage = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Parse filters from URL
  const filters = useMemo(() => {
    const searchParam = searchParams.get("search") || "";
    const statusParam = searchParams.get("status") || "all";
    return { search: searchParam, statusFilter: statusParam };
  }, [searchParams]);

  const [search, setSearchState] = useState(filters.search);
  const [statusFilter, setStatusFilterState] = useState(filters.statusFilter);
  const [dialogOpen, setDialogOpen] = useState(false);

  const getCanonicalParams = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("org");
    return params;
  }, [searchParams]);

  useEffect(() => {
    if (!searchParams.has("org")) return;

    const params = getCanonicalParams();
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [getCanonicalParams, pathname, router, searchParams]);

  // Update URL when filters change
  const setSearch = useCallback(
    (value: string) => {
      setSearchState(value);
      const params = getCanonicalParams();
      if (value) {
        params.set("search", value);
      } else {
        params.delete("search");
      }
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [getCanonicalParams, router, pathname]
  );

  const setStatusFilter = useCallback(
    (value: string) => {
      setStatusFilterState(value);
      const params = getCanonicalParams();
      if (value !== "all") {
        params.set("status", value);
      } else {
        params.delete("status");
      }
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [getCanonicalParams, router, pathname]
  );

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (statusFilter !== "all") params.set("status", statusFilter);

  const { data, isLoading } = useProjectsWithPagination(params);

  const projects = useMemo(() => (data?.projects || []).filter(p => p.status !== 'archived'), [data?.projects]);
  const githubProjects = useMemo(
    () =>
      projects.filter((project) =>
        project.repositories.some((repository) => repository.provider === "github")
      ),
    [projects]
  );

  // Stable list of the project ids that have a GitHub repo. Used both as the
  // batch request payload and (joined) as the query key.
  const githubProjectIds = useMemo(
    () => githubProjects.map((project) => project.id),
    [githubProjects]
  );

  // ONE batch request instead of one summary request per project (N+1 → 1).
  const githubSummariesQuery = useQuery({
    queryKey: githubKeys.summaries(githubProjectIds),
    queryFn: () =>
      githubApi.getSummaries(githubProjectIds) as Promise<
        Record<string, GithubProjectSummary>
      >,
    enabled: githubProjectIds.length > 0,
    staleTime: 300_000,
  });

  const githubSummaryByProjectId = useMemo(() => {
    const summaryByProjectId: Record<string, ProjectGithubInfo> = {};
    const summariesByProjectId = githubSummariesQuery.data ?? {};

    githubProjects.forEach((project) => {
      const summary = summariesByProjectId[project.id];
      const githubRepo = project.repositories.find(
        (repository) => repository.provider === "github"
      );
      if (!githubRepo) return;

      summaryByProjectId[project.id] = {
        githubRepoUrl: githubRepo.url ?? null,
        openPrCount: summary?.openPrCount ?? 0,
        lastCommitAt: summary?.lastCommitAt ?? null,
        lastDeployStatus: summary?.lastDeployStatus ?? null,
      };
    });

    return summaryByProjectId;
  }, [githubProjects, githubSummariesQuery.data]);

  const projectsWithGithub = useMemo(
    () =>
      projects.map((project) => {
        const githubRepo = project.repositories.find(
          (repository) => repository.provider === "github"
        );

        if (!githubRepo) return project;

        const githubSummary = githubSummaryByProjectId[project.id] ?? {
          githubRepoUrl: githubRepo.url ?? null,
          openPrCount: 0,
          lastCommitAt: null,
          lastDeployStatus: null,
        };

        return {
          ...project,
          github: githubSummary,
        } satisfies ProjectWithRelations & {
          github: ProjectGithubInfo;
        };
      }),
    [projects, githubSummaryByProjectId]
  );

  return {
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    dialogOpen,
    setDialogOpen,
    projects: projectsWithGithub,
    isLoading,
  };
};
