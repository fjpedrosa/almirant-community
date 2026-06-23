"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";

/**
 * Wraps Better-Auth's `useActiveOrganization()` and provides an optimistic
 * active-team id while the server switch is in progress.
 */
export const useActiveTeam = () => {
  const queryClient = useQueryClient();
  const { data: activeOrganization, isPending } =
    authClient.useActiveOrganization();
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const confirmedActiveTeamId = activeOrganization?.id ?? null;
  const effectiveActiveTeamId = pendingTeamId ?? confirmedActiveTeamId;

  useEffect(() => {
    if (!pendingTeamId) return;
    if (confirmedActiveTeamId !== pendingTeamId) return;
    setPendingTeamId(null);
    setIsSwitchingTeam(false);
  }, [confirmedActiveTeamId, pendingTeamId]);

  const setActiveTeam = useCallback(
    async (organizationId: string | null) => {
      if (!organizationId) return;
      if (organizationId === effectiveActiveTeamId && !isSwitchingTeam) return;

      const previousTeamId = effectiveActiveTeamId;
      setSwitchError(null);
      setIsSwitchingTeam(true);
      setPendingTeamId(organizationId);
      await queryClient.cancelQueries();

      if (organizationId) {
        try {
          const result = await authClient.organization.setActive({ organizationId });
          if (result.error) {
            throw new Error(result.error.message ?? "Failed to switch workspace");
          }

          // Remove all workspace-scoped query cache so the UI immediately
          // shows loading/skeleton states. Preserve "teams" (user-scoped,
          // powers the workspace switcher dropdown). Better-Auth hooks use
          // nanostores, not React Query — unaffected.
          queryClient.removeQueries({
            predicate: (query) => query.queryKey[0] !== "teams",
          });
          await queryClient.refetchQueries({ type: "active" });
        } catch (error) {
          setPendingTeamId(previousTeamId);
          setIsSwitchingTeam(false);
          const message =
            error instanceof Error ? error.message : "Failed to switch workspace";
          setSwitchError(message);
          throw new Error(message);
        }
      }
    },
    [effectiveActiveTeamId, isSwitchingTeam, queryClient],
  );

  const activeTeam = useMemo(() => {
    if (!activeOrganization) return null;
    return activeOrganization;
  }, [activeOrganization]);

  return {
    activeTeam,
    activeTeamId: effectiveActiveTeamId,
    confirmedActiveTeamId,
    isLoading: isPending,
    isSwitchingTeam,
    switchError,
    setActiveTeam,
  };
};
