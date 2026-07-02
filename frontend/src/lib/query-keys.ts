"use client";

import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";

/**
 * Returns an org-scoped query key by appending `org:<activeTeamId>` to the base key.
 * This ensures React Query cache is naturally partitioned by workspace.
 *
 * @example
 * const scopedKey = useOrgScopedKey(workItemKeys.list(filterKey));
 * // Returns: [...workItemKeys.list(filterKey), "org:abc123"]
 */
export const useOrgScopedKey = <T extends readonly unknown[]>(
  baseKey: T
): readonly unknown[] => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return [...baseKey, `org:${confirmedActiveTeamId ?? "none"}`];
};
