"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { uploadsApi } from "@/lib/api/client";
import type {
  TodoItemPriority,
  TodoItemStatus,
  TodoItemWithRelations,
  UpdateTodoItemRequest,
} from "../../domain/types";
import { useTodoComments } from "./use-todo-comments";
import { useAddTodoTag, useRemoveTodoTag } from "./use-todo-tags";
import {
  todoKeys,
  useAssignTodoOwner,
  useSetTodoDueDate,
  useSetTodoPriority,
  useSetTodoStatus,
  useTodoItem,
  useTodoItemHistory,
  useUpdateTodo,
} from "./use-todos";

type EditableField = "status" | "priority" | "owner" | "dueDate" | "project" | "title" | "description";

export const useTodoDetailPanel = (
  itemId: string | null,
  isOpen: boolean,
  itemFromList: TodoItemWithRelations | null,
) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [savingField, setSavingField] = useState<EditableField | null>(null);

  // === Queries ===
  const itemQuery = useTodoItem(isOpen ? itemId : null);
  const item = itemQuery.data ?? itemFromList;

  const historyParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("limit", "100");
    return params;
  }, []);
  const historyQuery = useTodoItemHistory(isOpen ? itemId : null, historyParams);

  // === Comments ===
  const commentsHook = useTodoComments(isOpen ? itemId : null);

  // === Mutations ===
  const setStatusMutation = useSetTodoStatus();
  const setPriorityMutation = useSetTodoPriority();
  const assignOwnerMutation = useAssignTodoOwner();
  const setDueDateMutation = useSetTodoDueDate();
  const updateItemMutation = useUpdateTodo();
  const addTagMutation = useAddTodoTag();
  const removeTagMutation = useRemoveTodoTag();

  // === Field change handlers ===
  const handleStatusChange = useCallback(
    (status: TodoItemStatus) => {
      if (!itemId) return;
      setSavingField("status");
      setStatusMutation.mutate(
        { id: itemId, status },
        {
          onSettled: () => setSavingField(null),
          onError: (error) =>
            showToast.error(error instanceof Error ? error.message : "Error al cambiar estado"),
        },
      );
    },
    [itemId, setStatusMutation],
  );

  const handlePriorityChange = useCallback(
    (priority: TodoItemPriority) => {
      if (!itemId) return;
      setSavingField("priority");
      setPriorityMutation.mutate(
        { id: itemId, priority },
        {
          onSettled: () => setSavingField(null),
          onError: (error) =>
            showToast.error(error instanceof Error ? error.message : "Error al cambiar prioridad"),
        },
      );
    },
    [itemId, setPriorityMutation],
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
            showToast.error(error instanceof Error ? error.message : "Error al asignar responsable"),
        },
      );
    },
    [itemId, assignOwnerMutation],
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
            showToast.error(error instanceof Error ? error.message : "Error al cambiar fecha"),
        },
      );
    },
    [itemId, setDueDateMutation],
  );

  const handleFieldUpdate = useCallback(
    (field: "title" | "description" | "project", value: string | null) => {
      if (!itemId) return;
      setSavingField(field);

      const data: UpdateTodoItemRequest = {};
      if (field === "title") data.title = value ?? "";
      if (field === "description") data.description = value;
      if (field === "project") data.projectId = value;

      updateItemMutation.mutate(
        { id: itemId, data },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: todoKeys.all });
            queryClient.invalidateQueries({ queryKey: todoKeys.detail(itemId) });
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

  const handleAddTag = useCallback(
    (data: { tagId?: string; name?: string; color?: string }) => {
      if (!itemId) return;
      addTagMutation.mutate(
        { id: itemId, data },
        {
          onError: (error) =>
            showToast.error(error instanceof Error ? error.message : "Error al agregar tag"),
        },
      );
    },
    [itemId, addTagMutation],
  );

  const handleRemoveTag = useCallback(
    (tagId: string) => {
      if (!itemId) return;
      removeTagMutation.mutate(
        { id: itemId, tagId },
        {
          onError: (error) =>
            showToast.error(error instanceof Error ? error.message : "Error al quitar tag"),
        },
      );
    },
    [itemId, removeTagMutation],
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
    [commentsHook, user?.id],
  );

  return {
    item,
    isLoading: itemQuery.isLoading && !itemFromList,
    savingField,

    // History
    history: historyQuery.data ?? [],
    isHistoryLoading: historyQuery.isLoading,

    // Inline field handlers
    handleStatusChange,
    handlePriorityChange,
    handleOwnerChange,
    handleDueDateChange,
    handleTitleChange,
    handleDescriptionChange,
    handleProjectChange,
    handleAddTag,
    handleRemoveTag,

    // Full save
    isSaving: updateItemMutation.isPending,

    // Comments
    commentsProps,
    onAddComment: commentsHook.onAddComment,
    commentIsAdding: commentsHook.isAdding,
  };
};
