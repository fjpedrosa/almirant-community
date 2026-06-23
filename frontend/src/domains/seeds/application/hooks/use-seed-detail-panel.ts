"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { uploadsApi } from "@/lib/api/client";
import type { MentionMember } from "@/domains/shared/domain/types";
import type {
  SeedPriority,
  SeedStatus,
  SeedWithRelations,
  UpdateSeedRequest,
} from "@/domains/planning/domain/types";
import { seedKeys } from "@/domains/planning/domain/query-keys";
import { seedsApi } from "@/domains/planning/infrastructure/api/planning-api";
import {
  useSeed,
  useSetSeedStatus,
  useUpdateSeed,
} from "@/domains/planning/application/hooks/use-seeds-manager";
import { useSeedComments } from "./use-seed-comments";

type EditableField = "status" | "owner" | "priority" | "title" | "description" | "project";

export const useSeedDetailPanel = (
  itemId: string | null,
  isOpen: boolean,
  itemFromList: SeedWithRelations | null,
  members: MentionMember[] = [],
) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const t = useTranslations("seeds.toasts");

  const [savingField, setSavingField] = useState<EditableField | null>(null);

  // === Queries ===
  const itemQuery = useSeed(isOpen ? itemId : null);
  const item = itemQuery.data ?? itemFromList;

  const traceabilityQuery = useQuery({
    queryKey: seedKeys.traceability(itemId ?? ""),
    queryFn: () => seedsApi.getTraceability(itemId!),
    enabled: isOpen && !!itemId,
  });

  const historyParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", "100");
    return params;
  }, []);

  const historyQuery = useQuery({
    queryKey: seedKeys.history(itemId ?? ""),
    queryFn: async () => {
      const result = await seedsApi.getHistory(itemId!, historyParams);
      return result.data;
    },
    enabled: isOpen && !!itemId,
  });

  // === Comments ===
  const commentsHook = useSeedComments(isOpen ? itemId : null);

  // === Mutations ===
  const setStatusMutation = useSetSeedStatus();
  const updateSeedMutation = useUpdateSeed();

  const setOwnerMutation = useMutation({
    mutationFn: ({ id, ownerUserId }: { id: string; ownerUserId: string | null }) =>
      seedsApi.setOwner(id, ownerUserId),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: seedKeys.all });
      queryClient.invalidateQueries({ queryKey: seedKeys.detail(variables.id) });
    },
  });

  // === Field change handlers ===
  const handleStatusChange = useCallback(
    (status: SeedStatus) => {
      if (!itemId) return;
      setSavingField("status");
      setStatusMutation.mutate(
        { id: itemId, status },
        {
          onSettled: () => setSavingField(null),
          onError: (error) =>
            showToast.error(error instanceof Error ? error.message : t("statusError")),
        },
      );
    },
    [itemId, setStatusMutation, t],
  );

  const handleOwnerChange = useCallback(
    (userId: string) => {
      if (!itemId) return;
      setSavingField("owner");
      setOwnerMutation.mutate(
        { id: itemId, ownerUserId: userId },
        {
          onSettled: () => setSavingField(null),
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : t("ownerError"),
            ),
        },
      );
    },
    [itemId, setOwnerMutation, t],
  );

  const handlePriorityChange = useCallback(
    (priority: SeedPriority | null) => {
      if (!itemId) return;
      setSavingField("priority");
      updateSeedMutation.mutate(
        { id: itemId, data: { priority } },
        {
          onSettled: () => setSavingField(null),
          onError: (error) =>
            showToast.error(
              error instanceof Error ? error.message : t("priorityError"),
            ),
        },
      );
    },
    [itemId, updateSeedMutation, t],
  );

  const handleFieldUpdate = useCallback(
    (field: "title" | "description" | "project", value: string | null) => {
      if (!itemId) return;
      setSavingField(field);

      const data: UpdateSeedRequest = {};
      if (field === "title") data.title = value ?? "";
      if (field === "description") data.description = value;
      if (field === "project") data.projectId = value;

      updateSeedMutation.mutate(
        { id: itemId, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: seedKeys.all });
            queryClient.invalidateQueries({ queryKey: seedKeys.detail(itemId) });
          },
          onSettled: () => setSavingField(null),
        },
      );
    },
    [itemId, updateSeedMutation, queryClient],
  );

  const handleTitleChange = useCallback(
    (title: string) => handleFieldUpdate("title", title),
    [handleFieldUpdate],
  );

  const handleDescriptionChange = useCallback(
    (description: string | null) => handleFieldUpdate("description", description),
    [handleFieldUpdate],
  );

  const handleProjectChange = useCallback(
    (projectId: string | null) => handleFieldUpdate("project", projectId),
    [handleFieldUpdate],
  );

  // === Full save (legacy / edit mode) ===
  const handleFullSave = useCallback(
    async (values: {
      title: string;
      description: string | null;
      status: SeedStatus;
      priority: SeedPriority | null;
      projectId: string | null;
      ownerUserId: string | null;
    }) => {
      if (!itemId) return;

      await updateSeedMutation.mutateAsync({
        id: itemId,
        data: {
          title: values.title,
          description: values.description,
          status: values.status,
          priority: values.priority,
          projectId: values.projectId,
          ownerUserId: values.ownerUserId,
        },
      });
    },
    [itemId, updateSeedMutation],
  );

  // === Comments props ===
  const commentsProps = useMemo(
    () => ({
      comments: commentsHook.comments,
      isLoading: commentsHook.isLoading,
      currentUserId: user?.id ?? null,
      isAdding: commentsHook.isAdding,
      newCommentValue: commentsHook.newCommentValue,
      editingId: commentsHook.editingId,
      editContent: commentsHook.editContent,
      members,
      onAddComment: commentsHook.onAddComment,
      onAddCommentDirect: commentsHook.onAddCommentDirect,
      onDeleteComment: commentsHook.onDeleteComment,
      onNewCommentChange: commentsHook.onNewCommentChange,
      onStartEdit: commentsHook.onStartEdit,
      onCancelEdit: commentsHook.onCancelEdit,
      onSaveEdit: commentsHook.onSaveEdit,
      onEditContentChange: commentsHook.onEditContentChange,
      onImageUpload: uploadsApi.uploadImage,
      onFileUpload: uploadsApi.uploadFile,
    }),
    [commentsHook, user?.id, members],
  );

  return {
    item,
    isLoading: itemQuery.isLoading && !itemFromList,
    savingField,

    // Traceability & History
    traceability: traceabilityQuery.data ?? null,
    isTraceabilityLoading: traceabilityQuery.isLoading,
    history: historyQuery.data ?? [],
    isHistoryLoading: historyQuery.isLoading,

    // Inline field handlers
    handleStatusChange,
    handleOwnerChange,
    handlePriorityChange,
    handleTitleChange,
    handleDescriptionChange,
    handleProjectChange,

    // Full save (edit mode)
    handleFullSave,
    isSaving: updateSeedMutation.isPending,

    // Comments
    commentsProps,
    onAddComment: commentsHook.onAddComment,
    commentIsAdding: commentsHook.isAdding,
  };
};
