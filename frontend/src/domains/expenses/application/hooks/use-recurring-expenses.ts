"use client";

import { useState, useCallback } from "react";
import { useDeleteRecurringExpense, useUpdateRecurringExpense } from "./use-expenses";
import type { RecurringExpense } from "../../domain/types";

export const useRecurringExpensesPanel = () => {
  const [showInactive, setShowInactive] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { mutate: updateRecurring } = useUpdateRecurringExpense();
  const { mutate: deleteRecurring } = useDeleteRecurringExpense();

  const toggleActive = useCallback(
    (item: RecurringExpense) => {
      updateRecurring({ id: item.id, data: { isActive: !item.isActive } });
    },
    [updateRecurring],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteRecurring(id);
    },
    [deleteRecurring],
  );

  return {
    showInactive,
    setShowInactive,
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    toggleActive,
    handleDelete,
  };
};
