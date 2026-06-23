"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { handbookApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  HandbookCaptureProposal,
  HandbookCategorySummary,
  HandbookEntry,
  HandbookImportResult,
  HandbookSearchResult,
} from "../../domain/types";

export const handbookKeys = {
  all: ["handbook"] as const,
  lists: () => [...handbookKeys.all, "list"] as const,
  list: (filters: string) => [...handbookKeys.lists(), filters] as const,
  detail: (id: string) => [...handbookKeys.all, "detail", id] as const,
  categories: () => [...handbookKeys.all, "categories"] as const,
  search: (query: string) => [...handbookKeys.all, "search", query] as const,
  proposals: () => [...handbookKeys.all, "proposals"] as const,
};

export const useHandbookEntries = (params?: URLSearchParams) => {
  const scopedKey = useOrgScopedKey(handbookKeys.list(params?.toString() ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: async () => {
      const response = await handbookApi.list(params) as { data: HandbookEntry[] } | HandbookEntry[];
      return Array.isArray(response) ? response : response.data;
    },
    placeholderData: keepPreviousData,
  });
};

export const useHandbookEntry = (id: string | null) => {
  const scopedKey = useOrgScopedKey(handbookKeys.detail(id ?? ""));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => handbookApi.get(id!) as Promise<HandbookEntry>,
    enabled: !!id,
  });
};

export const useHandbookSearch = (query: string, category?: string) => {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (category && category !== "all") params.set("category", category);
  params.set("limit", "12");
  const scopedKey = useOrgScopedKey(handbookKeys.search(params.toString()));
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => handbookApi.search(params) as Promise<HandbookSearchResult[]>,
    enabled: query.trim().length >= 2,
  });
};

export const useHandbookCategories = () => {
  const scopedKey = useOrgScopedKey(handbookKeys.categories());
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => handbookApi.categories() as Promise<HandbookCategorySummary[]>,
  });
};

export const useHandbookProposals = () => {
  const scopedKey = useOrgScopedKey(handbookKeys.proposals());
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => handbookApi.proposals(new URLSearchParams({ status: "pending" })) as Promise<HandbookCaptureProposal[]>,
  });
};

export const useImportDefaultHandbook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => handbookApi.importDefault() as Promise<HandbookImportResult>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: handbookKeys.all });
    },
  });
};

export const useApproveHandbookProposal = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => handbookApi.approveProposal(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: handbookKeys.all }),
  });
};

export const useRejectHandbookProposal = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => handbookApi.rejectProposal(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: handbookKeys.all }),
  });
};
