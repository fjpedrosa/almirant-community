"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { savedViewsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { SavedView, SavedViewConfig } from "../../domain/types";

export const savedViewKeys = {
  all: ["saved-views"] as const,
  byBoard: (boardId: string) => [...savedViewKeys.all, "board", boardId] as const,
};

export const useSavedViews = (
  boardId: string,
  currentConfig: SavedViewConfig,
  onApplyView: (config: SavedViewConfig) => void,
) => {
  const queryClient = useQueryClient();
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const scopedKey = useOrgScopedKey(savedViewKeys.byBoard(boardId));

  const { data: views = [], isLoading } = useQuery({
    queryKey: scopedKey,
    queryFn: () => savedViewsApi.list(boardId) as Promise<SavedView[]>,
    enabled: !!boardId,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      savedViewsApi.create(boardId, { name, config: currentConfig }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: savedViewKeys.byBoard(boardId) });
    },
    onError: () => {
      showToast.error("Failed to save view");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      savedViewsApi.update(boardId, id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: savedViewKeys.byBoard(boardId) });
    },
    onError: () => {
      showToast.error("Failed to update view");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => savedViewsApi.delete(boardId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: savedViewKeys.byBoard(boardId) });
    },
    onError: () => {
      showToast.error("Failed to delete view");
    },
  });

  const saveView = (name: string) => {
    createMutation.mutate(name);
  };

  const updateView = (id: string, name: string) => {
    updateMutation.mutate({ id, name });
  };

  const deleteView = (id: string) => {
    if (id === activeViewId) {
      setActiveViewId(null);
    }
    deleteMutation.mutate(id);
  };

  const activeViewName = useMemo(
    () => views.find((view) => view.id === activeViewId)?.name ?? null,
    [views, activeViewId]
  );

  const applyView = (view: SavedView) => {
    setActiveViewId(view.id);
    onApplyView(view.config);
  };

  const clearActiveView = () => {
    setActiveViewId(null);
  };

  return {
    views,
    isLoading,
    activeViewId,
    activeViewName,
    saveView,
    updateView,
    deleteView,
    applyView,
    clearActiveView,
    isSaving: createMutation.isPending,
  };
};
