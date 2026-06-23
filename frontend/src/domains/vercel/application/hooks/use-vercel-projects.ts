"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { vercelApi } from "@/lib/api/client";
import type { VercelProject } from "../../domain/types";
import { vercelKeys } from "./use-vercel-status";

export const useVercelProjects = () => {
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: vercelKeys.projects(),
    queryFn: () => vercelApi.getProjects() as Promise<VercelProject[]>,
    staleTime: 60_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      framework?: string;
      gitRepository?: { type: string; repo: string };
    }) => vercelApi.createProject(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vercelKeys.projects() });
    },
  });

  return {
    projects: projectsQuery.data ?? [],
    isLoading: projectsQuery.isLoading,
    createProject: createMutation.mutate,
    isCreating: createMutation.isPending,
  };
};
