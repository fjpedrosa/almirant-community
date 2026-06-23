"use client";

import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { boardsApi } from "@/lib/api/client";
import { boardKeys } from "./use-boards";
import type { BoardColumn } from "../../domain/types";

export const useColumnManagement = (boardId: string, initialColumns: BoardColumn[]) => {
  const queryClient = useQueryClient();
  const [columns, setColumns] = useState<BoardColumn[]>(initialColumns);
  const [isLoading, setIsLoading] = useState(false);

  // `initialColumns` arrives async (board fetch). Keep local state in sync so
  // Settings can render/edit columns without requiring an explicit refresh.
  useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);

  const refreshColumns = useCallback(async () => {
    const updated = await boardsApi.listColumns(boardId) as BoardColumn[];
    setColumns(updated);
    queryClient.invalidateQueries({ queryKey: boardKeys.detail(boardId) });
    queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
  }, [boardId, queryClient]);

  const addColumn = useCallback(async (data: { name: string; color: string; isDone?: boolean }) => {
    setIsLoading(true);
    try {
      await boardsApi.createColumn(boardId, data);
      await refreshColumns();
      showToast.success("Columna creada");
    } catch {
      showToast.error("Error al crear columna");
    } finally {
      setIsLoading(false);
    }
  }, [boardId, refreshColumns]);

  const updateColumn = useCallback(async (colId: string, data: { name?: string; color?: string; isDone?: boolean }) => {
    setIsLoading(true);
    try {
      await boardsApi.updateColumn(boardId, colId, data);
      await refreshColumns();
      showToast.success("Columna actualizada");
    } catch {
      showToast.error("Error al actualizar columna");
    } finally {
      setIsLoading(false);
    }
  }, [boardId, refreshColumns]);

  const deleteColumn = useCallback(async (colId: string) => {
    setIsLoading(true);
    try {
      await boardsApi.deleteColumn(boardId, colId);
      await refreshColumns();
      showToast.success("Columna eliminada");
    } catch {
      showToast.error("Error al eliminar columna");
    } finally {
      setIsLoading(false);
    }
  }, [boardId, refreshColumns]);

  const reorderColumns = useCallback(async (columnIds: string[]) => {
    setIsLoading(true);
    try {
      const updated = await boardsApi.reorderColumns(boardId, columnIds) as BoardColumn[];
      setColumns(updated);
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(boardId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
    } catch {
      showToast.error("Error al reordenar columnas");
    } finally {
      setIsLoading(false);
    }
  }, [boardId, queryClient]);

  return {
    columns,
    isLoading,
    addColumn,
    updateColumn,
    deleteColumn,
    reorderColumns,
  };
};
