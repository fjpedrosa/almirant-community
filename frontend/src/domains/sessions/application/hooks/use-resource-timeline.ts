"use client";

import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api/client";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { ResourceTimeline } from "@/domains/agents/domain/types";

export const useResourceTimeline = (
  jobId: string | null | undefined,
  options?: { enabled?: boolean; isLive?: boolean },
) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(["agent-jobs", jobId ?? "", "resource-timeline"]);

  return useQuery({
    queryKey: scopedKey,
    queryFn: () => request<ResourceTimeline>(`/agent-jobs/${jobId!}/resource-timeline`),
    enabled: !!jobId && !!confirmedActiveTeamId && (options?.enabled ?? true),
    staleTime: options?.isLive ? 0 : 30_000,
    refetchInterval: options?.isLive ? 4_000 : false,
  });
};
