"use client";

import { CheckSquare, Eye, EyeOff, Loader2, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { ListPageShell } from "@/domains/shared/presentation/components/list-page-shell";
import {
  SortDropdown,
  type SortOption,
} from "@/domains/shared/presentation/components/sort-dropdown";
import { useTodosPage } from "../../application/hooks/use-todos-page";
import { CreateTodoDialog } from "../components/create-todo-dialog";
import { TodoDetailPanel } from "../components/todo-detail-panel";
import { TodosFilterBar } from "../components/todos-filter-bar";
import { TodosList } from "../components/todos-list";
import { TodosPagination } from "../components/todos-pagination";

const TODO_SORT_OPTIONS: SortOption[] = [
  { label: "Priority", value: "priority" },
  { label: "Created", value: "createdAt" },
  { label: "Updated", value: "updatedAt" },
  { label: "Due date", value: "dueDate" },
];

export const TodosPageContainer: React.FC = () => {
  const page = useTodosPage();
  const t = useTranslations("todos");

  return (
    <>
      <ListPageShell
        header={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <CheckSquare className="h-6 w-6 text-slate-500" />
                To-Dos
              </h1>
              <p className="text-muted-foreground">{t("subtitle")}</p>
            </div>

            <Button onClick={() => page.setCreateDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("newTodo")}
            </Button>
          </div>
        }
        loading={
          !page.isPrefsLoaded ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : undefined
        }
        filters={
          <div className="space-y-3">
            <TodosFilterBar
              filters={page.filters}
              hasActiveFilters={page.hasActiveFilters}
              activeFilters={page.activeFilters}
              owners={page.ownerOptions}
              projects={page.projectOptions}
              onSearchChange={page.setSearch}
              onStatusChange={page.setStatus}
              onPriorityChange={page.setPriority}
              onOwnerChange={page.setOwnerUserId}
              onProjectChange={page.setProjectId}
              onDueDateChange={page.setDueDate}
              onClearFilters={page.clearFilters}
              onRemoveFilter={page.removeFilter}
            />
            <div className="flex items-center gap-2">
              <SortDropdown
                options={TODO_SORT_OPTIONS}
                sortBy={page.filters.sortBy ?? "createdAt"}
                sortDirection={page.filters.sortDirection ?? "desc"}
                onSortChange={page.setSort}
                defaultSortBy="createdAt"
                defaultSortDirection="desc"
                ariaLabel="Sort todos"
              />
            </div>
          </div>
        }
        footer={
          page.paginationMeta ? (
            <TodosPagination
              page={page.paginationMeta.page}
              totalPages={page.paginationMeta.totalPages}
              total={page.paginationMeta.total}
              limit={page.paginationMeta.limit}
              onPageChange={page.setPage}
            />
          ) : undefined
        }
      >
        <TodosList
          items={page.items}
          isLoading={page.isLoading}
          hasActiveFilters={page.hasActiveFilters}
          members={page.members}
          onToggleDone={page.handleToggleDone}
          onToggleBlocked={page.handleToggleBlocked}
          onOpenItem={page.openDetail}
          onDelete={page.handleDelete}
          onOwnerChange={page.handleOwnerChange}
          onPriorityChange={page.handlePriorityChange}
          onStatusChange={page.handleStatusChange}
        />

        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() =>
              page.setShowAllDone(page.filters.showAllDone ? undefined : true)
            }
          >
            {page.filters.showAllDone ? (
              <EyeOff className="mr-1.5 h-4 w-4" />
            ) : (
              <Eye className="mr-1.5 h-4 w-4" />
            )}
            {page.filters.showAllDone
              ? t("hideOldCompleted")
              : t("showAllCompleted")}
          </Button>
        </div>
      </ListPageShell>

      <CreateTodoDialog
        open={page.createDialogOpen}
        onOpenChange={page.setCreateDialogOpen}
        form={page.createForm.form}
        projects={page.projectOptions}
        owners={page.ownerOptions}
        isPending={page.createForm.isPending}
        onSubmit={page.createForm.onSubmit}
      />

      <TodoDetailPanel
        open={page.detailOpen}
        onOpenChange={page.setDetailOpen}
        item={page.detailPanel.item ?? null}
        history={page.detailPanel.history}
        isLoading={page.detailPanel.isLoading}
        isHistoryLoading={page.detailPanel.isHistoryLoading}
        projects={page.projectOptions}
        members={page.members}
        commentsProps={page.detailPanel.commentsProps}
        savingField={page.detailPanel.savingField}
        availableTags={page.tagOptions}
        onStatusChange={page.detailPanel.handleStatusChange}
        onPriorityChange={page.detailPanel.handlePriorityChange}
        onOwnerChange={page.detailPanel.handleOwnerChange}
        onDueDateChange={page.detailPanel.handleDueDateChange}
        onTitleChange={page.detailPanel.handleTitleChange}
        onDescriptionChange={page.detailPanel.handleDescriptionChange}
        onProjectChange={page.detailPanel.handleProjectChange}
        onAddTag={page.detailPanel.handleAddTag}
        onRemoveTag={page.detailPanel.handleRemoveTag}
      />

      <ConfirmDialog
        isOpen={page.confirmDialogProps.isOpen}
        options={page.confirmDialogProps.options}
        onConfirm={page.confirmDialogProps.handleConfirm}
        onCancel={page.confirmDialogProps.handleCancel}
      />
    </>
  );
};
