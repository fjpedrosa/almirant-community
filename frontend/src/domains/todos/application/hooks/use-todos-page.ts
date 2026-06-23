"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useDetailPanelUrl } from "@/domains/shared/application/hooks/use-detail-panel-url";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useTags } from "@/domains/tags/application/hooks/use-tags";
import { useTeamMembersSelect } from "@/domains/teams/application/hooks/use-team-members-select";
import type {
  TodoItemPriority,
  TodoItemStatus,
  TodoItemTag,
  TodoItemWithRelations,
} from "../../domain/types";
import { useTodoFilters } from "./use-todo-filters";
import {
  useAssignTodoOwner,
  useDeleteTodo,
  useSetTodoDueDate,
  useSetTodoPriority,
  useSetTodoStatus,
  useTodosWithPagination,
} from "./use-todos";
import { useTodoDetailPanel } from "./use-todo-detail-panel";
import { useCreateTodoForm } from "./use-create-todo-form";

export const useTodosPage = () => {
  const tt = useTranslations("todos.toasts");
  const td = useTranslations("todos.delete");

  const {
    selectedItemId,
    isOpen: detailOpen,
    open: openDetailById,
    onOpenChange: handleDetailOpenChange,
  } = useDetailPanelUrl("todoId");

  // === Base data ===
  const { data: projects = [] } = useProjects();
  const { members } = useTeamMembersSelect();
  const { data: allTags = [] } = useTags();

  // === Filters ===
  const filtersState = useTodoFilters();
  const listSearchParams = filtersState.buildSearchParams();
  const { data, isLoading } = useTodosWithPagination(listSearchParams);

  // === Mutations ===
  const deleteTodo = useDeleteTodo();
  const setTodoStatus = useSetTodoStatus();
  const assignOwner = useAssignTodoOwner();
  const setDueDateMutation = useSetTodoDueDate();
  const setPriorityMutation = useSetTodoPriority();

  // === Confirm dialog ===
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  // === UI state ===
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // === Create form ===
  const defaultProjectId = filtersState.filters.projectId ?? projects[0]?.id ?? null;
  const createForm = useCreateTodoForm(defaultProjectId, () =>
    setCreateDialogOpen(false),
  );

  // === Detail panel ===
  const selectedItemFromList = useMemo(
    () => (data?.items ?? []).find((item) => item.id === selectedItemId) ?? null,
    [data?.items, selectedItemId],
  );

  const detailPanel = useTodoDetailPanel(
    selectedItemId,
    detailOpen,
    selectedItemFromList,
  );

  // === Memoized options ===
  const ownerOptions = useMemo(
    () =>
      members.map((member) => ({
        id: member.id,
        name: member.name || member.email,
        email: member.email,
        image: member.image,
      })),
    [members],
  );

  const projectOptions = useMemo(
    () => projects.map((project) => ({ id: project.id, name: project.name })),
    [projects],
  );

  const tagOptions = useMemo<TodoItemTag[]>(
    () => allTags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    [allTags],
  );

  // === Event handlers ===
  const openDetail = useCallback(
    (item: TodoItemWithRelations) => {
      openDetailById(item.id);
    },
    [openDetailById],
  );

  const handleDelete = useCallback(
    async (item: TodoItemWithRelations) => {
      const confirmed = await confirm({
        title: td("title"),
        description: td("description", { title: item.title }),
        confirmLabel: td("confirm"),
        variant: "destructive",
      });
      if (!confirmed) return;
      deleteTodo.mutate(item.id, {
        onSuccess: () => showToast.success(tt("deleted")),
        onError: (error) =>
          showToast.error(error instanceof Error ? error.message : tt("deleteError")),
      });
    },
    [confirm, deleteTodo, tt, td],
  );

  const handleStatusChange = useCallback(
    (item: TodoItemWithRelations, status: TodoItemStatus) => {
      setTodoStatus.mutate(
        { id: item.id, status },
        {
          onSuccess: () => showToast.success(tt("statusUpdated")),
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : tt("statusError"),
            ),
        },
      );
    },
    [setTodoStatus, tt],
  );

  const handleToggleDone = useCallback(
    (item: TodoItemWithRelations) => {
      const newStatus: TodoItemStatus = item.status === "done" ? "pending" : "done";
      handleStatusChange(item, newStatus);
    },
    [handleStatusChange],
  );

  const handleToggleBlocked = useCallback(
    (item: TodoItemWithRelations) => {
      const newStatus: TodoItemStatus = item.status === "blocked" ? "pending" : "blocked";
      handleStatusChange(item, newStatus);
    },
    [handleStatusChange],
  );

  const handleOwnerChange = useCallback(
    (itemId: string, userId: string) => {
      assignOwner.mutate(
        { id: itemId, ownerUserId: userId },
        {
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : tt("ownerError"),
            ),
        },
      );
    },
    [assignOwner, tt],
  );

  const handleDueDateChange = useCallback(
    (itemId: string, dueDate: string | null) => {
      setDueDateMutation.mutate(
        { id: itemId, dueDate },
        {
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : tt("dueDateError"),
            ),
        },
      );
    },
    [setDueDateMutation, tt],
  );

  const handlePriorityChange = useCallback(
    (item: TodoItemWithRelations, priority: TodoItemPriority) => {
      setPriorityMutation.mutate(
        { id: item.id, priority },
        {
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : tt("priorityError"),
            ),
        },
      );
    },
    [setPriorityMutation, tt],
  );

  return {
    // Filters
    filters: filtersState.filters,
    isPrefsLoaded: filtersState.isPrefsLoaded,
    hasActiveFilters: filtersState.hasActiveFilters,
    activeFilters: filtersState.activeFilters,
    setSearch: filtersState.setSearch,
    setStatus: filtersState.setStatus,
    setPriority: filtersState.setPriority,
    setOwnerUserId: filtersState.setOwnerUserId,
    setProjectId: filtersState.setProjectId,
    setDueDate: filtersState.setDueDate,
    setShowAllDone: filtersState.setShowAllDone,
    setPage: filtersState.setPage,
    setSort: filtersState.setSort,
    clearFilters: filtersState.clearFilters,
    removeFilter: filtersState.removeFilter,

    // Data
    items: data?.items ?? [],
    isLoading,
    paginationMeta: data?.meta ?? null,

    // Create dialog
    createDialogOpen,
    setCreateDialogOpen,
    createForm,

    // Detail panel
    detailOpen,
    setDetailOpen: handleDetailOpenChange,
    detailPanel,

    // Options
    ownerOptions,
    projectOptions,
    tagOptions,

    // Members (for OwnerAvatarPicker)
    members,

    // Confirm dialog
    confirmDialogProps,

    // Handlers
    openDetail,
    handleDelete,
    handleStatusChange,
    handleToggleDone,
    handleToggleBlocked,
    handleOwnerChange,
    handleDueDateChange,
    handlePriorityChange,
  };
};
