"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import type { TeamMemberUser } from "../../domain/types";
import { teamKeys } from "./use-teams";
import { useActiveTeam } from "./use-active-team";

/**
 * Fetches team members for use in multi-select assignment components.
 *
 * When the user has an active team (organisation), fetches all members
 * via Better-Auth's `getFullOrganization`. Returns `hasActiveTeam: false`
 * when no team is active so the caller can fall back to a text input.
 */
export const useTeamMembersSelect = () => {
  const {
    confirmedActiveTeamId: activeTeamId,
    isLoading: isLoadingOrg,
  } = useActiveTeam();
  const hasActiveTeam = !!activeTeamId;

  const { data: fullOrg, isLoading: isLoadingMembers } = useQuery({
    queryKey: teamKeys.detail(activeTeamId ?? "members-select"),
    queryFn: async () => {
      const result = await authClient.organization.getFullOrganization();
      if (result.error) {
        throw new Error(result.error.message ?? "Failed to fetch team members");
      }
      return result.data;
    },
    enabled: hasActiveTeam,
  });

  const members: TeamMemberUser[] = useMemo(() => {
    if (!fullOrg?.members) return [];
    return fullOrg.members.map((member: Record<string, unknown>) => {
      const user = member.user as Record<string, unknown> | undefined;
      return {
        id: (user?.id as string) ?? (member.userId as string) ?? "",
        name: (user?.name as string) ?? "",
        email: (user?.email as string) ?? "",
        image: (user?.image as string | null) ?? null,
      };
    });
  }, [fullOrg]);

  return {
    members,
    isLoading: isLoadingOrg || isLoadingMembers,
    hasActiveTeam,
  };
};
