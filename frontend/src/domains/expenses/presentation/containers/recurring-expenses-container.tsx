"use client";

import { useRecurringExpenses, useExpenseCategories } from "../../application/hooks/use-expenses";
import { useRecurringExpensesPanel } from "../../application/hooks/use-recurring-expenses";
import { useCreateRecurringExpenseForm } from "../../application/hooks/use-create-recurring-expense-form";
import { RecurringExpenseList } from "../components/recurring-expense-list";
import { CreateRecurringExpenseDialog } from "../components/create-recurring-expense-dialog";
import { Button } from "@/components/ui/button";

export const RecurringExpensesContainer = () => {
  const { data: recurring = [], isLoading } = useRecurringExpenses();
  const { data: categories = [] } = useExpenseCategories();
  const {
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    toggleActive,
    handleDelete,
  } = useRecurringExpensesPanel();

  const { form, onSubmit, isPending } = useCreateRecurringExpenseForm(() => {
    setIsCreateDialogOpen(false);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recurring Expenses</h2>
        <Button onClick={() => setIsCreateDialogOpen(true)}>Add Subscription</Button>
      </div>
      <RecurringExpenseList
        items={recurring}
        isLoading={isLoading}
        onToggleActive={toggleActive}
        onDelete={handleDelete}
      />
      <CreateRecurringExpenseDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        form={form}
        onSubmit={onSubmit}
        isPending={isPending}
        categories={categories}
      />
    </div>
  );
};
