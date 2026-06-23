"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { useDetailPanelUrl } from "@/domains/shared/application/hooks/use-detail-panel-url";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { useAllBoards } from "@/domains/boards/application/hooks/use-boards";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useTags } from "@/domains/tags/application/hooks/use-tags";
import { useTeamMembersSelect } from "@/domains/teams/application/hooks/use-team-members-select";
import type {
  IdeaItemStatus,
  IdeaItemTag,
  IdeaItemWithRelations,
  PromoteIdeaItemFormData,
} from "../../domain/types";
import { useIdeaFilters } from "./use-idea-filters";
import { useIdeaShortcut } from "./use-idea-shortcut";
import { useAddIdeaTag, useRemoveIdeaTag } from "./use-idea-tags";
import {
  useAssignIdeaItemOwner,
  useDeleteIdeaItem,
  useIdeasWithPagination,
  useSetIdeaItemDueDate,
  useSetIdeaItemStatus,
  useToggleDiscussed,
} from "./use-ideas";
import { useIdeaDetailPanel } from "./use-idea-detail-panel";
import { usePromoteIdea } from "./use-promote-idea";
import { useQuickCaptureForm } from "./use-quick-capture-form";

export const useIdeasPage = () => {
  const tt = useTranslations("ideas.toasts");
  const td = useTranslations("ideas.delete");

  // === Auth & base data ===
  const { user } = useAuth();
  const { data: projects = [] } = useProjects();
  const { data: boards = [] } = useAllBoards();
  const { members } = useTeamMembersSelect();
  const { data: allTags = [] } = useTags();

  // === Filters ===
  const filtersState = useIdeaFilters();
  const searchParams = filtersState.buildSearchParams();
  const { data, isLoading } = useIdeasWithPagination(searchParams);

  // === Mutations ===
  const deleteIdeaItem = useDeleteIdeaItem();
  const setIdeaItemStatus = useSetIdeaItemStatus();
  const toggleDiscussed = useToggleDiscussed();
  const assignOwner = useAssignIdeaItemOwner();
  const setDueDateMutation = useSetIdeaItemDueDate();
  const promoteIdea = usePromoteIdea();
  const addIdeaTag = useAddIdeaTag();
  const removeIdeaTag = useRemoveIdeaTag();

  // === Confirm dialog ===
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  // === UI state ===
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [selectedPromoteItem, setSelectedPromoteItem] =
    useState<IdeaItemWithRelations | null>(null);

  const {
    selectedItemId,
    isOpen: detailOpen,
    open: openDetailById,
    onOpenChange: setDetailOpen,
  } = useDetailPanelUrl("id");

  // === Quick capture ===
  const defaultProjectId = filtersState.filters.projectId ?? projects[0]?.id ?? null;
  const quickCapture = useQuickCaptureForm(defaultProjectId, user?.id ?? null, () =>
    setQuickCaptureOpen(false),
  );
  useIdeaShortcut(() => setQuickCaptureOpen(true));

  // === Promote form ===
  const promoteForm = useForm<PromoteIdeaItemFormData>({
    defaultValues: {
      workItemType: "task",
      title: "",
      description: "",
      priority: "medium",
      projectId: defaultProjectId ?? "",
      boardId: "",
      boardColumnId: "",
      notes: "",
      parentId: undefined,
    },
  });

  const promoteBoardId = useWatch({
    control: promoteForm.control,
    name: "boardId",
  });

  // Boards are org-scoped, show all boards regardless of selected project
  const availableBoards = useMemo(() => boards, [boards]);

  const availableColumns = useMemo(() => {
    return boards.find((board) => board.id === promoteBoardId)?.columns ?? [];
  }, [boards, promoteBoardId]);

  useEffect(() => {
    const currentBoardId = promoteForm.getValues("boardId");
    const hasBoard = availableBoards.some((board) => board.id === currentBoardId);
    if (!hasBoard && availableBoards[0]?.id) {
      promoteForm.setValue("boardId", availableBoards[0].id);
    }
  }, [availableBoards, promoteForm]);

  useEffect(() => {
    const currentColumnId = promoteForm.getValues("boardColumnId");
    const hasColumn = availableColumns.some((column) => column.id === currentColumnId);
    if (!hasColumn && availableColumns[0]?.id) {
      promoteForm.setValue("boardColumnId", availableColumns[0].id);
    }
  }, [availableColumns, promoteForm]);

  // === Detail panel (delegated to useIdeaDetailPanel) ===
  const selectedItemFromList = useMemo(
    () => (data?.items ?? []).find((item) => item.id === selectedItemId) ?? null,
    [data?.items, selectedItemId],
  );

  const mentionMembers = useMemo(
    () =>
      members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        image: m.image ?? null,
      })),
    [members],
  );

  const detailPanel = useIdeaDetailPanel(
    selectedItemId,
    detailOpen,
    selectedItemFromList,
    mentionMembers,
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

  const boardOptions = useMemo(
    () => availableBoards.map((board) => ({ id: board.id, name: board.name })),
    [availableBoards],
  );

  const columnOptions = useMemo(
    () => availableColumns.map((column) => ({ id: column.id, name: column.name })),
    [availableColumns],
  );

  const tagOptions = useMemo<IdeaItemTag[]>(
    () => allTags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    [allTags],
  );

  // === Event handlers ===
  const openDetail = useCallback(
    (item: IdeaItemWithRelations) => {
      openDetailById(item.id);
    },
    [openDetailById],
  );

  const handleEdit = useCallback(
    (item: IdeaItemWithRelations) => {
      openDetail(item);
    },
    [openDetail],
  );

  const handlePromote = useCallback(
    (item: IdeaItemWithRelations) => {
      setSelectedPromoteItem(item);
      // Boards are org-scoped; pick the first available board
      const firstBoard = boards[0];
      const firstColumn = firstBoard?.columns[0];

      promoteForm.reset({
        workItemType: "task",
        title: item.title,
        description: item.description ?? "",
        priority: "medium",
        projectId: item.projectId ?? defaultProjectId ?? "",
        boardId: firstBoard?.id ?? "",
        boardColumnId: firstColumn?.id ?? "",
        notes: "",
        parentId: undefined,
      });
      setPromoteOpen(true);
    },
    [boards, defaultProjectId, promoteForm],
  );

  const handleTraceability = useCallback(
    (item: IdeaItemWithRelations) => {
      openDetail(item);
    },
    [openDetail],
  );

  const handleDelete = useCallback(
    async (item: IdeaItemWithRelations) => {
      const confirmed = await confirm({
        title: td("title"),
        description: td("description", { title: item.title }),
        confirmLabel: td("confirm"),
        variant: "destructive",
      });
      if (!confirmed) return;
      deleteIdeaItem.mutate(item.id, {
        onSuccess: () => showToast.success(tt("deleted")),
        onError: (error) =>
          showToast.error(error instanceof Error ? error.message : tt("deleteError")),
      });
    },
    [confirm, deleteIdeaItem, tt, td],
  );

  const handleStatusChange = useCallback(
    (item: IdeaItemWithRelations, status: IdeaItemStatus) => {
      setIdeaItemStatus.mutate(
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
    [setIdeaItemStatus, tt],
  );

  const handleDiscussedToggle = useCallback(
    (item: IdeaItemWithRelations) => {
      toggleDiscussed.mutate(
        { id: item.id, discussed: !item.discussed },
        {
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : tt("discussedError"),
            ),
        },
      );
    },
    [toggleDiscussed, tt],
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

  const handleAddTag = useCallback(
    (itemId: string, data: { tagId?: string; name?: string; color?: string }) => {
      addIdeaTag.mutate(
        { id: itemId, data },
        {
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : tt("addTagError"),
            ),
        },
      );
    },
    [addIdeaTag, tt],
  );

  const handleRemoveTag = useCallback(
    (itemId: string, tagId: string) => {
      removeIdeaTag.mutate(
        { id: itemId, tagId },
        {
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : tt("removeTagError"),
            ),
        },
      );
    },
    [removeIdeaTag, tt],
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

  const handlePromoteSubmit = useMemo(
    () =>
      promoteForm.handleSubmit((values) => {
        if (!selectedPromoteItem) return;
        if (!values.projectId || !values.boardId || !values.boardColumnId) {
          showToast.error(tt("promoteFieldsRequired"));
          return;
        }

        promoteIdea.mutate(
          {
            ideaItemId: selectedPromoteItem.id,
            data: {
              workItemType: values.workItemType,
              title: values.title,
              description: values.description || undefined,
              priority: values.priority,
              projectId: values.projectId,
              boardId: values.boardId,
              boardColumnId: values.boardColumnId,
              notes: values.notes || undefined,
              parentId: values.parentId || undefined,
              promotedBy: user?.id,
            },
          },
          {
            onSuccess: () => setPromoteOpen(false),
          },
        );
      }),
    [promoteForm, selectedPromoteItem, promoteIdea, user?.id, tt],
  );

  return {
    // Filters
    filters: filtersState.filters,
    tab: filtersState.tab,
    setTab: filtersState.setTab,
    isPrefsLoaded: filtersState.isPrefsLoaded,
    hasActiveFilters: filtersState.hasActiveFilters,
    activeFilters: filtersState.activeFilters,
    setSearch: filtersState.setSearch,
    setType: filtersState.setType,
    setStatus: filtersState.setStatus,
    setOwnerUserId: filtersState.setOwnerUserId,
    setProjectId: filtersState.setProjectId,
    setTagIds: filtersState.setTagIds,
    setDueDate: filtersState.setDueDate,
    setDiscussed: filtersState.setDiscussed,
    setMentionedUserId: filtersState.setMentionedUserId,
    setShowAllDone: filtersState.setShowAllDone,
    currentUserId: user?.id ?? null,
    setPage: filtersState.setPage,
    setSort: filtersState.setSort,
    clearFilters: filtersState.clearFilters,
    removeFilter: filtersState.removeFilter,

    // Data
    items: data?.items ?? [],
    isLoading,
    paginationMeta: data?.meta ?? null,

    // Quick capture
    quickCaptureOpen,
    setQuickCaptureOpen,
    quickCapture,

    // Promote
    promoteOpen,
    setPromoteOpen,
    promoteForm,
    selectedPromoteItem,
    promoteIdea,
    handlePromoteSubmit,

    // Detail (from useIdeaDetailPanel)
    detailOpen,
    setDetailOpen,
    detailPanel,

    // Options
    ownerOptions,
    projectOptions,
    boardOptions,
    columnOptions,
    tagOptions,

    // Members (for OwnerAvatarPicker)
    members,

    // Confirm dialog
    confirmDialogProps,

    // Handlers
    openDetail,
    handleEdit,
    handlePromote,
    handleTraceability,
    handleDelete,
    handleStatusChange,
    handleDiscussedToggle,
    handleOwnerChange,
    handleDueDateChange,
    handleAddTag,
    handleRemoveTag,
  };
};
