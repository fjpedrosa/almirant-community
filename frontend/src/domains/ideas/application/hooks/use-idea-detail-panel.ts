"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { uploadsApi } from "@/lib/api/client";
import type { MentionMember } from "@/domains/shared/domain/types";
import type {
  IdeaItemStatus,
  IdeaItemType,
  IdeaItemWithRelations,
  UpdateIdeaItemRequest,
} from "../../domain/types";
import { useIdeaItemComments } from "./use-idea-item-comments";
import { ideaMutationKeys } from "../../domain/query-keys";
import {
  useAssignIdeaItemOwner,
  useIdeaItem,
  useIdeaItemHistory,
  useIdeaItemTraceability,
  useSetIdeaItemDueDate,
  useSetIdeaItemStatus,
} from "./use-ideas";
import { useUpdateIdeaItem } from "./use-update-idea-item";

type EditableField = "status" | "owner" | "dueDate" | "project" | "title" | "description" | "type";

export const useIdeaDetailPanel = (
  itemId: string | null,
  isOpen: boolean,
  itemFromList: IdeaItemWithRelations | null,
  members: MentionMember[] = [],
) => {
  const t = useTranslations("ideas.toasts");
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [savingField, setSavingField] = useState<EditableField | null>(null);

  // === Queries ===
  const itemQuery = useIdeaItem(isOpen ? itemId : null);
  const item = itemQuery.data ?? itemFromList;

  const traceabilityQuery = useIdeaItemTraceability(isOpen ? itemId : null);
  const historyParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", "100");
    return params;
  }, []);
  const historyQuery = useIdeaItemHistory(isOpen ? itemId : null, historyParams);

  // === Comments ===
  const commentsHook = useIdeaItemComments(isOpen ? itemId : null);

  // === Mutations ===
  const setStatusMutation = useSetIdeaItemStatus();
  const assignOwnerMutation = useAssignIdeaItemOwner();
  const setDueDateMutation = useSetIdeaItemDueDate();
  const updateItemMutation = useUpdateIdeaItem();

  // === Field change handler ===
  const handleStatusChange = useCallback(
    (status: IdeaItemStatus) => {
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
      assignOwnerMutation.mutate(
        { id: itemId, ownerUserId: userId },
        {
          onSettled: () => setSavingField(null),
          onError: (error) =>
            showToast.error(error instanceof Error ? error.message : t("ownerError")),
        },
      );
    },
    [itemId, assignOwnerMutation, t],
  );

  const handleDueDateChange = useCallback(
    (dueDate: string | null) => {
      if (!itemId) return;
      setSavingField("dueDate");
      setDueDateMutation.mutate(
        { id: itemId, dueDate },
        {
          onSettled: () => setSavingField(null),
          onError: (error) =>
            showToast.error(error instanceof Error ? error.message : t("dueDateError")),
        },
      );
    },
    [itemId, setDueDateMutation, t],
  );

  const handleFieldUpdate = useCallback(
    (field: "title" | "description" | "project" | "type", value: string | null) => {
      if (!itemId) return;
      setSavingField(field);

      const data: UpdateIdeaItemRequest = {};
      if (field === "title") data.title = value ?? "";
      if (field === "description") data.description = value;
      if (field === "project") data.projectId = value;
      if (field === "type") data.type = value as IdeaItemType;

      updateItemMutation.mutate(
        { id: itemId, data },
        {
          onSuccess: () => {
            for (const queryKey of ideaMutationKeys(itemId)) {
              queryClient.invalidateQueries({ queryKey });
            }
          },
          onSettled: () => setSavingField(null),
        },
      );
    },
    [itemId, updateItemMutation, queryClient],
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
      type: IdeaItemType;
      status: IdeaItemStatus;
      projectId: string | null;
      ownerUserId: string | null;
      dueDate: string | null;
    }) => {
      if (!itemId) return;

      await updateItemMutation.mutateAsync({
        id: itemId,
        data: {
          title: values.title,
          description: values.description,
          type: values.type,
          status: values.status,
          projectId: values.projectId,
          ownerUserId: values.ownerUserId,
          dueDate: values.dueDate ?? null,
        },
      });
    },
    [itemId, updateItemMutation],
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
    handleDueDateChange,
    handleTitleChange,
    handleDescriptionChange,
    handleProjectChange,

    // Full save (edit mode)
    handleFullSave,
    isSaving: updateItemMutation.isPending,

    // Comments
    commentsProps,
    onAddComment: commentsHook.onAddComment,
    commentIsAdding: commentsHook.isAdding,
  };
};
