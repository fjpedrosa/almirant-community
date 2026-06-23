"use client";

import { authClient } from "@/lib/auth-client";

/**
 * Wraps Better-Auth's `useListOrganizations()` to return the list of
 * teams the current user belongs to.
 */
export const useCurrentUserTeams = () => {
  const { data: organizations, isPending } =
    authClient.useListOrganizations();

  return {
    teams: (organizations ?? []) as {
      id: string;
      name: string;
      slug: string;
      logo?: string | null;
    }[],
    isLoading: isPending,
  };
};
