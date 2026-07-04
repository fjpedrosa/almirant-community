"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { useSeededActiveOrgId } from "@/domains/teams/application/active-org-context";
import { resolveActiveOrgId } from "@/domains/teams/domain/active-org";

/**
 * Wraps Better-Auth's `useActiveOrganization()` and provides an optimistic
 * active-team id while the server switch is in progress.
 */
export const useActiveTeam = () => {
  const queryClient = useQueryClient();
  const { data: activeOrganization, isPending } =
    authClient.useActiveOrganization();
  const seededActiveOrgId = useSeededActiveOrgId();
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null);
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Live id from the async org fetch (null until it resolves / no org).
  const liveConfirmedTeamId = activeOrganization?.id ?? null;
  // Scoping id: the live value wins once available; until then fall back to the
  // id seeded from the server session so the scope is stable from render 0
  // (no `org:none` → `org:<id>` transition, i.e. no double fetch). A client-side
  // workspace switch is still tracked because the live value overrides the seed.
  const confirmedActiveTeamId = resolveActiveOrgId(
    liveConfirmedTeamId,
    seededActiveOrgId,
  );
  const effectiveActiveTeamId = pendingTeamId ?? confirmedActiveTeamId;

  useEffect(() => {
    if (!pendingTeamId) return;
    // Confirm the switch against the LIVE value only — the seed must not
    // short-circuit switch detection.
    if (liveConfirmedTeamId !== pendingTeamId) return;
    setPendingTeamId(null);
    setIsSwitchingTeam(false);
  }, [liveConfirmedTeamId, pendingTeamId]);

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
