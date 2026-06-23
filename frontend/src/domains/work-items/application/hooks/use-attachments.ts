"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { attachmentsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import type { WorkItemAttachment } from "../../domain/types";

const attachmentKeys = {
  all: ["attachments"] as const,
  byWorkItem: (workItemId: string) =>
    [...attachmentKeys.all, workItemId] as const,
};

export const useAttachments = (workItemId: string) => {
  const scopedKey = useOrgScopedKey(attachmentKeys.byWorkItem(workItemId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      attachmentsApi.list(workItemId) as Promise<WorkItemAttachment[]>,
    enabled: !!workItemId,
  });
};

export const useUploadAttachment = (workItemId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => attachmentsApi.upload(workItemId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: attachmentKeys.byWorkItem(workItemId),
      });
      showToast.success("File attached");
    },
    onError: () => {
      showToast.error("Failed to upload file");
    },
  });
};

export const useDeleteAttachment = (workItemId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      attachmentsApi.delete(workItemId, attachmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: attachmentKeys.byWorkItem(workItemId),
      });
      showToast.success("File deleted");
    },
    onError: () => {
      showToast.error("Failed to delete file");
    },
  });
};
