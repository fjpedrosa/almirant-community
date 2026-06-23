"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { hasVisibleContent } from "@/lib/comment-utils";
import { seedKeys } from "@/domains/planning/domain/query-keys";
import { seedsApi } from "@/domains/planning/infrastructure/api/planning-api";
import type { SeedComment } from "@/domains/planning/domain/types";

export const useSeedComments = (seedId: string | null) => {
  const queryClient = useQueryClient();
  const t = useTranslations("seeds.toasts");

  // UI state
  const [newCommentValue, setNewCommentValue] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // Query
  const commentsQuery = useQuery({
    queryKey: seedKeys.comments(seedId ?? ""),
    queryFn: () => seedsApi.listComments(seedId!),
    enabled: !!seedId,
  });

  // Add comment
  const addMutation = useMutation({
    mutationFn: (content: string) => seedsApi.addComment(seedId!, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seedKeys.comments(seedId!) });
      queryClient.invalidateQueries({ queryKey: seedKeys.all });
      setNewCommentValue("");
    },
    onError: (error) =>
      showToast.error(error instanceof Error ? error.message : t("addCommentError")),
  });

  // Update comment
  const updateMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      seedsApi.updateComment(seedId!, commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seedKeys.comments(seedId!) });
      setEditingId(null);
      setEditContent("");
    },
    onError: (error) =>
      showToast.error(error instanceof Error ? error.message : t("editCommentError")),
  });

  // Delete comment
  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => seedsApi.deleteComment(seedId!, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: seedKeys.comments(seedId!) });
      queryClient.invalidateQueries({ queryKey: seedKeys.all });
    },
    onError: (error) =>
      showToast.error(error instanceof Error ? error.message : t("deleteCommentError")),
  });

  const onAddComment = useCallback(() => {
    if (!hasVisibleContent(newCommentValue)) return;
    addMutation.mutate(newCommentValue);
  }, [addMutation, newCommentValue]);

  const onAddCommentDirect = useCallback(
    (content: string) => {
      if (!hasVisibleContent(content)) return;
      addMutation.mutate(content);
    },
    [addMutation],
  );

  const onStartEdit = useCallback((comment: SeedComment) => {
    setEditingId(comment.id);
    setEditContent(comment.content);
  }, []);

  const onCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditContent("");
  }, []);

  const onSaveEdit = useCallback(() => {
    if (!editingId || !hasVisibleContent(editContent)) return;
    updateMutation.mutate({ commentId: editingId, content: editContent });
  }, [editingId, editContent, updateMutation]);

  const onDeleteComment = useCallback(
    (commentId: string) => {
      deleteMutation.mutate(commentId);
    },
    [deleteMutation],
  );

  return {
    comments: commentsQuery.data ?? [],
    isLoading: commentsQuery.isLoading,
    isAdding: addMutation.isPending,
    newCommentValue,
    editingId,
    editContent,
    onAddComment,
    onAddCommentDirect,
    onDeleteComment,
    onNewCommentChange: setNewCommentValue,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onEditContentChange: setEditContent,
  };
};
