"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ListPageShell } from "@/domains/shared/presentation/components/list-page-shell";
import { useExpenseDashboard } from "../../application/hooks/use-expense-dashboard";
import { useExpenseFilters } from "../../application/hooks/use-expense-filters";
import {
  useExpenses,
  useDeleteExpense,
  useExpenseCategories,
} from "../../application/hooks/use-expenses";
import { useExpenseDetailPanel } from "../../application/hooks/use-expense-detail-panel";
import { useCreateExpenseForm } from "../../application/hooks/use-create-expense-form";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { ExpenseDashboardSummary } from "../components/expense-dashboard-summary";
import { ExpenseByPersonChart } from "../components/expense-by-person-chart";
import { ExpenseByCategoryChart } from "../components/expense-by-category-chart";
import { ExpenseTimelineChart } from "../components/expense-timeline-chart";
import { ExpenseList } from "../components/expense-list";
import { ExpenseFilterBar } from "../components/expense-filter-bar";
import { ExpensesPagination } from "../components/expenses-pagination";
import { ExpenseDetailPanel } from "../components/expense-detail-panel";
import { CreateExpenseDialog } from "../components/create-expense-dialog";
import { RecurringExpensesContainer } from "./recurring-expenses-container";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { shouldFetchExpenseList } from "../../domain/dashboard-tabs";
import type { ExpenseWithRelations } from "../../domain/types";

export const ExpenseDashboardContainer = () => {
  const t = useTranslations("expenses");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const dashboard = useExpenseDashboard();
  const {
    filters,
    hasActiveFilters,
    toSearchParams,
    onSearchChange,
    onStatusChange,
    onCurrencyChange,
    onPaidByChange,
    onCategoryChange,
    onDateFromChange,
    onDateToChange,
    clearFilters,
    updateFilter,
  } = useExpenseFilters();
  const { data: expensesData, isLoading: isExpensesLoading } = useExpenses(
    toSearchParams,
    { enabled: shouldFetchExpenseList(activeTab) },
  );
  const { data: categories = [] } = useExpenseCategories();
  const detailPanel = useExpenseDetailPanel();
  const { mutate: deleteExpense } = useDeleteExpense();
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  const { form, onSubmit, isPending: isCreating } = useCreateExpenseForm(() =>
    setIsCreateOpen(false)
  );

  const handleDelete = useCallback(
    async (item: ExpenseWithRelations) => {
      const confirmed = await confirm({
        title: t("deleteConfirm.title"),
        description: t("deleteConfirm.description", {
          description: item.description ?? item.title,
        }),
        confirmLabel: t("deleteConfirm.confirm"),
        cancelLabel: t("deleteConfirm.cancel"),
        variant: "destructive",
      });
      if (!confirmed) return;
      deleteExpense(item.id);
    },
    [confirm, deleteExpense, t]
  );

  const items = expensesData?.items ?? [];
  const totalPages = Math.ceil((expensesData?.meta.total ?? 0) / filters.limit);

  return (
    <>
      <ListPageShell
        header={
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">{t("dashboard.title")}</h1>
              <p className="text-muted-foreground text-sm">{t("dashboard.description")}</p>
            </div>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t("dashboard.newExpense")}
            </Button>
          </div>
        }
      >
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">{t("dashboard.tabs.overview")}</TabsTrigger>
            <TabsTrigger value="list">{t("dashboard.tabs.list")}</TabsTrigger>
            <TabsTrigger value="recurring">{t("dashboard.tabs.recurring")}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-4">
            <ExpenseDashboardSummary
              totalAmount={dashboard.totalAmount}
              monthlyRecurring={dashboard.recurringSummary?.totalMonthlyAmount ?? "0"}
              activeRecurringCount={dashboard.recurringSummary?.activeCount ?? 0}
              recentCount={dashboard.recentExpenses.length}
              isLoading={dashboard.isLoading}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card rounded-lg border p-4">
                <ExpenseByPersonChart
                  data={dashboard.personChartData}
                  isLoading={dashboard.isLoading}
                />
              </div>
              <div className="bg-card rounded-lg border p-4">
                <ExpenseByCategoryChart
                  data={dashboard.categoryChartData}
                  isLoading={dashboard.isLoading}
                />
              </div>
            </div>
            <div className="bg-card rounded-lg border p-4">
              <ExpenseTimelineChart
                data={dashboard.timelineChartData}
                isLoading={dashboard.isLoading}
              />
            </div>
          </TabsContent>

          <TabsContent value="list" className="space-y-4 mt-4">
            <ExpenseFilterBar
              filters={filters}
              hasActiveFilters={hasActiveFilters}
              onSearchChange={onSearchChange}
              onStatusChange={onStatusChange}
              onCurrencyChange={onCurrencyChange}
              onPaidByChange={onPaidByChange}
              onCategoryChange={onCategoryChange}
              onDateFromChange={onDateFromChange}
              onDateToChange={onDateToChange}
              onClearFilters={clearFilters}
            />
            <ExpenseList
              items={items}
              isLoading={isExpensesLoading}
              hasActiveFilters={hasActiveFilters}
              onOpenItem={detailPanel.openPanel}
              onDelete={handleDelete}
            />
            <ExpensesPagination
              page={filters.page}
              totalPages={totalPages}
              onPageChange={(page) => updateFilter("page", page)}
            />
          </TabsContent>

          <TabsContent value="recurring" className="mt-4">
            <RecurringExpensesContainer />
          </TabsContent>
        </Tabs>
      </ListPageShell>

      {/* Mount only while open: ExpenseDetailPanel internally calls
          useTeamMembersSelect() -> getFullOrganization, so keeping it mounted
          fires that org fetch even when no detail is open. */}
      {detailPanel.isOpen && (
        <ExpenseDetailPanel
          open
          onOpenChange={(open) => {
            if (!open) detailPanel.closePanel();
          }}
          item={detailPanel.selectedExpense}
          isLoading={false}
          onStatusChange={detailPanel.handleStatusChange}
          onDelete={detailPanel.handleDelete}
          onEdit={() => {}}
        />
      )}

      <CreateExpenseDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        categories={categories}
        isPending={isCreating}
        onSubmit={onSubmit}
        form={form}
      />

      <ConfirmDialog
        isOpen={confirmDialogProps.isOpen}
        options={confirmDialogProps.options}
        onConfirm={confirmDialogProps.handleConfirm}
        onCancel={confirmDialogProps.handleCancel}
      />
    </>
  );
};
