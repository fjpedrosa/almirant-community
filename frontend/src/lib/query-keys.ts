"use client";

import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { orgScopedKey } from "@/lib/org-scoped-key";

/**
 * Returns an org-scoped query key by appending `org:<activeTeamId>` to the base key.
 * This ensures React Query cache is naturally partitioned by workspace.
 *
 * Delegates to the pure {@link orgScopedKey} so the client hook and any
 * server-side (RSC) prefetch build the IDENTICAL key — otherwise the dehydrated
 * cache misses on hydration and the client refetches. The active-org id is
 * seeded from the server session (see `useActiveTeam`), so it is already
 * `org:<id>` on render 0 — there is no transient `org:none` phase.
 *
 * @example
 * const scopedKey = useOrgScopedKey(workItemKeys.list(filterKey));
 * // Returns: [...workItemKeys.list(filterKey), "org:abc123"]
 */
export const useOrgScopedKey = <T extends readonly unknown[]>(
  baseKey: T
): readonly unknown[] => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return orgScopedKey(baseKey, confirmedActiveTeamId);
};
