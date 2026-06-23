"use client";

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { documentsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  DocumentWithCategory,
  CreateDocumentRequest,
  UpdateDocumentRequest,
  PaginatedDocumentsResponse,
} from "../../domain/types";

export const documentKeys = {
  all: ["documents"] as const,
  lists: () => [...documentKeys.all, "list"] as const,
  list: (filters: string) => [...documentKeys.lists(), filters] as const,
  details: () => [...documentKeys.all, "detail"] as const,
  detail: (id: string) => [...documentKeys.details(), id] as const,
};

export const useDocuments = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(documentKeys.list(params?.toString() || ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => documentsApi.list(params) as Promise<DocumentWithCategory[]>,
    placeholderData: keepPreviousData,
  });
};

export const useDocumentsWithPagination = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(documentKeys.list(params?.toString() || "paginated"));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async (): Promise<PaginatedDocumentsResponse> => {
      const result = await documentsApi.listWithMeta(params);
      return {
        items: result.data as DocumentWithCategory[],
        meta: result.meta,
      };
    },
    placeholderData: keepPreviousData,
  });
};

export const useDocument = (id: string | null) => {
  const scopedKey = useOrgScopedKey(documentKeys.detail(id || ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => documentsApi.get(id!) as Promise<DocumentWithCategory>,
    enabled: !!id,
  });
};

export const useCreateDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDocumentRequest) => documentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
};

export const useUpdateDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDocumentRequest }) =>
      documentsApi.update(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: documentKeys.detail(variables.id) });
    },
  });
};

export const useDeleteDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
      queryClient.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
};
