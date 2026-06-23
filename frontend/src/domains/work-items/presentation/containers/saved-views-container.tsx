"use client";

import { useState, useCallback, useEffect } from "react";
import { useSavedViews } from "../../application/hooks/use-saved-views";
import { SavedViewsDropdown } from "../components/saved-views-dropdown";
import type { SavedViewConfig, SavedView } from "../../domain/types";

interface SavedViewsContainerProps {
  boardId: string;
  currentConfig: SavedViewConfig;
  onApplyView: (config: SavedViewConfig) => void;
  onRegisterClearActiveView?: (clearFn: () => void) => void;
}

export const SavedViewsContainer: React.FC<SavedViewsContainerProps> = ({
  boardId,
  currentConfig,
  onApplyView,
  onRegisterClearActiveView,
}) => {
  const [newViewName, setNewViewName] = useState("");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);

  const {
    views,
    isLoading,
    activeViewId,
    activeViewName,
    saveView,
    updateView,
    deleteView,
    applyView,
    clearActiveView,
    isSaving,
  } =
    useSavedViews(boardId, currentConfig, onApplyView);

  useEffect(() => {
    onRegisterClearActiveView?.(clearActiveView);
  }, [onRegisterClearActiveView, clearActiveView]);

  const handleSave = useCallback(
    (name: string) => {
      saveView(name);
      setNewViewName("");
    },
    [saveView]
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteView(id);
      setDeletingViewId(null);
    },
    [deleteView]
  );

  const handleCancelDelete = useCallback(() => {
    setDeletingViewId(null);
  }, []);

  const handleRequestDelete = useCallback((id: string) => {
    setDeletingViewId(id);
  }, []);

  const handleApply = useCallback(
    (view: SavedView) => {
      applyView(view);
      setIsPopoverOpen(false);
    },
    [applyView]
  );

  const handlePopoverOpenChange = useCallback((open: boolean) => {
    setIsPopoverOpen(open);
    if (!open) {
      setDeletingViewId(null);
    }
  }, []);

  return (
    <SavedViewsDropdown
      views={views}
      isLoading={isLoading}
      activeViewId={activeViewId}
      activeViewName={activeViewName}
      onSave={handleSave}
      onUpdate={updateView}
      onDelete={handleDelete}
      onApply={handleApply}
      isSaving={isSaving}
      newViewName={newViewName}
      onNewViewNameChange={setNewViewName}
      isPopoverOpen={isPopoverOpen}
      onPopoverOpenChange={handlePopoverOpenChange}
      deletingViewId={deletingViewId}
      onRequestDelete={handleRequestDelete}
      onCancelDelete={handleCancelDelete}
    />
  );
};
