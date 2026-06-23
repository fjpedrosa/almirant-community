"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { todosApi } from "@/lib/api/client";
import { hasVisibleContent } from "@/lib/comment-utils";
import type { TodoItemComment } from "../../domain/types";
import { todoKeys } from "./use-todos";

const commentKeys = {
  all: (todoItemId: string) => ["todos", todoItemId, "comments"] as const,
};

type TodoCommentApiResponse = {
  id: string;
  entityId?: string;
  todoItemId?: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  author?: {
    id?: string;
    name?: string;
    email?: string;
    image?: string | null;
  } | null;
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
};

const normalizeTodoComment = (comment: TodoCommentApiResponse): TodoItemComment => {
  const authorId = comment.author?.id ?? comment.userId;
  const authorName = comment.author?.name ?? comment.userName ?? "Usuario";
  const authorEmail = comment.author?.email ?? comment.userEmail ?? "";
  const authorImage = comment.author?.image ?? comment.userImage ?? null;

  return {
    id: comment.id,
    entityId: comment.entityId ?? comment.todoItemId ?? "",
    userId: comment.userId,
    content: comment.content,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: {
      id: authorId,
      name: authorName,
      email: authorEmail,
      image: authorImage,
    },
  };
};

export const useTodoComments = (todoItemId: string | null) => {
  const queryClient = useQueryClient();

  // UI state
  const [newCommentValue, setNewCommentValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const commentsQuery = useQuery({
    queryKey: commentKeys.all(todoItemId ?? ""),
    queryFn: async () => {
      const comments = await (todosApi.listComments(todoItemId!) as Promise<TodoCommentApiResponse[]>);
      return comments.map(normalizeTodoComment);
    },
    enabled: !!todoItemId,
  });

  const addCommentMutation = useMutation({
    mutationFn: (content: string) => todosApi.addComment(todoItemId!, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all(todoItemId!) });
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      setNewCommentValue("");
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Error al agregar comentario");
    },
  });

  const editCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      todosApi.updateComment(todoItemId!, commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all(todoItemId!) });
      setEditingId(null);
      setEditContent("");
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Error al editar comentario");
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => todosApi.deleteComment(todoItemId!, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all(todoItemId!) });
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Error al eliminar comentario");
    },
  });

  const handleAddComment = useCallback(() => {
    if (!hasVisibleContent(newCommentValue)) return;
    addCommentMutation.mutate(newCommentValue);
  }, [newCommentValue, addCommentMutation]);

  const handleAddCommentDirect = useCallback(
    (content: string) => {
      if (!hasVisibleContent(content)) return;
      addCommentMutation.mutate(content);
    },
    [addCommentMutation],
  );

  const handleStartEdit = useCallback((comment: TodoItemComment) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditContent("");
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !hasVisibleContent(editContent)) return;
    editCommentMutation.mutate({ commentId: editingId, content: editContent });
  }, [editingId, editContent, editCommentMutation]);

  const handleDeleteComment = useCallback(
    (commentId: string) => {
      deleteCommentMutation.mutate(commentId);
    },
    [deleteCommentMutation],
  );

  return {
    comments: commentsQuery.data ?? [],
    isLoading: commentsQuery.isLoading,
    isAdding: addCommentMutation.isPending,
    newCommentValue,
    editingId,
    editContent,
    onNewCommentChange: setNewCommentValue,
    onAddComment: handleAddComment,
    onAddCommentDirect: handleAddCommentDirect,
    onStartEdit: handleStartEdit,
    onCancelEdit: handleCancelEdit,
    onSaveEdit: handleSaveEdit,
    onEditContentChange: setEditContent,
    onDeleteComment: handleDeleteComment,
  };
};
