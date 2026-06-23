"use client";

import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import type { TeamDetail } from "../../domain/types";
import { teamKeys } from "./use-teams";

// ──────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────

/**
 * Fetch the full organisation detail (including members and invitations)
 * for the currently active team.
 *
 * Better-Auth's `getFullOrganization` operates on the session's active
 * organisation, so the caller must ensure `setActive` has been called for
 * the desired team before using this hook.
 *
 * @param teamId - Used as a cache key discriminator. The actual data
 *   fetched corresponds to the session's active organisation.
 */
export const useTeamDetail = (teamId: string) => {
  return useQuery({
    queryKey: teamKeys.detail(teamId),
    queryFn: async (): Promise<TeamDetail> => {
      const result = await authClient.organization.getFullOrganization();
      if (result.error) {
        throw new Error(
          result.error.message ?? "Failed to fetch team detail",
        );
      }

      const org = result.data;
      if (!org) {
        throw new Error("No active organisation found");
      }

      return org as unknown as TeamDetail;
    },
    enabled: !!teamId,
  });
};
