"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workItemsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { workItemKeys } from "./use-work-items";
import { useChildrenEvents } from "./use-children-events";
import { useWorkItemEvents } from "./use-work-item-events";
import { useWorkItemExecutionOrigin } from "./use-work-item-execution-origin";
import { useDetailPanelUrl } from "@/domains/shared/application/hooks/use-detail-panel-url";
import type { WorkItemWithRelations } from "../../domain/types";

export const useParentDetailPanel = () => {
  const queryClient = useQueryClient();
  const { selectedItemId: urlItemId, isOpen: urlIsOpen, open: urlOpen, onOpenChange: urlOnOpenChange } = useDetailPanelUrl("workItemId");
  const [navigationOverrideId, setNavigationOverrideId] = useState<string | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"details" | "history" | "sessions">("details");
  const [showAll, setShowAll] = useState(false);

  const currentParentId = navigationOverrideId ?? urlItemId;
  const isOpen = urlIsOpen;

  const queryEnabled = isOpen && !!currentParentId;
  const historyEnabled = queryEnabled && activeTab === "history";

  const parentScopedKey = useOrgScopedKey(workItemKeys.detail(currentParentId ?? ""));
  const childrenScopedKey = useOrgScopedKey([...workItemKeys.all, "children", currentParentId ?? ""]);

  const { data: parentItem, isLoading: isLoadingParent } = useQuery({
    queryKey: parentScopedKey,
    queryFn: () =>
      workItemsApi.get(currentParentId!) as Promise<WorkItemWithRelations>,
    enabled: queryEnabled,
  });

  const { data: children, isLoading: isLoadingChildren } = useQuery({
    queryKey: childrenScopedKey,
    queryFn: () => {
      const params = new URLSearchParams({ parentId: currentParentId! });
      return workItemsApi.list(params) as Promise<WorkItemWithRelations[]>;
    },
    enabled: queryEnabled,
  });

  const {
    data: childrenEvents,
    isLoading: isLoadingChildrenEvents,
  } = useChildrenEvents(currentParentId, {
    enabled: historyEnabled,
    limit: showAll ? 200 : 10,
  });

  const {
    data: ownEvents,
    isLoading: isLoadingOwnEvents,
  } = useWorkItemEvents(
    historyEnabled ? currentParentId : null,
    { limit: showAll ? 200 : 10 }
  );

  const executionOrigin = useWorkItemExecutionOrigin(queryEnabled ? currentParentId : null);

  const openPanel = useCallback((id: string) => {
    setNavigationOverrideId(null);
    setNavigationHistory([]);
    urlOpen(id);
    setActiveTab("details");
    setShowAll(false);
  }, [urlOpen]);

  const closePanel = useCallback(() => {
    setNavigationOverrideId(null);
    setNavigationHistory([]);
    urlOnOpenChange(false);
    setActiveTab("details");
    setShowAll(false);
  }, [urlOnOpenChange]);

  const navigateTo = useCallback((id: string) => {
    if (currentParentId) {
      setNavigationHistory((prev) => [...prev, currentParentId]);
    }
    setNavigationOverrideId(id);
    setActiveTab("details");
    setShowAll(false);
  }, [currentParentId]);

  const goBack = useCallback(() => {
    setNavigationHistory((prev) => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const previousId = newHistory.pop()!;
      setNavigationOverrideId(previousId);
      return newHistory;
    });
    setActiveTab("details");
    setShowAll(false);
  }, []);

  const toggleShowAll = useCallback(() => {
    setShowAll((prev) => !prev);
  }, []);

  const canGoBack = navigationHistory.length > 0;

  const moveChildMutation = useMutation({
    mutationFn: ({ childId, columnId }: { childId: string; columnId: string }) =>
      workItemsApi.move(childId, columnId, 0),
    onSuccess: () => {
      // Invalidate children list for the current parent
      if (currentParentId) {
        queryClient.invalidateQueries({
          queryKey: [...workItemKeys.all, "children", currentParentId],
        });
      }
      // Invalidate board queries so the kanban view refreshes
      queryClient.invalidateQueries({
        queryKey: [...workItemKeys.all, "board"],
      });
      // Also invalidate byArea queries
      queryClient.invalidateQueries({
        queryKey: workItemKeys.byAreaPrefix(),
      });
    },
  });

  const moveChild = useCallback(
    (childId: string, columnId: string) => {
      moveChildMutation.mutate({ childId, columnId });
    },
    [moveChildMutation]
  );

  return useMemo(
    () => ({
      isOpen,
      openPanel,
      closePanel,
      navigateTo,
      goBack,
      canGoBack,
      parentItem: parentItem ?? null,
      isLoadingParent,
      children: children ?? [],
      isLoadingChildren,
      activeTab,
      setActiveTab,
      childrenEvents: childrenEvents ?? [],
      isLoadingChildrenEvents,
      ownEvents: ownEvents ?? [],
      isLoadingOwnEvents,
      showAll,
      toggleShowAll,
      moveChild,
      executionOriginData: {
        lastOrigin: executionOrigin.lastOrigin,
        activeRun: executionOrigin.activeRun,
        sessionSummary: executionOrigin.sessionSummary,
        isLoading: executionOrigin.isLoading,
      },
    }),
    [
      isOpen,
      openPanel,
      closePanel,
      navigateTo,
      goBack,
      canGoBack,
      parentItem,
      isLoadingParent,
      children,
      isLoadingChildren,
      activeTab,
      setActiveTab,
      childrenEvents,
      isLoadingChildrenEvents,
      ownEvents,
      isLoadingOwnEvents,
      showAll,
      toggleShowAll,
      moveChild,
      executionOrigin,
    ]
  );
};
