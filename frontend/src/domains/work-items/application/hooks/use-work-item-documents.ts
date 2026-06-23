"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { workItemsApi, documentsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useTranslations } from "next-intl";
import type { LinkedDocument } from "../../domain/types";
import type { DocumentWithCategory } from "@/domains/documents/domain/types";
import { workItemContextKeys } from "./use-work-item-context";

const documentLinkKeys = {
  byWorkItem: (workItemId: string) => ["work-item-documents", workItemId] as const,
};

export const useWorkItemDocuments = (workItemId: string) => {
  const scopedKey = useOrgScopedKey(documentLinkKeys.byWorkItem(workItemId));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      workItemsApi.getLinkedDocuments(workItemId) as Promise<LinkedDocument[]>,
    enabled: !!workItemId,
  });
};

export const useLinkDocument = (workItemId: string) => {
  const queryClient = useQueryClient();
  const t = useTranslations("workItems.linkedDocuments");

  return useMutation({
    mutationFn: (documentId: string) =>
      workItemsApi.linkDocument(workItemId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentLinkKeys.byWorkItem(workItemId) });
      queryClient.invalidateQueries({ queryKey: workItemContextKeys.context(workItemId) });
      showToast.success(t("linkSuccess"));
    },
    onError: () => {
      showToast.error(t("linkError"));
    },
  });
};

export const useUnlinkDocument = (workItemId: string) => {
  const queryClient = useQueryClient();
  const t = useTranslations("workItems.linkedDocuments");

  return useMutation({
    mutationFn: (documentId: string) =>
      workItemsApi.unlinkDocument(workItemId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentLinkKeys.byWorkItem(workItemId) });
      queryClient.invalidateQueries({ queryKey: workItemContextKeys.context(workItemId) });
      showToast.success(t("unlinkSuccess"));
    },
    onError: () => {
      showToast.error(t("unlinkError"));
    },
  });
};

// Fetch available documents for linking (lightweight list)
export const useAvailableDocuments = (enabled: boolean) => {
  const scopedKey = useOrgScopedKey(["available-documents"]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "200");
      const data = await documentsApi.list(params);
      return data as DocumentWithCategory[];
    },
    enabled,
  });
};
