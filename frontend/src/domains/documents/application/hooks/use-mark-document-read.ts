"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { documentsApi } from "@/lib/api/client";
import { documentKeys } from "./use-documents";

/**
 * Mutation hook to mark a document as read.
 * On success, invalidates document lists to refresh isRead status
 * throughout the tree sidebar.
 */
export const useMarkDocumentRead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentId: string) => documentsApi.markAsRead(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
};
