"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { documentCategoriesApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { documentKeys } from "./use-documents";
import type {
  DocumentCategoryWithCount,
  CreateDocumentCategoryRequest,
  UpdateDocumentCategoryRequest,
} from "../../domain/types";

export const categoryKeys = {
  all: ["document-categories"] as const,
  list: () => [...categoryKeys.all, "list"] as const,
};

export const useDocumentCategories = () => {
  const scopedKey = useOrgScopedKey(categoryKeys.list());
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => documentCategoriesApi.list() as Promise<DocumentCategoryWithCount[]>,
  });
};

export const useCreateDocumentCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDocumentCategoryRequest) =>
      documentCategoriesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoryKeys.all });
    },
  });
};

export const useUpdateDocumentCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDocumentCategoryRequest }) =>
      documentCategoriesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoryKeys.all });
    },
  });
};

export const useDeleteDocumentCategory = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => documentCategoriesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoryKeys.all });
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
};
