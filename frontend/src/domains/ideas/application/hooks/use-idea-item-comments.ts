"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { ideasApi } from "@/lib/api/client";
import { hasVisibleContent } from "@/lib/comment-utils";
import type { IdeaItemComment } from "../../domain/types";
import { ideaKeys } from "./use-ideas";

export const commentKeys = {
  all: (ideaItemId: string) => ["ideas", ideaItemId, "comments"] as const,
};

export const useIdeaItemComments = (ideaItemId: string | null) => {
  const t = useTranslations("ideas.toasts");
  const queryClient = useQueryClient();

  // UI state
  const [newCommentValue, setNewCommentValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const commentsQuery = useQuery({
    queryKey: commentKeys.all(ideaItemId ?? ""),
    queryFn: () => ideasApi.listComments(ideaItemId!) as Promise<IdeaItemComment[]>,
    enabled: !!ideaItemId,
  });

  const addCommentMutation = useMutation({
    mutationFn: (content: string) => ideasApi.addComment(ideaItemId!, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all(ideaItemId!) });
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
      setNewCommentValue("");
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t("addCommentError"));
    },
  });

  const editCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      ideasApi.updateComment(ideaItemId!, commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all(ideaItemId!) });
      setEditingId(null);
      setEditContent("");
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t("editCommentError"));
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => ideasApi.deleteComment(ideaItemId!, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentKeys.all(ideaItemId!) });
      queryClient.invalidateQueries({ queryKey: ideaKeys.all });
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : t("deleteCommentError"));
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

  const handleStartEdit = useCallback((comment: IdeaItemComment) => {
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
