"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { adminFeedbackApi } from "@/lib/api/client";
import { hasVisibleContent } from "@/lib/comment-utils";
import type { UnifiedComment } from "@/domains/shared/presentation/components/unified-comment-section";
import { feedbackKeys } from "./use-feedback-traceability";

type FeedbackCommentApiResponse = {
  id: string;
  entityId?: string;
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

const normalizeFeedbackComment = (comment: FeedbackCommentApiResponse): UnifiedComment => ({
  id: comment.id,
  userId: comment.userId,
  content: comment.content,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
  author: comment.author
    ? {
        id: comment.author.id ?? comment.userId,
        name: comment.author.name ?? comment.userName ?? "Usuario",
        email: comment.author.email ?? comment.userEmail ?? "",
        image: comment.author.image ?? comment.userImage ?? null,
      }
    : undefined,
  userName: comment.userName,
  userEmail: comment.userEmail,
  userImage: comment.userImage,
});

export const useFeedbackComments = (feedbackItemId: string | null) => {
  const queryClient = useQueryClient();

  const [newCommentValue, setNewCommentValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const commentsQuery = useQuery({
    queryKey: feedbackKeys.comments(feedbackItemId ?? ""),
    queryFn: async () => {
      const comments = await (adminFeedbackApi.listFeedbackItemComments(feedbackItemId!) as Promise<FeedbackCommentApiResponse[]>);
      return comments.map(normalizeFeedbackComment);
    },
    enabled: !!feedbackItemId,
  });

  const addCommentMutation = useMutation({
    mutationFn: (content: string) =>
      adminFeedbackApi.addFeedbackItemComment(feedbackItemId!, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.comments(feedbackItemId!) });
      setNewCommentValue("");
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Error al agregar comentario");
    },
  });

  const editCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      adminFeedbackApi.updateFeedbackItemComment(feedbackItemId!, commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.comments(feedbackItemId!) });
      setEditingId(null);
      setEditContent("");
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Error al editar comentario");
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) =>
      adminFeedbackApi.deleteFeedbackItemComment(feedbackItemId!, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.comments(feedbackItemId!) });
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

  const handleStartEdit = useCallback((comment: UnifiedComment) => {
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
