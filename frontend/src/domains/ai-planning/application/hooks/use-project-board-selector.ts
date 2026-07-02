"use client";

import { useState, useCallback, useMemo } from "react";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useAllBoards } from "@/domains/boards/application/hooks/use-boards";
import type { PlanSelectorProject, PlanSelectorBoard } from "../../domain/types";

// Hook that manages inline project/board selection state for the planning page header.
// Unlike usePlanSelector, this hook does NOT navigate — it only maintains local state.
// Auto-selection is implemented via derived state (useMemo) instead of effects to avoid
// cascading renders flagged by the React Compiler lint rules.
//
// Usage:
//   const selector = useProjectBoardSelector();
//   <InlineProjectSelector {...selector} />

export const useProjectBoardSelector = () => {
  const { data: rawProjects, isLoading: isLoadingProjects } = useProjects();
  const { data: rawBoards, isLoading: isLoadingBoards } = useAllBoards();

  const [userSelectedProjectId, setUserSelectedProjectId] = useState<string>("");
  const [userSelectedBoardId, setUserSelectedBoardId] = useState<string>("");

  // Map raw data to lightweight selector shapes.
  const projects: PlanSelectorProject[] = useMemo(
    () => (rawProjects ?? []).map((p) => ({ id: p.id, name: p.name })),
    [rawProjects],
  );

  // Boards are workspace-level (not project-scoped), so we expose all of them.
  // This matches the data model where boards belong to the workspace, not to
  // individual projects.
  const boards: PlanSelectorBoard[] = useMemo(
    () =>
      (rawBoards ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        totalItems: b.totalItems,
      })),
    [rawBoards],
  );

  // ── Auto-select via derived state ──────────────────────────────────
  // If the user hasn't picked a project yet and there is exactly one, derive it.
  const selectedProjectId = useMemo(() => {
    if (userSelectedProjectId !== "") return userSelectedProjectId;
    if (projects.length === 1) return projects[0].id;
    return "";
  }, [userSelectedProjectId, projects]);

  // If the user hasn't picked a board yet and there is exactly one, derive it.
  // Board auto-select only kicks in when a project is already resolved.
  const selectedBoardId = useMemo(() => {
    if (selectedProjectId === "") return "";
    if (userSelectedBoardId !== "") return userSelectedBoardId;
    if (boards.length === 1) return boards[0].id;
    return "";
  }, [selectedProjectId, userSelectedBoardId, boards]);

  // ── Handlers ───────────────────────────────────────────────────────
  const handleProjectChange = useCallback((projectId: string) => {
    setUserSelectedProjectId(projectId);
    setUserSelectedBoardId("");
  }, []);

  const handleBoardChange = useCallback((boardId: string) => {
    setUserSelectedBoardId(boardId);
  }, []);

  const isReady = selectedProjectId !== "" && selectedBoardId !== "";

  return {
    projects,
    boards,
    selectedProjectId,
    selectedBoardId,
    isLoadingProjects,
    isLoadingBoards,
    isReady,
    onProjectChange: handleProjectChange,
    onBoardChange: handleBoardChange,
  };
};
