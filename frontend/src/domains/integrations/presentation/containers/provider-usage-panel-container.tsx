"use client";

import { useCallback } from "react";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProviderUsagePanel } from "../../application/hooks/use-provider-usage-panel";
import { ProviderUsagePanelSheet } from "../components/provider-usage-panel-sheet";
import { ConnectionUsageRowContainer } from "./connection-usage-row-container";
import type { ProviderType } from "../../domain/types";

export const ProviderUsagePanelContainer: React.FC = () => {
  const {
    isOpen,
    setIsOpen,
    onOpen,
    selectedWorkspaceId,
    onWorkspaceChange,
    workspaceOptions,
    providerGroups,
    isLoading,
    onRefreshAll,
    isRefreshingAll,
  } = useProviderUsagePanel();

  // Build a map of connections for the render callback
  const connectionMap = new Map<string, { connection: (typeof providerGroups)[number]["connections"][number]; provider: ProviderType }>();
  for (const group of providerGroups) {
    for (const conn of group.connections) {
      connectionMap.set(conn.id, { connection: conn, provider: group.provider });
    }
  }

  const renderConnectionRow = useCallback(
    (connectionId: string, provider: string) => {
      const entry = connectionMap.get(connectionId);
      if (!entry) return null;
      return (
        <ConnectionUsageRowContainer
          connection={entry.connection}
          provider={provider as ProviderType}
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providerGroups],
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-9 w-9"
        aria-label="Provider Usage"
        onClick={onOpen}
      >
        <Gauge className="h-4.5 w-4.5" />
      </Button>

      <ProviderUsagePanelSheet
        open={isOpen}
        onOpenChange={setIsOpen}
        selectedWorkspaceId={selectedWorkspaceId}
        workspaceOptions={workspaceOptions}
        onWorkspaceChange={onWorkspaceChange}
        providerGroups={providerGroups}
        isLoading={isLoading}
        onRefreshAll={onRefreshAll}
        isRefreshingAll={isRefreshingAll}
        renderConnectionRow={renderConnectionRow}
      />
    </>
  );
};
