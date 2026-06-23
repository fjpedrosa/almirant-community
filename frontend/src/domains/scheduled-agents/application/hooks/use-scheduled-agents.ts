"use client";

import { useQuery } from "@tanstack/react-query";
import { scheduledAgentsApi } from "@/lib/api/client";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import type { ScheduledAgentConfig } from "../../domain/types";

export const scheduledAgentKeys = {
  all: ["scheduled-agents"] as const,
  lists: () => [...scheduledAgentKeys.all, "list"] as const,
  list: (filters: string) => [...scheduledAgentKeys.lists(), filters] as const,
  details: () => [...scheduledAgentKeys.all, "detail"] as const,
  detail: (id: string) => [...scheduledAgentKeys.details(), id] as const,
};

export const useScheduledAgents = (projectId?: string) => {
  const { confirmedActiveTeamId } = useActiveTeam();

  return useQuery({
    queryKey: [
      ...scheduledAgentKeys.list(projectId ?? "all"),
      `org:${confirmedActiveTeamId ?? "none"}`,
    ],
    queryFn: async (): Promise<ScheduledAgentConfig[]> => {
      const params = projectId ? new URLSearchParams({ projectId }) : undefined;
      return scheduledAgentsApi.list(params);
    },
    enabled: !!confirmedActiveTeamId,
  });
};

export const useScheduledAgent = (id: string | null) => {
  const { confirmedActiveTeamId } = useActiveTeam();

  return useQuery({
    queryKey: [
      ...scheduledAgentKeys.detail(id ?? ""),
      `org:${confirmedActiveTeamId ?? "none"}`,
    ],
    queryFn: () => scheduledAgentsApi.get(id!),
    enabled: !!id && !!confirmedActiveTeamId,
  });
};
