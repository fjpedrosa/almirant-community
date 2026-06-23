"use client";

import { useState, useMemo, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { useCurrentUserTeams } from "@/domains/teams/application/hooks/use-current-user-teams";
import { useConnections, connectionKeys } from "./use-connections";
import type { ProviderGroup, ProviderType } from "../../domain/types";

export const useProviderUsagePanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const queryClient = useQueryClient();
  const { activeTeamId } = useActiveTeam();
  const { teams, isLoading: isLoadingTeams } = useCurrentUserTeams();

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const effectiveWorkspaceId = selectedWorkspaceId ?? activeTeamId;

  // Sync default when activeTeamId becomes available
  const resolvedWorkspaceId = effectiveWorkspaceId;

  const params = useMemo(() => {
    if (!resolvedWorkspaceId) return undefined;
    const sp = new URLSearchParams();
    sp.set("scope", "organization");
    sp.set("category", "ai");
    sp.set("isActive", "true");
    sp.set("scopeId", resolvedWorkspaceId);
    return sp;
  }, [resolvedWorkspaceId]);

  const { data: connections, isLoading: isLoadingConnections } = useConnections(
    isOpen ? params : undefined,
  );

  const providerGroups = useMemo<ProviderGroup[]>(() => {
    if (!connections) return [];
    const map = new Map<ProviderType, ProviderGroup>();
    for (const conn of connections) {
      const existing = map.get(conn.provider);
      if (existing) {
        existing.connections.push(conn);
      } else {
        map.set(conn.provider, { provider: conn.provider, connections: [conn] });
      }
    }
    return Array.from(map.values());
  }, [connections]);

  const workspaceOptions = useMemo(
    () => teams.map((t) => ({ id: t.id, name: t.name })),
    [teams],
  );

  const onOpen = useCallback(() => setIsOpen(true), []);
  const onClose = useCallback(() => setIsOpen(false), []);
  const onWorkspaceChange = useCallback((id: string) => setSelectedWorkspaceId(id), []);

  const onRefreshAll = useCallback(async () => {
    setIsRefreshingAll(true);
    await queryClient.invalidateQueries({ queryKey: connectionKeys.all });
    setIsRefreshingAll(false);
  }, [queryClient]);

  return {
    isOpen,
    onOpen,
    onClose,
    setIsOpen,
    selectedWorkspaceId: resolvedWorkspaceId,
    onWorkspaceChange,
    workspaceOptions,
    providerGroups,
    isLoading: isLoadingConnections || isLoadingTeams,
    onRefreshAll,
    isRefreshingAll,
  };
};
