"use client";

import { useState, useMemo, useCallback } from "react";
import { useSprintsByBoard, useActiveSprint } from "@/domains/sprints/application/hooks/use-sprints";
import { isSprintSelectionResolved } from "../../domain/sprint-gating";
import type { SprintWithCount } from "@/domains/sprints/domain/types";

export interface SprintFilterOption {
  id: string;
  name: string;
  status: string;
  isActive: boolean;
}

export const useSprintFilter = (boardId: string) => {
  const { data: sprints, isLoading: isLoadingSprints } = useSprintsByBoard(boardId);
  const { data: activeSprint, isLoading: isLoadingActiveSprint } =
    useActiveSprint(boardId);

  // Keep manual user selection separated from auto-selection.
  const [manualSelectedSprintId, setManualSelectedSprintId] = useState<string | null>(null);
  const [hasManualSelection, setHasManualSelection] = useState(false);

  const sprintOptions = useMemo((): SprintFilterOption[] => {
    if (!sprints || !Array.isArray(sprints)) return [];
    return (sprints as SprintWithCount[]).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      isActive: s.status === "open",
    }));
  }, [sprints]);

  const handleSetSprintId = useCallback((id: string | null) => {
    setHasManualSelection(true);
    setManualSelectedSprintId(id);
  }, []);

  // Auto-select active sprint unless the user manually selected a value.
  const resolvedSprintId = hasManualSelection
    ? manualSelectedSprintId
    : activeSprint?.id ?? null;

  // Once true, `selectedSprintId` reflects the auto-selected sprint, so the
  // board query can fire ONCE with the correct filter instead of firing empty
  // and refetching when the active sprint resolves.
  const isSprintResolved = isSprintSelectionResolved(
    hasManualSelection,
    isLoadingActiveSprint,
  );

  return {
    sprintOptions,
    selectedSprintId: resolvedSprintId,
    setSelectedSprintId: handleSetSprintId,
    isLoadingSprints,
    isSprintResolved,
    hasActiveSprint: !!activeSprint,
    activeSprintName: activeSprint?.name ?? null,
  };
};
