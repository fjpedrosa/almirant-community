"use client";

import { useState, useCallback } from "react";
import { useUpdateExpense, useDeleteExpense } from "./use-expenses";
import type { ExpenseWithRelations, ExpenseStatus } from "../../domain/types";

export const useExpenseDetailPanel = () => {
  const [selectedExpense, setSelectedExpense] = useState<ExpenseWithRelations | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const { mutate: updateExpense } = useUpdateExpense();
  const { mutate: deleteExpense } = useDeleteExpense();

  const openPanel = useCallback((item: ExpenseWithRelations) => {
    setSelectedExpense(item);
    setIsOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    setSelectedExpense(null);
  }, []);

  const handleStatusChange = useCallback(
    (status: ExpenseStatus) => {
      if (!selectedExpense) return;
      updateExpense({ id: selectedExpense.id, data: { status } });
    },
    [selectedExpense, updateExpense],
  );

  const handleDelete = useCallback(() => {
    if (!selectedExpense) return;
    deleteExpense(selectedExpense.id, { onSuccess: closePanel });
  }, [selectedExpense, deleteExpense, closePanel]);

  return {
    selectedExpense,
    isOpen,
    openPanel,
    closePanel,
    handleStatusChange,
    handleDelete,
  };
};
