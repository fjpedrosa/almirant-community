"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { useDetailPanelUrl } from "@/domains/shared/application/hooks/use-detail-panel-url";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { useAllBoards } from "@/domains/boards/application/hooks/use-boards";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useTags } from "@/domains/tags/application/hooks/use-tags";
import { useTeamMembersSelect } from "@/domains/teams/application/hooks/use-team-members-select";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";
import { seedMutationKeys } from "@/domains/planning/domain/query-keys";
import { seedsApi } from "@/domains/planning/infrastructure/api/planning-api";
import {
  useDeleteSeed,
  useSeedsWithPagination,
  useSetSeedStatus,
} from "@/domains/planning/application/hooks/use-seeds-manager";
import type {
  PromoteSeedRequest,
  SeedStatus,
  SeedTag,
  SeedWithRelations,
} from "@/domains/planning/domain/types";
import type { FilterOption } from "@/domains/shared/domain/filter-types";
import type { PromoteSeedFormData } from "../../domain/types";
import { useSeedFilters } from "./use-seed-filters";
import { useSeedDetailPanel } from "./use-seed-detail-panel";
import { useSeedApprovalCountdown } from "./use-seed-approval-countdown";

export const useSeedsPage = () => {
  const t = useTranslations("seeds.toasts");
  const td = useTranslations("seeds.delete");

  // === Auth & base data ===
  const { user } = useAuth();
  const { data: projects = [] } = useProjects();
  const { data: boards = [] } = useAllBoards();
  const { members } = useTeamMembersSelect();
  const { data: allTags = [] } = useTags();
  const queryClient = useQueryClient();

  // === Filter options (for DynamicFilters config) ===
  const ownerFilterOptions = useMemo<FilterOption[]>(
    () => members.map((m) => ({ value: m.id, label: m.name || m.email })),
    [members],
  );

  const projectFilterOptions = useMemo<FilterOption[]>(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  );

  const tagFilterOptions = useMemo<FilterOption[]>(
    () => allTags.map((tag) => ({ value: tag.id, label: tag.name })),
    [allTags],
  );

  // === Filters (dynamic filters + search + tab + pagination) ===
  const filtersState = useSeedFilters(
    ownerFilterOptions,
    projectFilterOptions,
    tagFilterOptions,
  );
  const searchParams = filtersState.buildSearchParams();
  const { data, isLoading } = useSeedsWithPagination(searchParams);

  // === Approval countdown ===
  const { handleStatusChangeWithCountdown, getVisibleItems } =
    useSeedApprovalCountdown(filtersState.activeTab);

  // === Mutations ===
  const deleteSeed = useDeleteSeed();
  const setSeedStatus = useSetSeedStatus();

  const setOwnerMutation = useMutation({
    mutationFn: ({
      id,
      ownerUserId,
    }: {
      id: string;
      ownerUserId: string | null;
    }) => seedsApi.setOwner(id, ownerUserId),
    onSuccess: (_result, variables) => {
      for (const queryKey of seedMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const promoteMutation = useMutation({
    mutationFn: ({
      seedId,
      data: promoteData,
    }: {
      seedId: string;
      data: PromoteSeedRequest;
    }) => seedsApi.promote(seedId, promoteData),
    onSuccess: (_result, variables) => {
      for (const queryKey of seedMutationKeys(variables.seedId)) {
        queryClient.invalidateQueries({ queryKey });
      }
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      showToast.success(t("seedPromoted"));
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t("promoteError"));
    },
  });

  const addTagMutation = useMutation({
    mutationFn: ({
      id,
      data: tagData,
    }: {
      id: string;
      data: { tagId?: string; name?: string; color?: string };
    }) => seedsApi.addTag(id, tagData),
    onSuccess: (_result, variables) => {
      for (const queryKey of seedMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const removeTagMutation = useMutation({
    mutationFn: ({ id, tagId }: { id: string; tagId: string }) =>
      seedsApi.removeTag(id, tagId),
    onSuccess: (_result, variables) => {
      for (const queryKey of seedMutationKeys(variables.id)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  // === Confirm dialog ===
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  // === UI state ===
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [selectedPromoteItem, setSelectedPromoteItem] =
    useState<SeedWithRelations | null>(null);

  const {
    selectedItemId,
    isOpen: detailOpen,
    open: openDetailById,
    onOpenChange: setDetailOpen,
  } = useDetailPanelUrl("id");

  // === Promote form ===
  const defaultProjectId =
    filtersState.dynamicFilters.getFilterParams().projectId ??
    projects[0]?.id ??
    null;

  const promoteForm = useForm<PromoteSeedFormData>({
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

  const availableBoards = useMemo(() => boards, [boards]);

  const availableColumns = useMemo(() => {
    return boards.find((board) => board.id === promoteBoardId)?.columns ?? [];
  }, [boards, promoteBoardId]);

  useEffect(() => {
    const currentBoardId = promoteForm.getValues("boardId");
    const hasBoard = availableBoards.some(
      (board) => board.id === currentBoardId,
    );
    if (!hasBoard && availableBoards[0]?.id) {
      promoteForm.setValue("boardId", availableBoards[0].id);
    }
  }, [availableBoards, promoteForm]);

  useEffect(() => {
    const currentColumnId = promoteForm.getValues("boardColumnId");
    const hasColumn = availableColumns.some(
      (column) => column.id === currentColumnId,
    );
    if (!hasColumn && availableColumns[0]?.id) {
      promoteForm.setValue("boardColumnId", availableColumns[0].id);
    }
  }, [availableColumns, promoteForm]);

  // === Detail panel ===
  const visibleItems = useMemo(
    () => getVisibleItems(data?.items ?? []),
    [getVisibleItems, data?.items],
  );

  const selectedItemFromList = useMemo(
    () => visibleItems.find((item) => item.id === selectedItemId) ?? null,
    [visibleItems, selectedItemId],
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

  const detailPanel = useSeedDetailPanel(
    selectedItemId,
    detailOpen,
    selectedItemFromList,
    mentionMembers,
  );

  // === Memoized options (for dialogs, detail panel) ===
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
    () =>
      availableColumns.map((column) => ({
        id: column.id,
        name: column.name,
      })),
    [availableColumns],
  );

  const tagOptions = useMemo<SeedTag[]>(
    () =>
      allTags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })),
    [allTags],
  );

  // === Event handlers ===
  const openDetail = useCallback(
    (item: SeedWithRelations) => {
      openDetailById(item.id);
    },
    [openDetailById],
  );

  const handlePromote = useCallback(
    (item: SeedWithRelations) => {
      setSelectedPromoteItem(item);
      const firstBoard = boards[0];
      const firstColumn = firstBoard?.columns[0];

      promoteForm.reset({
        workItemType: "task",
        title: item.title,
        description: item.description ?? "",
        priority: item.priority ?? "medium",
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

  const handleDelete = useCallback(
    async (item: SeedWithRelations) => {
      const confirmed = await confirm({
        title: td("title"),
        description: td("description", { title: item.title }),
        confirmLabel: td("confirm"),
        variant: "destructive",
      });
      if (!confirmed) return;
      deleteSeed.mutate(item.id, {
        onSuccess: () => showToast.success(t("seedDeleted")),
        onError: (error) =>
          showToast.error(
            error instanceof Error ? error.message : t("deleteError"),
          ),
      });
    },
    [confirm, deleteSeed, t, td],
  );

  const defaultStatusChange = useCallback(
    (item: SeedWithRelations, status: SeedStatus) => {
      setSeedStatus.mutate(
        { id: item.id, status },
        {
          onSuccess: () => showToast.success(t("statusUpdated")),
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : t("statusError"),
            ),
        },
      );
    },
    [setSeedStatus, t],
  );

  const handleStatusChange = useCallback(
    (item: SeedWithRelations, status: SeedStatus) => {
      handleStatusChangeWithCountdown(item, status, defaultStatusChange);
    },
    [handleStatusChangeWithCountdown, defaultStatusChange],
  );

  const handleOwnerChange = useCallback(
    (itemId: string, userId: string) => {
      setOwnerMutation.mutate(
        { id: itemId, ownerUserId: userId },
        {
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : t("ownerError"),
            ),
        },
      );
    },
    [setOwnerMutation, t],
  );

  const handleAddTag = useCallback(
    (
      itemId: string,
      tagData: { tagId?: string; name?: string; color?: string },
    ) => {
      addTagMutation.mutate(
        { id: itemId, data: tagData },
        {
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : t("tagAddError"),
            ),
        },
      );
    },
    [addTagMutation, t],
  );

  const handleRemoveTag = useCallback(
    (itemId: string, tagId: string) => {
      removeTagMutation.mutate(
        { id: itemId, tagId },
        {
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : t("tagRemoveError"),
            ),
        },
      );
    },
    [removeTagMutation, t],
  );

  const handlePromoteSubmit = useMemo(
    () =>
      promoteForm.handleSubmit((values) => {
        if (!selectedPromoteItem) return;
        if (!values.projectId || !values.boardId || !values.boardColumnId) {
          showToast.error(t("requiredFields"));
          return;
        }

        promoteMutation.mutate(
          {
            seedId: selectedPromoteItem.id,
            data: {
              workItemType: values.workItemType,
              title: values.title,
              description: values.description || undefined,
              priority: values.priority as PromoteSeedRequest["priority"],
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
    [promoteForm, selectedPromoteItem, promoteMutation, user?.id, t],
  );

  return {
    // Filters (new dynamic filters API)
    filtersState,

    // Data
    items: visibleItems,
    isLoading,
    paginationMeta: data?.meta ?? null,
    currentUserId: user?.id ?? null,

    // Create dialog
    createDialogOpen,
    setCreateDialogOpen,

    // Promote
    promoteOpen,
    setPromoteOpen,
    promoteForm,
    selectedPromoteItem,
    promoteMutation,
    handlePromoteSubmit,

    // Detail
    detailOpen,
    setDetailOpen,
    detailPanel,

    // Options (for dialogs and detail panel)
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
    handlePromote,
    handleDelete,
    handleStatusChange,
    handleOwnerChange,
    handleAddTag,
    handleRemoveTag,
  };
};
