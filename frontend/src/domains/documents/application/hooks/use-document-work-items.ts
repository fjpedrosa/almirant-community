"use client";

import { useQuery } from "@tanstack/react-query";
import { documentsApi } from "@/lib/api/client";
import type { LinkedWorkItem } from "../../domain/types";

const documentWorkItemKeys = {
  byDocument: (documentId: string) => ["document-work-items", documentId] as const,
};

export const useDocumentWorkItems = (documentId: string | null) => {
  return useQuery({
    queryKey: documentWorkItemKeys.byDocument(documentId ?? ""),
    queryFn: () =>
      documentsApi.getLinkedWorkItems(documentId!) as Promise<LinkedWorkItem[]>,
    enabled: !!documentId,
  });
};
